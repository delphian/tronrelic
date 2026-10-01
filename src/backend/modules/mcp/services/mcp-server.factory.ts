/**
 * @fileoverview Builds the MCP server instance that answers one request.
 *
 * The MCP SDK runs stateless: it asks for a fresh server for every HTTP
 * request. That suits this endpoint, because the tool list differs per caller.
 * Each server registers only the tools the caller may use, and every tool
 * callback runs through the AI tool governor under the `mcp` trigger path,
 * with the verified user as the end user. No tool handler is ever called
 * directly from here.
 *
 * Two per-group settings take effect here. A restricted tool the caller was
 * served through a group that allows restricted tools is named to the governor
 * as such, which is the only way past its MCP safety floor. And a tool served
 * through a group that asks for scrubbing has its result passed through the
 * secret scrubber before it is written to the client.
 */

import { McpServer, fromJsonSchema } from '@modelcontextprotocol/server';
import type { CallToolResult, StandardSchemaWithJSON, ToolAnnotations } from '@modelcontextprotocol/server';
import type {
    IAiTool,
    IAiToolGovernor,
    IMcpAccessTokenClaims,
    ISystemLogService,
    IToolEndUserPrincipal,
    IToolInvocationContext,
    IToolInvocationOrigin,
    IToolInvocationResult
} from '@/types';
import { UNTRUSTED_CONTENT_SYSTEM_CLAUSE } from '@/types';
import type { IMcpServedTool } from './mcp-tool-exposure.service.js';
import type { SecretScrubber } from './SecretScrubber.js';

/** Server name reported to clients in `serverInfo`. */
const SERVER_NAME = 'tronrelic';

/** Server version reported to clients; bump when the served surface changes shape. */
const SERVER_VERSION = '1.0.0';

/**
 * Value recorded as the audit record's `aiProviderId` for MCP calls. The model
 * belongs to the user's own client, not to an installed provider plugin, so a
 * fixed marker says so rather than naming a vendor the platform cannot see.
 */
export const MCP_AI_PROVIDER_ID = 'mcp';

/**
 * How long a client may reuse a `tools/list` answer. The list changes only
 * when an admin approves or withdraws a tool, so a minute is plenty, and it is
 * marked private because the list differs between users.
 */
const TOOLS_LIST_TTL_MS = 60_000;

/**
 * Text returned to the client when a tool fails while running. The governor's
 * error for that case is the handler's raw exception message, which can name
 * internal hosts, tables, or queries, and the caller here is a non-admin
 * user's own client. The audit record keeps the real message for operators.
 */
const TOOL_FAILED_MESSAGE = 'The tool call failed. Try again later.';

/**
 * Guidance returned from `server/discover`. Clients may place it in the
 * model's system prompt, which is the only place the platform's standing rule
 * about untrusted tool results can reach a model it does not control. The
 * per-result `{ untrustedContentNotice, data }` wrapper remains the protection
 * that is always present.
 */
const SERVER_INSTRUCTIONS = [
    'TronRelic exposes tools over TRON blockchain data and TronRelic content. Each tool\'s annotations say whether it only reads.',
    UNTRUSTED_CONTENT_SYSTEM_CLAUSE
].join('\n\n');

/**
 * Everything the factory needs to know about the verified caller.
 */
export interface IMcpCaller {
    /** Claims from the verified access token. */
    claims: IMcpAccessTokenClaims;

    /** The live end-user principal the governor scopes tool calls to. */
    endUser: IToolEndUserPrincipal;

    /** Client IP address as resolved by the trusted proxy chain. */
    ip?: string;
}

/**
 * The tool names one request may call, as the governor needs them.
 */
interface IMcpCallAccess {
    /** Every tool served to the caller; the governor refuses any other name. */
    allowlist: string[];

    /** The restricted tools among them, which the governor lets past its MCP safety floor. */
    restricted: string[];
}

/**
 * Creates per-request MCP servers for verified callers.
 */
export class McpServerFactory {
    /**
     * Compiled input schemas keyed by the tool's schema object. The SDK
     * compiles each schema with AJV when it is wrapped, and a fresh server is
     * built for every request, so reusing the wrapper keeps that cost to once
     * per schema. A WeakMap lets an unregistered tool's schema be collected.
     */
    private readonly schemaCache = new WeakMap<object, StandardSchemaWithJSON>();

    /**
     * @param governor - The AI tool governor every call runs through.
     * @param scrubber - Removes secrets from results of tools served through a
     *   group that asks for scrubbing.
     * @param logger - Module logger, used when a governed call throws.
     */
    constructor(
        private readonly governor: IAiToolGovernor,
        private readonly scrubber: SecretScrubber,
        private readonly logger: ISystemLogService
    ) {}

    /**
     * Build a server that offers exactly the given tools to the given caller.
     *
     * @param caller - The verified caller the tools will run for.
     * @param served - The tools the caller may use, already filtered and
     *   sorted, each with whether it is restricted and whether its results are
     *   scrubbed.
     * @returns A server ready to handle one request.
     */
    create(caller: IMcpCaller, served: IMcpServedTool[]): McpServer {
        const server = new McpServer(
            { name: SERVER_NAME, version: SERVER_VERSION, title: 'TronRelic' },
            {
                capabilities: { tools: { listChanged: false } },
                instructions: SERVER_INSTRUCTIONS,
                cacheHints: { 'tools/list': { ttlMs: TOOLS_LIST_TTL_MS, cacheScope: 'private' } }
            }
        );
        const access: IMcpCallAccess = {
            allowlist: served.map(entry => entry.tool.name),
            restricted: served.filter(entry => entry.restricted).map(entry => entry.tool.name)
        };
        for (const { tool, scrubSecrets } of served) {
            server.registerTool(
                tool.name,
                {
                    title: toTitle(tool.name),
                    description: tool.description,
                    inputSchema: this.schemaFor(tool),
                    annotations: toAnnotations(tool)
                },
                /**
                 * Route the client's call for this tool through the governor
                 * rather than calling the handler directly.
                 *
                 * @param args - Arguments the client supplied, already checked
                 *   against the tool's schema by the SDK.
                 * @returns The governed result shaped for MCP.
                 */
                async (args: unknown) => this.callTool(tool.name, args, caller, access, scrubSecrets)
            );
        }
        return server;
    }

    /**
     * Run one tool call through the governor and shape the result for MCP.
     *
     * The governor never throws by design, but if it does the error message is
     * replaced before it reaches the client, because the SDK would otherwise
     * copy an internal message onto the wire.
     *
     * @param name - The tool the client asked for.
     * @param args - Arguments the client supplied, already schema-checked by the SDK.
     * @param caller - The verified caller.
     * @param access - The names of every tool served to this caller and of the
     *   restricted ones among them, which the governor enforces again on its side.
     * @param scrubSecrets - Whether a successful result is scrubbed before it
     *   is returned, because a group serving this tool asks for it.
     * @returns The MCP tool result.
     */
    private async callTool(name: string, args: unknown, caller: IMcpCaller, access: IMcpCallAccess, scrubSecrets: boolean): Promise<CallToolResult> {
        const input = typeof args === 'object' && args !== null && !Array.isArray(args) ? args as Record<string, unknown> : {};
        let result: CallToolResult;
        try {
            const governed = await this.governor.invoke(name, input, buildContext(caller, access));
            result = toCallToolResult(scrubSecrets && governed.status === 'ok'
                ? { ...governed, content: this.scrubber.scrub(governed.content) }
                : governed);
        } catch (error: unknown) {
            this.logger.error({ err: error, tool: name, userId: caller.claims.userId }, 'MCP tool call failed outside governance');
            result = { content: [{ type: 'text', text: TOOL_FAILED_MESSAGE }], isError: true };
        }
        return result;
    }

    /**
     * Return the SDK schema wrapper for a tool, compiling it once.
     *
     * @param tool - The tool whose input schema is needed.
     * @returns The cached or newly built schema wrapper.
     */
    private schemaFor(tool: IAiTool): StandardSchemaWithJSON {
        let schema = this.schemaCache.get(tool.inputSchema);
        if (!schema) {
            schema = fromJsonSchema(tool.inputSchema as Parameters<typeof fromJsonSchema>[0]);
            this.schemaCache.set(tool.inputSchema, schema);
        }
        return schema;
    }
}

/**
 * Build the governor's invocation context for an MCP call.
 *
 * An MCP call belongs to no run, so the context carries no `queryId`. It sets
 * `quotaKey` to the user's id with a fixed prefix instead. The chain query
 * tools send that key to ClickHouse, which gives every MCP user their own
 * ClickHouse quota bucket rather than one shared by all MCP traffic, without
 * making every call a user ever made look like one run in the audit trail.
 *
 * @param caller - The verified caller.
 * @param access - The tools served to this caller, and the restricted ones among them.
 * @returns The context the governor applies policy and audit from.
 */
function buildContext(caller: IMcpCaller, access: IMcpCallAccess): IToolInvocationContext {
    const origin: IToolInvocationOrigin = {};
    if (caller.claims.clientId) {
        origin.clientId = caller.claims.clientId;
    }
    if (caller.claims.tokenId) {
        origin.credentialId = caller.claims.tokenId;
    }
    if (caller.ip) {
        origin.ip = caller.ip;
    }
    return {
        actor: { kind: 'user', id: caller.claims.userId },
        triggerPath: 'mcp',
        aiProviderId: MCP_AI_PROVIDER_ID,
        quotaKey: `mcp-user:${caller.claims.userId}`,
        endUser: caller.endUser,
        toolAllowlist: access.allowlist,
        ...(access.restricted.length > 0 ? { mcpRestrictedTools: access.restricted } : {}),
        origin
    };
}

/**
 * Convert a governed result into an MCP tool result.
 *
 * A successful result is returned as JSON text, and as structured content
 * when it is an object, so a client can use either. A result from a tool that
 * surfaces untrusted content is already the governor's
 * `{ untrustedContentNotice, data }` envelope, and it passes through intact.
 * A refusal becomes an error result carrying the governor's reason, which is
 * written for a model to read. A failure while running becomes an error result
 * with a fixed message instead, because the governor's error for it is the
 * handler's raw exception text.
 *
 * @param governed - The governor's outcome.
 * @returns The MCP tool result.
 */
function toCallToolResult(governed: IToolInvocationResult): CallToolResult {
    let result: CallToolResult;
    if (governed.status === 'ok') {
        const text = typeof governed.content === 'string' ? governed.content : JSON.stringify(governed.content ?? null);
        result = { content: [{ type: 'text', text }] };
        // MCP defines structuredContent as a JSON object, and clients validate
        // it as a record, so an array result travels as text only.
        if (typeof governed.content === 'object' && governed.content !== null && !Array.isArray(governed.content)) {
            result.structuredContent = governed.content;
        }
    } else if (governed.status === 'error') {
        result = { content: [{ type: 'text', text: TOOL_FAILED_MESSAGE }], isError: true };
    } else {
        result = { content: [{ type: 'text', text: governed.error ?? 'The tool call was refused.' }], isError: true };
    }
    return result;
}

/**
 * Map a tool's capability onto MCP tool annotations.
 *
 * Clients use these hints to decide when to ask the user before a call, and
 * Claude's connector directory review checks them, so they must be honest.
 * `openWorldHint` is set for any tool that reaches outside the platform or
 * returns attacker-influenceable text such as on-chain memos.
 *
 * @param tool - The tool being described.
 * @returns The annotations to publish in `tools/list`.
 */
function toAnnotations(tool: IAiTool): ToolAnnotations {
    const capability = tool.capability;
    const readOnly = capability?.sideEffect === 'read';
    return {
        title: toTitle(tool.name),
        readOnlyHint: readOnly,
        destructiveHint: capability?.reversible === false,
        idempotentHint: readOnly,
        openWorldHint: capability?.sideEffect === 'external' || capability?.surfacesUntrustedContent === true
    };
}

/**
 * Turn a tool name such as `blockchain-address-profile` into a display title.
 *
 * @param name - The registered tool name.
 * @returns The name with separators replaced by spaces and each word capitalized.
 */
function toTitle(name: string): string {
    return name
        .split(/[-_]+/)
        .filter(part => part.length > 0)
        .map(part => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ');
}
