/**
 * @fileoverview HTTP handling for the MCP endpoint itself (`/mcp`).
 *
 * Every request passes through the same checks in the same order before the
 * MCP SDK sees it:
 *
 * 1. Kill switch. While the endpoint is switched off, or the switch cannot be
 *    read, answer 503 and stop.
 * 2. Origin. A browser-sent `Origin` that is not this site is refused, which
 *    blocks DNS-rebinding attacks. Server-to-server clients send no `Origin`.
 * 3. Method. Only POST is served; the stateless transport has no GET stream.
 * 4. Credentials. A token in the query string is refused outright. A missing
 *    or invalid bearer token gets 401 with a `WWW-Authenticate` header that
 *    points at the protected resource metadata, which is what starts the
 *    client's sign-in flow. A valid token without the MCP scope gets 403
 *    `insufficient_scope`, and a user outside the MCP group gets 403. When
 *    the grant or account store cannot be read, the answer is a 503, never
 *    a 401, so a client does not discard a token that may be fine.
 * 5. Body. Only now is the JSON body parsed, with a small size cap, so an
 *    anonymous caller cannot make the server read a large body.
 *
 * Then the verified caller and the tools served to them ride into the SDK on
 * `req.auth`, and the per-request server factory takes over. A `tools/call`
 * naming a tool the caller was not served is logged as an error first, with
 * the reason it was withheld, because the SDK answers it with a bare
 * "Tool not found" that tells an admin nothing.
 */

import express from 'express';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { createMcpHandler } from '@modelcontextprotocol/server';
import type { AuthInfo, McpRequestContext, McpServer } from '@modelcontextprotocol/server';
import { originValidation, toNodeHandler } from '@modelcontextprotocol/node';
import type { ISystemLogService } from '@/types';
import { MCP_OAUTH_SCOPES, MCP_TOOLS_SCOPE } from '@/types';
import type { McpSettingsStore } from '../services/mcp-settings.store.js';
import type { IMcpServedTool, IMcpToolAudience, McpToolExposureService } from '../services/mcp-tool-exposure.service.js';
import type { McpCallerOutcome, McpCallerResolver } from '../services/mcp-caller.resolver.js';
import type { IMcpCaller, McpServerFactory } from '../services/mcp-server.factory.js';

/** Largest JSON body the endpoint accepts. Tool arguments are small; this is generous. */
const MAX_BODY_BYTES = '256kb';

/**
 * Most refused tool calls logged for one request. A JSON-RPC batch can name
 * many tools, and without a cap one request could write an error entry per
 * name into the system log.
 */
const MAX_WITHHELD_CALLS_LOGGED = 10;

/**
 * Public URLs that describe this endpoint to clients.
 */
export interface IMcpEndpointUrls {
    /** The endpoint URL, and the audience every access token must carry. */
    resourceUrl: string;

    /** Where the protected resource metadata document is served. */
    resourceMetadataUrl: string;

    /** Host names a browser `Origin` header may name. */
    allowedOriginHosts: string[];
}

/** What the SDK receives on `req.auth.extra` for one request. */
interface IMcpRequestExtra {
    caller: IMcpCaller;
    tools: IMcpServedTool[];
    [key: string]: unknown;
}

/**
 * Serves `POST /mcp`.
 */
export class McpEndpointController {
    private readonly nodeHandler: ReturnType<typeof toNodeHandler>;
    private readonly checkOrigin: ReturnType<typeof originValidation>;
    private readonly parseBody: RequestHandler = express.json({ limit: MAX_BODY_BYTES });

    /**
     * @param settings - The kill switch, read on every request.
     * @param exposure - Computes the tools served to each caller from their groups and address.
     * @param callers - Verifies tokens and group membership.
     * @param serverFactory - Builds the per-request MCP server.
     * @param urls - Public URLs used in challenges and the Origin check.
     * @param logger - Module logger.
     */
    constructor(
        private readonly settings: McpSettingsStore,
        private readonly exposure: McpToolExposureService,
        private readonly callers: McpCallerResolver,
        serverFactory: McpServerFactory,
        private readonly urls: IMcpEndpointUrls,
        private readonly logger: ISystemLogService
    ) {
        const handler = createMcpHandler(
            /**
             * Build the per-request server from the verified caller and the
             * tools the controller attached, so each request sees only the
             * tools served to that caller.
             *
             * @param ctx - The SDK's request context, carrying `authInfo.extra`.
             * @returns A server registering only the caller's tools.
             * @throws When no verified caller is attached, because that means
             *   the request skipped the controller's checks.
             */
            (ctx: McpRequestContext): McpServer => {
                const extra = ctx.authInfo?.extra as IMcpRequestExtra | undefined;
                if (!extra) {
                    // The controller always sets req.auth before the SDK runs;
                    // reaching here means that wiring broke, so refuse rather
                    // than build a server with no caller.
                    throw new Error('MCP request reached the SDK without a verified caller.');
                }
                return serverFactory.create(extra.caller, extra.tools);
            },
            {
                /**
                 * Record an error the SDK hit while handling a request, so a
                 * failure it answered on its own still reaches the module's logs.
                 *
                 * @param error - Whatever the SDK caught.
                 */
                onerror: (error: unknown) => this.logger.warn({ err: error }, 'MCP handler error')
            }
        );
        this.nodeHandler = toNodeHandler(handler, {
            /**
             * Record a failure in the Node adapter itself (reading the request
             * or writing the response), which the SDK handler never sees.
             *
             * @param error - Whatever the adapter caught.
             */
            onerror: (error: unknown) => this.logger.error({ err: error }, 'MCP Node adapter error')
        });
        this.checkOrigin = originValidation(urls.allowedOriginHosts);
    }

    /**
     * Handle one request to the endpoint. Mounted with `app.all` so non-POST
     * methods get a proper 405 rather than Express's 404.
     *
     * @param req - The Express request; its body has not been parsed yet.
     * @param res - The Express response.
     * @param next - Passed any unexpected error, for the global error handler.
     * @returns Resolves when the response has been handed off or written.
     *   Declared as an arrow property so it can be mounted without `.bind(this)`.
     */
    handle = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const caller = await this.admit(req, res);
            if (caller) {
                await this.runParser(req, res);
                // A rejected body (too large or malformed) has already been answered.
                if (!res.headersSent) {
                    await this.dispatch(req, res, caller);
                }
            }
        } catch (error: unknown) {
            next(error);
        }
    };

    /**
     * Apply every check that runs before the body is read, writing the
     * refusal when one fails.
     *
     * @param req - The incoming request, body not yet parsed.
     * @param res - The response, written when the request is refused.
     * @returns The verified caller and their raw token, or null when the
     *   request was refused and a response has been written.
     */
    private async admit(req: Request, res: Response): Promise<{ caller: IMcpCaller; token: string } | null> {
        let admitted: { caller: IMcpCaller; token: string } | null = null;
        const switchState = await this.readSwitchState();
        const token = readBearerToken(req);
        if (switchState === 'unknown') {
            res.status(503).set('Retry-After', '30').json({ error: 'unavailable', error_description: 'The MCP endpoint is temporarily unavailable.' });
        } else if (switchState === 'off') {
            res.status(503).set('Retry-After', '3600').json({ error: 'unavailable', error_description: 'The MCP endpoint is switched off.' });
        } else if (!this.checkOrigin(req, res)) {
            // originValidation has already written a 403.
        } else if (req.method !== 'POST') {
            res.status(405).set('Allow', 'POST').json({ error: 'method_not_allowed', error_description: 'Use POST.' });
        } else if (typeof req.query.access_token !== 'undefined') {
            // Tokens in URLs end up in logs and browser history; the MCP
            // authorization spec forbids accepting them.
            res.status(400).json({ error: 'invalid_request', error_description: 'Send the access token in the Authorization header, never in the URL.' });
        } else if (!token) {
            this.challenge(res, 401);
        } else {
            const outcome = await this.resolveCaller(token, req.ip);
            if (outcome === null) {
                // The grant or account store could not be read. That says
                // nothing about the token, so answer a temporary 503 rather
                // than a 401 that would make the client discard its token and
                // send the user through sign-in again.
                res.status(503).set('Retry-After', '30').json({ error: 'unavailable', error_description: 'The MCP endpoint is temporarily unavailable.' });
            } else if (outcome.kind === 'invalid-token') {
                this.challenge(res, 401, 'invalid_token', 'The access token is invalid, expired, or was not issued for this endpoint.');
            } else if (outcome.kind === 'insufficient-scope') {
                this.challenge(res, 403, 'insufficient_scope', `The access token lacks the "${MCP_TOOLS_SCOPE}" scope.`);
            } else if (outcome.kind === 'not-member') {
                res.status(403).json({ error: 'forbidden', error_description: 'Your account is not permitted to use the TronRelic MCP endpoint.' });
            } else {
                admitted = { caller: outcome.caller, token };
            }
        }
        return admitted;
    }

    /**
     * Read the kill switch without letting a storage failure escape.
     *
     * An endpoint that cannot tell whether it is switched on must behave as
     * switched off, and the client should see that as a temporary 503 rather
     * than the global handler's 500. A failed read is logged and reported as
     * `'unknown'` so the caller can answer with a short `Retry-After`, since
     * the database is usually back well before an operator's hour-long off.
     *
     * @returns `'on'` or `'off'` from the stored settings, or `'unknown'` when
     *   the settings could not be read.
     */
    private async readSwitchState(): Promise<'on' | 'off' | 'unknown'> {
        let state: 'on' | 'off' | 'unknown';
        try {
            const settings = await this.settings.get();
            state = settings.enabled ? 'on' : 'off';
        } catch (error: unknown) {
            this.logger.error({ err: error }, 'Could not read the MCP kill switch; refusing the request');
            state = 'unknown';
        }
        return state;
    }

    /**
     * Resolve the caller without letting a storage failure escape.
     *
     * The resolver reads the grant store and the account directory. When
     * either is down, the token's validity is unknown, and the client must see
     * a temporary 503 rather than the global handler's 500 or a 401 that
     * would end its session. A failed read is logged and reported as null.
     *
     * @param token - The raw bearer token.
     * @param ip - Client IP address, passed through for the audit record.
     * @returns The resolver's outcome, or null when a store could not be read.
     */
    private async resolveCaller(token: string, ip: string | undefined): Promise<McpCallerOutcome | null> {
        let outcome: McpCallerOutcome | null;
        try {
            outcome = await this.callers.resolve(token, ip);
        } catch (error: unknown) {
            this.logger.error({ err: error }, 'Could not check an MCP caller; refusing the request');
            outcome = null;
        }
        return outcome;
    }

    /**
     * Hand an admitted request to the MCP SDK.
     *
     * The tools served to this caller are computed now, per request, from
     * their groups and address, so an approval, a withdrawal, or a group
     * setting changed on the admin page applies to the next call. The caller
     * and tools ride on `req.auth.extra`, which is how the SDK passes
     * per-request data to the server factory.
     *
     * @param req - The request, body parsed.
     * @param res - The response the SDK writes.
     * @param admitted - The verified caller and their raw token.
     * @returns Resolves when the SDK has written the response.
     */
    private async dispatch(req: Request, res: Response, admitted: { caller: IMcpCaller; token: string }): Promise<void> {
        const { caller, token } = admitted;
        const tools = await this.readServedTools(caller);
        if (tools === null) {
            // The approvals store is down. Answer the same temporary 503 as a
            // failed kill-switch or grant read, not the global handler's 500.
            res.status(503).set('Retry-After', '30').json({ error: 'unavailable', error_description: 'The MCP endpoint is temporarily unavailable.' });
        } else {
            await this.logWithheldCalls(req.body, caller, tools);
            await this.handOff(req, res, caller, token, tools);
        }
    }

    /**
     * Write an error log entry for each tool the request asks to run that was
     * not served to this caller.
     *
     * The SDK refuses such a call with "Tool not found" and nothing else, so
     * without this entry an admin cannot tell an IP allowlist refusal from a
     * missing grant or a stale one. The reason comes from the exposure
     * service, which applies the same checks that built the served list. A
     * failure to work out the reason is logged too, and never stops the
     * request, which the SDK still answers.
     *
     * @param body - The parsed JSON-RPC body: one message, or a batch.
     * @param caller - The verified caller, named in each entry.
     * @param tools - The tools served to this caller for this request.
     * @returns Resolves once every entry has been written.
     */
    private async logWithheldCalls(body: unknown, caller: IMcpCaller, tools: IMcpServedTool[]): Promise<void> {
        const served = new Set(tools.map(entry => entry.tool.name));
        const withheld = calledToolNames(body).filter(name => !served.has(name)).slice(0, MAX_WITHHELD_CALLS_LOGGED);
        const context = {
            userId: caller.claims.userId,
            clientId: caller.claims.clientId,
            ip: caller.ip,
            groups: caller.endUser.groups ?? []
        };
        for (const name of withheld) {
            try {
                // Null means a grant or setting changed after the served list
                // was built, so the tool would be served on the next call.
                const reason = (await this.exposure.explainWithheld(name, audienceOf(caller))) ?? 'changed-during-request';
                this.logger.error({ ...context, tool: name, reason }, `MCP tool call refused: ${name} is not served to this caller (${reason})`);
            } catch (error: unknown) {
                this.logger.error({ ...context, tool: name, err: error }, `MCP tool call refused: ${name} is not served to this caller (reason unavailable)`);
            }
        }
    }

    /**
     * Read the served tool list without letting a storage failure escape, so
     * the client sees a temporary 503 rather than a 500 it cannot act on.
     *
     * @param caller - The verified caller, whose groups and address decide what is served.
     * @returns The served tools, or null when the approvals or group settings
     *   could not be read.
     */
    private async readServedTools(caller: IMcpCaller): Promise<IMcpServedTool[] | null> {
        let tools: IMcpServedTool[] | null;
        try {
            tools = await this.exposure.getServedTools(audienceOf(caller));
        } catch (error: unknown) {
            this.logger.error({ err: error }, 'Could not read MCP tool approvals; refusing the request');
            tools = null;
        }
        return tools;
    }

    /**
     * Attach the verified caller and their tools to the request and pass it
     * to the MCP SDK, which builds the per-request server and writes the reply.
     *
     * @param req - The request, body parsed.
     * @param res - The response the SDK writes.
     * @param caller - The verified caller.
     * @param token - The caller's raw bearer token, which the SDK's auth info carries.
     * @param tools - The tools served to this caller.
     * @returns Resolves when the SDK has written the response.
     */
    private async handOff(req: Request, res: Response, caller: IMcpCaller, token: string, tools: IMcpServedTool[]): Promise<void> {
        const extra: IMcpRequestExtra = { caller, tools };
        const authInfo: AuthInfo = {
            token,
            clientId: caller.claims.clientId ?? 'unknown',
            scopes: caller.claims.scopes,
            ...(caller.claims.expiresAt ? { expiresAt: caller.claims.expiresAt } : {}),
            resource: new URL(this.urls.resourceUrl),
            extra
        };
        (req as Request & { auth?: AuthInfo }).auth = authInfo;
        await this.nodeHandler(req, res, req.body);
    }

    /**
     * Run the size-capped JSON parser as a promise.
     *
     * A malformed or oversized body makes the parser call back with an error.
     * That is the client's fault, so it is answered here as a 400 or 413
     * rather than passed to the global handler as a server error.
     *
     * @param req - The request whose body to parse.
     * @param res - The response, written only when the body is rejected.
     * @returns Resolves once the body is parsed or the rejection is written.
     */
    private runParser(req: Request, res: Response): Promise<void> {
        return new Promise(resolve => {
            this.parseBody(req, res, (error?: unknown) => {
                if (error) {
                    const status = (error as { status?: number }).status === 413 ? 413 : 400;
                    res.status(status).json({ error: 'invalid_request', error_description: status === 413 ? 'Request body is too large.' : 'Request body is not valid JSON.' });
                }
                resolve();
            });
        });
    }

    /**
     * Write a bearer challenge.
     *
     * The `resource_metadata` parameter is what tells an MCP client where to
     * learn which authorization server to use (RFC 9728). `scope` names the
     * scopes to request. Clients prefer it over the metadata document's list,
     * so it carries `offline_access` too; without it the client gets no
     * refresh token and the user signs in again every 15 minutes.
     *
     * @param res - The response to write.
     * @param status - 401 for missing or invalid credentials, 403 for a missing scope.
     * @param error - OAuth error code, omitted when no token was sent at all.
     * @param description - Human-readable explanation for the client's logs.
     */
    private challenge(res: Response, status: 401 | 403, error?: string, description?: string): void {
        const params = [
            `resource_metadata="${this.urls.resourceMetadataUrl}"`,
            `scope="${MCP_OAUTH_SCOPES.join(' ')}"`
        ];
        if (error) {
            params.unshift(`error="${error}"`);
        }
        if (description) {
            params.push(`error_description="${description.replace(/"/g, "'")}"`);
        }
        res.status(status)
            .set('WWW-Authenticate', `Bearer ${params.join(', ')}`)
            .json({ error: error ?? 'unauthorized', ...(description ? { error_description: description } : {}) });
    }
}

/**
 * Describe a verified caller the way the exposure service needs it.
 *
 * Building the served list and explaining a refused call must look at the
 * same groups and address, or the logged reason could disagree with what was
 * actually served, so both go through this one function.
 *
 * @param caller - The verified caller.
 * @returns The caller's groups and request address.
 */
function audienceOf(caller: IMcpCaller): IMcpToolAudience {
    return { groups: caller.endUser.groups ?? [], ip: caller.ip };
}

/**
 * List the tool names a JSON-RPC body asks to run.
 *
 * The body is the client's input and has only been checked to be JSON, so
 * every field is checked before it is read. A body may hold one message or a
 * batch of them; each name appears once in the result.
 *
 * @param body - The parsed request body.
 * @returns The `params.name` of every `tools/call` message, without duplicates.
 */
function calledToolNames(body: unknown): string[] {
    const names = new Set<string>();
    const messages: unknown[] = Array.isArray(body) ? body : [body];
    for (const message of messages) {
        if (typeof message === 'object' && message !== null) {
            const { method, params } = message as { method?: unknown; params?: unknown };
            const name = typeof params === 'object' && params !== null ? (params as { name?: unknown }).name : undefined;
            if (method === 'tools/call' && typeof name === 'string') {
                names.add(name);
            }
        }
    }
    return [...names];
}

/**
 * Read the bearer token from the `Authorization` header.
 *
 * @param req - The incoming request.
 * @returns The token, or null when the header is missing or not a bearer header.
 */
function readBearerToken(req: Request): string | null {
    const header = req.get('authorization');
    const match = header ? /^Bearer\s+(\S+)\s*$/i.exec(header) : null;
    return match ? match[1] : null;
}
