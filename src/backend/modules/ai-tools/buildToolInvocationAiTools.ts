/**
 * @fileoverview Read-only AI tool over the tool-invocation audit trail.
 *
 * The governor writes one record to `module_ai-tools_invocations` for every
 * governed tool call: which tool, who triggered it and by what path, the
 * arguments, the outcome, how long it took, and what it cost. Until this tool
 * the only way to read those records was the admin Activity tab. An agent
 * reviewing a scheduled prompt could not see which of its tool calls failed,
 * and a prompt told never to mention a failed fetch hid the failure
 * everywhere else too.
 *
 * One tool, `ai-list-tool-invocations`, pages through the records newest
 * first, filtered by tool, status, trigger path, run, conversation, and time
 * window.
 *
 * It is classified `secret`. The governor redacts the arguments of a
 * `secret`-classified tool, but it does not redact anything else: the result
 * digest of a secret tool, such as a log query, is stored as it came back, and
 * the arguments of a non-secret tool can carry whatever the model put in them,
 * including a secret variable's value. Returning those records makes this a
 * private-data source, so it fails the MCP safety floor, counts as the
 * trifecta's private-data leg while enabled, and has its own arguments
 * redacted in the audit record, the same as `ai-get-prompt-run`.
 *
 * @module backend/modules/ai-tools/buildToolInvocationAiTools
 */

import {
    AI_TOOL_NAME_PATTERN,
    type IAiTool,
    type IAiToolCapability,
    type ISystemLogService,
    type IToolInvocationRecord,
    type ToolInvocationStatus,
    type ToolTriggerPath
} from '@/types';
import type { IToolInvocationQuery, ToolAuditStore } from './services/tool-audit-store.js';
import { AiToolInputError, runAiToolCall } from './runAiToolCall.js';
import { readEnum, readInteger, readTimeWindow } from './readAiToolInputs.js';

/**
 * Every tool's name, led by `ai`, the first word of the module id. Renaming one
 * drops its stored enabled state and policy overrides, and breaks any saved
 * prompt whose tool allowlist names it.
 */
export const AI_TOOL_NAMES = {
    listInvocations: 'ai-list-tool-invocations'
} as const;

/**
 * The run-history transcript tool, named here so this tool's description can
 * point at it for a call's full arguments and result without importing that
 * module's name table.
 */
const GET_RUN_TOOL_NAME = 'ai-get-prompt-run';

/**
 * Classification of `ai-list-tool-invocations`.
 *
 * Read-only and free. `secret` because a record can hold a secret tool's
 * result digest and any argument a model sent (see the file header).
 * `surfacesUntrustedContent` because result digests and error messages carry
 * outside text such as fetched pages and TRON memos, so the governor wraps
 * every result as data.
 */
const LIST_CAPABILITY: IAiToolCapability = {
    sideEffect: 'read',
    reversible: true,
    sensitivity: 'secret',
    surfacesUntrustedContent: true
};

/** Records per page when the caller does not say, and the most one page may hold. */
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

/**
 * Largest offset accepted. The store pages with a database skip, so this
 * bounds how far one call can make it walk. A caller looking further back
 * narrows the window with `since` and `until` instead.
 */
const MAX_OFFSET = 100_000;

/**
 * Most characters of one record's arguments returned, as JSON. A drafted blog
 * post can run to many thousands of characters, and a page of them would fill
 * the caller's context window. A longer argument set comes back as a cut JSON
 * string marked `inputTruncated`, and the full arguments are in the run's
 * transcript.
 */
const MAX_INPUT_CHARS = 2_000;

/**
 * Longest run or conversation id accepted. There is no character rule because
 * the write side has none (see `ai-get-prompt-run`); the cap keeps the argument
 * bounded.
 */
const MAX_ID_CHARS = 256;

/** Statuses the governor records, for validating the `status` filter. */
const STATUSES: readonly ToolInvocationStatus[] = ['ok', 'denied', 'pending-approval', 'error'];

/** Trigger paths the governor records, for validating the `triggerPath` filter. */
const TRIGGER_PATHS: readonly ToolTriggerPath[] = ['interactive', 'scheduled', 'programmatic', 'mcp'];

/** What the model is told when a call fails for a reason that is not its input. */
const FAILURE_MESSAGE = 'The tool invocation lookup failed.';

/**
 * Read the optional `toolName` filter.
 *
 * Checked against the registry's own name rule, so a value that could never
 * name a tool is refused with a message instead of quietly matching nothing.
 *
 * @param value - The raw argument, possibly absent.
 * @returns The tool name, or undefined when the argument is absent.
 */
function readToolName(value: unknown): string | undefined {
    let result: string | undefined;
    if (value !== undefined && value !== null) {
        if (typeof value !== 'string' || !AI_TOOL_NAME_PATTERN.test(value)) {
            throw new AiToolInputError('toolName must be a registered tool name: 1 to 64 letters, digits, _ or -. A provider-hosted tool such as web_fetch is recorded without its hosted: prefix.');
        }
        result = value;
    }
    return result;
}

/**
 * Read an optional run or conversation id filter.
 *
 * @param value - The raw argument, possibly absent.
 * @param field - The parameter name, for the message.
 * @returns The trimmed id, or undefined when the argument is absent.
 */
function readId(value: unknown, field: string): string | undefined {
    let result: string | undefined;
    if (value !== undefined && value !== null) {
        const id = typeof value === 'string' ? value.trim() : '';
        if (id.length === 0 || id.length > MAX_ID_CHARS) {
            throw new AiToolInputError(`${field} must be an id from ai-list-prompt-runs: 1 to ${MAX_ID_CHARS} characters.`);
        }
        result = id;
    }
    return result;
}

/**
 * Read every filter argument into a store query, refusing anything the model
 * can correct before the database is touched.
 *
 * @param input - The raw tool arguments.
 * @returns The store query, with absent filters left out.
 */
function readQuery(input: Record<string, unknown>): IToolInvocationQuery {
    const { since, until } = readTimeWindow(input);
    const candidate: IToolInvocationQuery = {
        toolName: readToolName(input.toolName),
        status: readEnum(input.status, 'status', STATUSES),
        triggerPath: readEnum(input.triggerPath, 'triggerPath', TRIGGER_PATHS),
        queryId: readId(input.queryId, 'queryId'),
        conversationId: readId(input.conversationId, 'conversationId'),
        since,
        until,
        limit: readInteger(input.limit, 'limit', DEFAULT_LIMIT, 1, MAX_LIMIT),
        offset: readInteger(input.offset, 'offset', 0, 0, MAX_OFFSET)
    };
    const query = Object.fromEntries(Object.entries(candidate).filter(([, value]) => value !== undefined)) as IToolInvocationQuery;
    return query;
}

/**
 * Turn one stored record into what the tool returns.
 *
 * Two stored fields are left out. `errorRaw` is the upstream error body the
 * record keeps for admin forensics, and it can hold response text from an
 * outside service. `origin` keeps only `clientId`: the caller's IP address and
 * credential id identify a person and a token, and stay on the admin Activity
 * tab.
 *
 * @param record - The stored invocation record.
 * @returns The record as this tool returns it.
 */
function toInvocationView(record: IToolInvocationRecord): Record<string, unknown> {
    const input = record.input ?? {};
    const inputJson = JSON.stringify(input);
    const inputTruncated = inputJson.length > MAX_INPUT_CHARS;
    return {
        id: record.id,
        createdAt: record.createdAt,
        toolName: record.toolName,
        providerId: record.providerId,
        aiProviderId: record.aiProviderId,
        capability: record.capability,
        triggerPath: record.triggerPath,
        actorKind: record.actor?.kind ?? null,
        actorId: record.actor?.id ?? null,
        endUserId: record.endUserId ?? null,
        clientId: record.origin?.clientId ?? null,
        queryId: record.queryId ?? null,
        conversationId: record.conversationId ?? null,
        toolUseId: record.toolUseId ?? null,
        status: record.status,
        durationMs: record.durationMs,
        costUsd: record.costUsd ?? null,
        input: inputTruncated ? inputJson.slice(0, MAX_INPUT_CHARS) : input,
        inputTruncated,
        resultDigest: record.resultDigest ?? null,
        error: record.error ?? null,
        screen: record.screen ?? null
    };
}

/**
 * Build the tool-invocation tool against the audit store.
 *
 * Takes only the store's `list` method, so a test can supply a small fake and
 * the tool cannot reach the store's write or prune methods.
 *
 * @param audit - The audit store the tool reads through.
 * @param logger - Module-scoped logger for unexpected failures.
 * @returns The tools, in the order the admin page lists them.
 */
export function buildToolInvocationAiTools(
    audit: Pick<ToolAuditStore, 'list'>,
    logger: ISystemLogService
): IAiTool[] {
    const listInvocations: IAiTool = {
        name: AI_TOOL_NAMES.listInvocations,
        description:
            'List recorded AI tool calls one page at a time, newest first. TronRelic records every governed tool call an AI run makes, and every provider-hosted call such as web_fetch, and keeps them for 90 days. ' +
            'Use to find which tool calls in a run or a time window failed, were denied, or ran slowly, for example every tronrelic-fetch-url call a scheduled prompt made yesterday and what each returned. ' +
            'Not for reading a run\'s answer: use ai-list-prompt-runs and ' + GET_RUN_TOOL_NAME + ' for that. ' +
            'Each record has id, createdAt, toolName, providerId (the plugin or module that owns the tool), aiProviderId, capability, triggerPath, actorKind and actorId (who drove the run), endUserId, clientId (the MCP app, when it arrived over MCP), queryId (the run), conversationId, toolUseId, status, durationMs, costUsd, input, inputTruncated, resultDigest, error, and screen. ' +
            'status is ok when the handler returned, error when it threw or timed out, denied when policy refused it before it ran, and pending-approval when it was held for an admin. A tool that reports its own failure in its answer, such as success false or an HTTP 404, is still ok, so read resultDigest to see what came back. ' +
            `resultDigest is the first 500 characters of the result. input is the arguments, shown as [redacted] for a secret-classified tool; arguments longer than ${MAX_INPUT_CHARS} characters come back as a cut JSON string with inputTruncated true, and the full arguments and result are in the run\'s transcript from ${GET_RUN_TOOL_NAME}, matched by toolUseId. ` +
            'Parameters, all optional: toolName (exact tool name), status (ok, denied, pending-approval, or error), triggerPath (interactive, scheduled, programmatic, or mcp; scheduled saved prompts record as programmatic), queryId (one run, the id from ai-list-prompt-runs), conversationId, since and until (ISO 8601 timestamps bounding createdAt, inclusive), ' +
            `limit (default ${DEFAULT_LIMIT}, at most ${MAX_LIMIT}), and offset (records to skip, default 0). Returns total (records matching the filters), offset, limit, returned, nextOffset (null on the last page), and invocations[]. ` +
            'Read-only; never runs, approves, or deletes anything.',
        capability: LIST_CAPABILITY,
        inputSchema: {
            type: 'object',
            description: 'Filters and the page of records to return. Every field is optional.',
            properties: {
                toolName: { type: 'string', description: 'Only calls to this exact tool name, such as tronrelic-fetch-url.' },
                status: { type: 'string', enum: [...STATUSES], description: 'Only calls that ended with this status.' },
                triggerPath: { type: 'string', enum: [...TRIGGER_PATHS], description: 'Only calls made on this path. Scheduled saved prompts record as programmatic.' },
                queryId: { type: 'string', description: 'Only calls made during this one run, the id from ai-list-prompt-runs.' },
                conversationId: { type: 'string', description: 'Only calls made during this conversation.' },
                since: { type: 'string', description: 'Earliest createdAt to include, an ISO 8601 timestamp such as 2026-10-27T00:00:00Z.' },
                until: { type: 'string', description: 'Latest createdAt to include, an ISO 8601 timestamp.' },
                limit: { type: 'integer', minimum: 1, maximum: MAX_LIMIT, description: `Records per page. Default ${DEFAULT_LIMIT}, at most ${MAX_LIMIT}.` },
                offset: { type: 'integer', minimum: 0, maximum: MAX_OFFSET, description: 'Records to skip from the newest. Pass the previous page\'s nextOffset to continue.' }
            },
            additionalProperties: false
        },
        inputExamples: [
            {},
            { toolName: 'tronrelic-fetch-url', triggerPath: 'programmatic', since: '2026-10-26T23:00:00Z', until: '2026-10-28T01:00:00Z' },
            { queryId: '3f2b8c1e-6a4d-4e9b-9c7a-1d5e0f8a2b6c', limit: 100 },
            { status: 'error', limit: 50, offset: 50 }
        ],
        handler: async (input) => runAiToolCall(logger, AI_TOOL_NAMES.listInvocations, FAILURE_MESSAGE, async () => {
            const query = readQuery(input);
            const page = await audit.list(query);
            const offset = query.offset ?? 0;
            const nextOffset = offset + page.records.length;
            return {
                total: page.total,
                offset,
                limit: query.limit ?? DEFAULT_LIMIT,
                returned: page.records.length,
                nextOffset: nextOffset < page.total && page.records.length > 0 ? nextOffset : null,
                invocations: page.records.map(toInvocationView)
            };
        })
    };

    return [listInvocations];
}
