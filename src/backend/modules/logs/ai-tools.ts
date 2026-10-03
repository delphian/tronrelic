/**
 * @file ai-tools.ts
 *
 * AI tool registrations for the logs module. Exposes three strictly
 * read-only tools backed by SystemLogService — query-system-logs,
 * get-system-log, and get-log-statistics — so an AI agent can inspect
 * system health and investigate errors.
 *
 * Tools register on the core `'ai-tools'` registry via the service-registry
 * watch pattern: the AI tools module publishes the registry during its `run()`
 * phase, after this watch is set up, so the module subscribes to its presence
 * rather than resolving it once. Each onAvailable re-registers the tools.
 *
 * The query and get tools surface raw log context — which can contain secrets
 * (tokens in error payloads) and attacker-influenced strings (memo text,
 * request data) — so they declare `sensitivity: 'secret'` and
 * `surfacesUntrustedContent: true`. The statistics tool returns only aggregate
 * counts, so it is plain read/internal. The governor adds rate limiting and a
 * redacted audit record from those classifications.
 *
 * The query tool's list view leaves out each entry's context, which is most of
 * an entry's size, and returns a short `error` summary in its place, so a large
 * page stays within a client's tool-output limit. The get tool returns the
 * full record.
 *
 * The legacy `resolved` column is intentionally absent from every tool
 * surface — it is unused and scheduled for removal.
 */

import type {
    IAiTool,
    IAiToolRegistry,
    IServiceRegistry,
    ISystemLogCursor,
    ISystemLogService,
    LogLevel,
    ServiceWatchDisposer
} from '@/types';
import { extractLogErrorText } from '@/types';
import type { SystemLogService } from './services/system-log.service.js';

/** Provider id passed to `registerTool` so the admin UI groups tools under this module. */
const PROVIDER_ID = 'logs';

/** Tool name constants. `tronrelic-` prefix matches platform-default tools. */
export const AI_TOOL_NAMES = {
    queryLogs: 'tronrelic-query-system-logs',
    getLog: 'tronrelic-get-system-log',
    getStatistics: 'tronrelic-get-log-statistics'
} as const;

/** Valid severity levels accepted by the query tool's `levels` parameter. */
const VALID_LEVELS: readonly LogLevel[] = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];

/** Default page size for the query tool. */
const DEFAULT_QUERY_LIMIT = 20;

/**
 * Hard cap on page size. List entries carry no context and capped text, so a
 * full page stays near 30k tokens.
 */
const MAX_QUERY_LIMIT = 500;

/** Longest `message` returned per entry in list view. */
const LIST_MESSAGE_MAX_CHARS = 300;

/** Longest `error` summary returned per entry in list view. */
const LIST_ERROR_MAX_CHARS = 150;

/**
 * Returned with every query result, so an agent that never re-reads the tool
 * description still learns where the full context lives.
 */
const LIST_DETAIL_NOTE =
    `Entries omit the context payload, and long message and error text is shortened. ` +
    `Call ${AI_TOOL_NAMES.getLog} with an entry id for the full record, including context and stack traces.`;

/**
 * Most entry ids a cursor may carry. A cursor normally carries one id — the
 * entries sharing the last returned millisecond — so this only bounds how much
 * work a forged or corrupted cursor can push into the `$nin` filter.
 */
const CURSOR_MAX_SEEN_IDS = 1000;

/** Longest cursor string accepted, checked before decoding anything. */
const CURSOR_MAX_LENGTH = 40_000;

/** Pattern a MongoDB ObjectId string must match. */
const OBJECT_ID_PATTERN = /^[a-f0-9]{24}$/i;

/**
 * Turn a cursor from the log service into the opaque string handed to the
 * model.
 *
 * The model only needs to pass the value back unchanged, so it gets one
 * string instead of a structure it might be tempted to edit. The string is
 * base64url-encoded JSON, which survives any transport without escaping.
 *
 * @param cursor - The `next` cursor the service returned for this page.
 * @returns The string the model passes as `cursor` to fetch the next page.
 */
function encodeCursor(cursor: ISystemLogCursor): string {
    const payload = JSON.stringify({ t: cursor.timestamp.toISOString(), ids: cursor.seenIds });
    return Buffer.from(payload, 'utf8').toString('base64url');
}

/**
 * Turn a cursor string from the model back into a service cursor, rejecting
 * anything this tool did not produce.
 *
 * The value arrives as model input, so it is checked like any other argument:
 * bounded length, valid base64url, valid JSON, a real date, and a bounded list
 * of well-formed ids. Each failure throws a message the model can act on.
 *
 * @param value - Raw `cursor` tool input, or undefined on the first page.
 * @returns The decoded cursor, or undefined when no cursor was supplied.
 */
function decodeCursor(value: unknown): ISystemLogCursor | undefined {
    let result: ISystemLogCursor | undefined;
    if (value !== undefined && value !== null && value !== '') {
        const invalid = 'Parameter "cursor" is not a valid cursor. Pass back the nextCursor value from the previous page unchanged, or omit cursor to start from the newest entry.';
        if (typeof value !== 'string' || value.length > CURSOR_MAX_LENGTH || !/^[A-Za-z0-9_-]+$/.test(value)) {
            throw new Error(invalid);
        }

        let parsed: unknown;
        try {
            parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
        } catch {
            throw new Error(invalid);
        }

        const candidate = parsed as { t?: unknown; ids?: unknown };
        const timestamp = new Date(String(candidate?.t));
        const ids = candidate?.ids;
        if (
            Number.isNaN(timestamp.getTime())
            || !Array.isArray(ids)
            || ids.length > CURSOR_MAX_SEEN_IDS
            || !ids.every(id => typeof id === 'string' && OBJECT_ID_PATTERN.test(id))
        ) {
            throw new Error(invalid);
        }

        result = { timestamp, seenIds: ids as string[] };
    }
    return result;
}

/**
 * Parse an optional ISO 8601 string into a Date, throwing a descriptive
 * error the model can correct from when the value is malformed.
 *
 * @param value - Raw tool input value for a date parameter.
 * @param name - Parameter name used in the error message.
 * @returns Parsed Date, or undefined when the value was omitted.
 */
function parseIsoDate(value: unknown, name: string): Date | undefined {
    let result: Date | undefined;
    if (value !== undefined && value !== null) {
        const date = new Date(String(value));
        if (Number.isNaN(date.getTime())) {
            throw new Error(`Parameter "${name}" must be a valid ISO 8601 date string, got: ${String(value)}`);
        }
        result = date;
    }
    return result;
}

/**
 * Minimal structural shape of a persisted log entry that the projections
 * consume. Declared locally rather than importing the Mongoose-backed
 * `ISystemLogDocument`, so the projection stays decoupled from the storage layer
 * (the log service contract returns `any`, so this is the narrowest honest shape
 * the projection depends on). `_id` is the one storage-derived field, stringified
 * into the projected `id`.
 */
interface ILogEntrySource {
    _id: unknown;
    timestamp?: Date | string;
    level?: LogLevel;
    message?: string;
    service?: string;
    context?: unknown;
}

/**
 * Shorten text for the list view, marking the cut so the model knows the full
 * text exists and can fetch it.
 *
 * @param text - The stored text, which has no length limit of its own.
 * @param maxChars - The most characters to keep before the marker.
 * @returns The text unchanged when it fits, otherwise its first `maxChars`
 *          characters followed by `… [truncated]`.
 */
function shortenText(text: string, maxChars: number): string {
    return text.length > maxChars ? `${text.slice(0, maxChars)}… [truncated]` : text;
}

/**
 * Project the fields every view shares, omitting the deprecated `resolved`
 * fields that the tools never expose.
 *
 * @param log - A persisted log entry; see {@link ILogEntrySource}.
 * @returns The id, timestamp, level, and service of the entry.
 */
function projectLogIdentity(log: ILogEntrySource): Record<string, unknown> {
    return {
        id: String(log._id),
        timestamp: log.timestamp,
        level: log.level,
        service: log.service
    };
}

/**
 * Project a log entry for the query tool's list view.
 *
 * The context payload is most of an entry's size, so it is left out, and the
 * error text it carries is returned as a short `error` field instead, so an
 * agent can still see why an entry failed. `message` is shortened because it
 * has no stored length limit and one long message could inflate a page.
 *
 * @param log - A persisted log entry; see {@link ILogEntrySource}.
 * @returns The list-view entry, with `error` null when the context has none.
 */
function projectLogSummary(log: ILogEntrySource): Record<string, unknown> {
    const errorText = extractLogErrorText(log.context);
    return {
        ...projectLogIdentity(log),
        message: typeof log.message === 'string' ? shortenText(log.message, LIST_MESSAGE_MAX_CHARS) : log.message,
        error: errorText === null ? null : shortenText(errorText, LIST_ERROR_MAX_CHARS)
    };
}

/**
 * Project a log entry for the get tool, with the full message and context.
 *
 * @param log - A persisted log entry; see {@link ILogEntrySource}.
 * @returns The complete entry, minus the deprecated `resolved` fields.
 */
function projectLogDetail(log: ILogEntrySource): Record<string, unknown> {
    return {
        ...projectLogIdentity(log),
        message: log.message,
        context: log.context ?? null
    };
}

/**
 * Build the three read-only log tools bound to the given service.
 *
 * @param logService - The SystemLogService singleton the handlers read through.
 * @returns Array of tool definitions ready for `registerTool`.
 */
function buildTools(logService: SystemLogService): IAiTool[] {
    const queryTool: IAiTool = {
        name: AI_TOOL_NAMES.queryLogs,
        description:
            'Query the TronRelic system logs with filtering and cursor pagination, newest entries first. ' +
            'Use this to investigate errors, warnings, or activity from a specific service or time window — ' +
            'e.g. "what errors happened in the last hour?" or "show warnings from plugin:whale-alerts". ' +
            'Returns { logs, nextCursor, hasMore, note }: a page of log entries (id, timestamp, level, service, message, error), ' +
            'and when hasMore is true, a nextCursor string. To read the next (older) page, call again with the same filters ' +
            'and cursor set to nextCursor, unchanged. Entries written after the first page never shift later pages. ' +
            'No total count is returned; use ' + AI_TOOL_NAMES.getStatistics + ' for counts. ' +
            `Returns ${DEFAULT_QUERY_LIMIT} entries per page by default, up to ${MAX_QUERY_LIMIT} with \`limit\`. ` +
            'This list view omits each entry\'s context payload (stack traces, request details, plugin metadata). ' +
            `\`error\` is the entry's error text shortened to ${LIST_ERROR_MAX_CHARS} characters, or null when it has none, ` +
            `and \`message\` is shortened to ${LIST_MESSAGE_MAX_CHARS} characters. ` +
            'You must call ' + AI_TOOL_NAMES.getLog + ' with an entry id to obtain its full context. ' +
            'Defaults to error and warn levels only; pass `levels` explicitly to widen. ' +
            'Service names can be discovered via ' + AI_TOOL_NAMES.getStatistics + '. This tool is read-only.',
        // Capability: read / secret / surfaces-untrusted — log context can carry
        // secrets and attacker-influenced strings. Governor redacts the audit
        // and rate-limits; this tool is a trifecta private-data + untrusted leg.
        capability: { sideEffect: 'read', reversible: true, sensitivity: 'secret', surfacesUntrustedContent: true },
        inputSchema: {
            type: 'object',
            description: 'Optional filters and pagination for the log query',
            properties: {
                levels: {
                    type: 'array',
                    items: { type: 'string', enum: [...VALID_LEVELS] },
                    description: 'Severity levels to include. Defaults to ["error","warn"] when omitted.'
                },
                service: {
                    type: 'string',
                    description: 'Filter to one service or plugin id (e.g. "blockchain", "plugin:whale-alerts"). Omit for all services.'
                },
                startTime: {
                    type: 'string',
                    description: 'ISO 8601 timestamp; only logs at or after this time are returned. Omit for no lower bound.'
                },
                endTime: {
                    type: 'string',
                    description: 'ISO 8601 timestamp; only logs at or before this time are returned. Omit for no upper bound.'
                },
                cursor: {
                    type: 'string',
                    description: 'The nextCursor value from the previous page, passed back unchanged. Omit to start from the newest entry.'
                },
                limit: {
                    type: 'integer',
                    minimum: 1,
                    maximum: MAX_QUERY_LIMIT,
                    description: `Entries per page. Defaults to ${DEFAULT_QUERY_LIMIT}, capped at ${MAX_QUERY_LIMIT}.`
                }
            },
            required: [],
            additionalProperties: false
        },
        inputExamples: [
            {},
            { levels: ['error', 'fatal'], service: 'plugin:whale-alerts', startTime: '2026-06-09T00:00:00Z' },
            { levels: ['error', 'warn'], limit: 200, cursor: 'eyJ0IjoiMjAyNi0wNi0wOVQwMTowMDowMC4wMDBaIiwiaWRzIjpbImFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYSJdfQ' }
        ],
        handler: async (input) => {
            let levels: LogLevel[] = ['error', 'warn'];
            if (Array.isArray(input.levels) && input.levels.length > 0) {
                const invalid = input.levels.filter(level => !VALID_LEVELS.includes(level as LogLevel));
                if (invalid.length > 0) {
                    throw new Error(`Invalid levels: ${invalid.join(', ')}. Valid levels: ${VALID_LEVELS.join(', ')}`);
                }
                levels = input.levels as LogLevel[];
            }

            const limit = Math.min(
                Math.max(1, Number(input.limit) || DEFAULT_QUERY_LIMIT),
                MAX_QUERY_LIMIT
            );

            const result = await logService.getLogsByCursor({
                levels,
                service: typeof input.service === 'string' && input.service.length > 0 ? input.service : undefined,
                startDate: parseIsoDate(input.startTime, 'startTime'),
                endDate: parseIsoDate(input.endTime, 'endTime'),
                before: decodeCursor(input.cursor),
                limit
            });

            return {
                logs: result.logs.map(projectLogSummary),
                nextCursor: result.next ? encodeCursor(result.next) : null,
                hasMore: result.next !== null,
                note: LIST_DETAIL_NOTE
            };
        }
    };

    const getTool: IAiTool = {
        name: AI_TOOL_NAMES.getLog,
        description:
            'Fetch one TronRelic system log entry by its id, returning the complete record including the ' +
            'full context payload (error stacks, request details, plugin metadata) without truncation. ' +
            'Use this after ' + AI_TOOL_NAMES.queryLogs + ' surfaces an entry worth drilling into. ' +
            'Returns null when no entry exists for the id. This tool is read-only.',
        // Capability: read / secret / surfaces-untrusted — returns the full,
        // untruncated context payload, the most sensitive log surface.
        capability: { sideEffect: 'read', reversible: true, sensitivity: 'secret', surfacesUntrustedContent: true },
        inputSchema: {
            type: 'object',
            description: 'Identifier of the log entry to fetch',
            properties: {
                id: {
                    type: 'string',
                    description: 'The 24-character hex id of the log entry, as returned by ' + AI_TOOL_NAMES.queryLogs + '.'
                }
            },
            required: ['id'],
            additionalProperties: false
        },
        handler: async (input) => {
            const id = String(input.id ?? '');
            if (!OBJECT_ID_PATTERN.test(id)) {
                throw new Error(`Parameter "id" must be a 24-character hex log id, got: ${id}`);
            }
            const log = await logService.getLogById(id);
            return log ? projectLogDetail(log) : null;
        }
    };

    const statsTool: IAiTool = {
        name: AI_TOOL_NAMES.getStatistics,
        description:
            'Get aggregate statistics over the TronRelic system logs: total entry count, counts per severity ' +
            'level (trace through fatal), and counts per service/plugin. ' +
            'Use this first when asked about overall system health, and to discover valid `service` values for ' +
            AI_TOOL_NAMES.queryLogs + '. Counts are cached for up to 30 seconds. ' +
            'Takes no parameters. This tool is read-only.',
        // Capability: read / internal — aggregate counts only, no log content,
        // so it is neither a secret nor an untrusted-content surface.
        capability: { sideEffect: 'read', reversible: true, sensitivity: 'internal' },
        inputSchema: {
            type: 'object',
            description: 'No parameters',
            properties: {},
            required: [],
            additionalProperties: false
        },
        handler: async () => {
            const stats = await logService.getStatistics();
            return {
                total: stats.total,
                byLevel: stats.byLevel,
                byService: stats.byService
            };
        }
    };

    return [queryTool, getTool, statsTool];
}

/**
 * Watch the service registry for the core `'ai-tools'` registry and register
 * the log tools whenever it becomes available.
 *
 * Each tool is unregistered before registration so re-availability
 * (operator churn, hot reload) never trips the duplicate-name guard in
 * `registerTool`. Registration failures are logged and swallowed — AI tooling
 * is optional capability and must never take the logs module down.
 *
 * @param serviceRegistry - Shared service registry to watch.
 * @param logService - SystemLogService singleton backing the tool handlers.
 * @param logger - Module-scoped logger for registration telemetry.
 * @returns Disposer that removes the watch subscription.
 */
export function registerLogAiTools(
    serviceRegistry: IServiceRegistry,
    logService: SystemLogService,
    logger: ISystemLogService
): ServiceWatchDisposer {
    const tools = buildTools(logService);

    return serviceRegistry.watch<IAiToolRegistry>('ai-tools', {
        onAvailable: (registry) => {
            try {
                for (const tool of tools) {
                    registry.unregisterTool(tool.name);
                    registry.registerTool(tool, PROVIDER_ID);
                }
                logger.info({ tools: tools.map(tool => tool.name) }, 'Registered log AI tools with the core ai-tools registry');
            } catch (error) {
                logger.error({ error }, 'Failed to register log AI tools with the core ai-tools registry');
            }
        }
    });
}
