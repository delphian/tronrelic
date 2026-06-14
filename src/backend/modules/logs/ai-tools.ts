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
 * redacted audit record from those classifications; the result/context caps
 * below stay as defense for the model's context window.
 *
 * The legacy `resolved` column is intentionally absent from every tool
 * surface — it is unused and scheduled for removal.
 */

import type {
    IAiTool,
    IAiToolRegistry,
    IServiceRegistry,
    ISystemLogService,
    LogLevel,
    ServiceWatchDisposer
} from '@/types';
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

/** Default page size for the query tool — full entries are verbose, keep the context lean. */
const DEFAULT_QUERY_LIMIT = 20;

/** Hard cap on page size to protect the model's context window. */
const MAX_QUERY_LIMIT = 50;

/** Maximum serialized length of a log entry's context in list view. */
const LIST_CONTEXT_MAX_CHARS = 500;

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
 * Minimal structural shape of a persisted log entry that {@link projectLogEntry}
 * consumes. Declared locally rather than importing the Mongoose-backed
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
 * Project a raw log document into the shape returned to the model,
 * omitting the deprecated `resolved` fields and optionally truncating
 * the context payload for list views.
 *
 * @param log - A persisted log entry; see {@link ILogEntrySource}.
 * @param truncateContext - When true, serialized context is capped at
 *                          {@link LIST_CONTEXT_MAX_CHARS} characters.
 * @returns Plain object safe to JSON-stringify into the tool result.
 */
function projectLogEntry(log: ILogEntrySource, truncateContext: boolean): Record<string, unknown> {
    let context: unknown = log.context ?? null;
    if (truncateContext && context !== null) {
        const serialized = JSON.stringify(context);
        if (serialized.length > LIST_CONTEXT_MAX_CHARS) {
            context = `${serialized.slice(0, LIST_CONTEXT_MAX_CHARS)}… [truncated — use ${AI_TOOL_NAMES.getLog} with id ${String(log._id)} for the full entry]`;
        }
    }
    return {
        id: String(log._id),
        timestamp: log.timestamp,
        level: log.level,
        message: log.message,
        service: log.service,
        context
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
            'Query the TronRelic system logs with filtering and pagination. ' +
            'Use this to investigate errors, warnings, or activity from a specific service or time window — ' +
            'e.g. "what errors happened in the last hour?" or "show warnings from plugin:whale-alerts". ' +
            'Returns a page of log entries (id, timestamp, level, message, service, context) plus pagination metadata. ' +
            'Long context payloads are truncated in this list view — call ' + AI_TOOL_NAMES.getLog + ' with an entry id for the full record. ' +
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
                page: {
                    type: 'integer',
                    minimum: 1,
                    description: 'Page number, 1-indexed. Defaults to 1.'
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
            const page = Math.max(1, Number(input.page) || 1);

            const result = await logService.getLogs({
                levels,
                service: typeof input.service === 'string' && input.service.length > 0 ? input.service : undefined,
                startDate: parseIsoDate(input.startTime, 'startTime'),
                endDate: parseIsoDate(input.endTime, 'endTime'),
                page,
                limit
            });

            return {
                logs: result.logs.map(log => projectLogEntry(log, true)),
                total: result.total,
                page: result.page,
                limit: result.limit,
                totalPages: result.totalPages,
                hasNextPage: result.hasNextPage
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
            if (!/^[a-f0-9]{24}$/i.test(id)) {
                throw new Error(`Parameter "id" must be a 24-character hex log id, got: ${id}`);
            }
            const log = await logService.getLogById(id);
            return log ? projectLogEntry(log, false) : null;
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
