/**
 * @fileoverview Totals the ClickHouse `mcp_calls` table for the usage view on
 * `/system/mcp`.
 *
 * The view starts lean, with endpoint totals and one line per group, and opens
 * one level at a time: a group's tools and callers, then (on the admin page,
 * through the governor's audit feed) the individual calls. Each level is one
 * small grouped query, so no level reads more than it shows.
 *
 * When ClickHouse is not configured, or the table has not been created yet
 * (its migration is operator-run), the reports say so with `available: false`
 * rather than showing an empty report as if nothing had happened.
 */

import type {
    IAccountDirectoryService,
    IClickHouseService,
    IMcpUsageCallerRow,
    IMcpUsageFigures,
    IMcpUsageGroupDetail,
    IMcpUsageGroupRow,
    IMcpUsageReport,
    IMcpUsageToolRow,
    ISystemLogService,
    McpUsageWindow
} from '@/types';
import { MCP_ANONYMOUS_GROUP_ID, MCP_USERS_GROUP_ID } from '@/types';
import { parseClickHouseDateTime64Utc } from '../../../lib/parseClickHouseDateTime64Utc.js';
import { MCP_CALLS_TABLE } from './McpCallMeter.js';
import type { McpGroupPolicyService } from './McpGroupPolicyService.js';

/** Hours each window covers. */
const WINDOW_HOURS: Record<McpUsageWindow, number> = { '24h': 24, '7d': 168, '30d': 720 };

/** Most tool and caller rows one group detail returns. */
const DETAIL_ROW_LIMIT = 100;

/**
 * The aggregate columns every usage query selects, so every level of the view
 * counts the same way. `ran` counts calls whose tool actually ran, which is
 * what the run-time percentile is taken over.
 */
const FIGURE_COLUMNS = `
    count() AS calls,
    countIf(outcome = 'succeeded') AS succeeded,
    countIf(outcome = 'refused') AS refused,
    countIf(limit_hit != '') AS limited,
    countIf(outcome = 'failed') AS failed,
    uniqExact(principal_kind, principal_id) AS callers,
    countIf(status IN ('ok', 'error')) AS ran,
    quantileIf(0.95)(duration_ms, status IN ('ok', 'error')) AS p95,
    sum(cost_usd) AS cost`;

/** Filter on the report window, shared by every query. */
const WINDOW_FILTER = 'timestamp >= now64(3) - INTERVAL {hours:UInt32} HOUR';

/**
 * Matches only the calls that actually spent a group's shared 24-hour pool,
 * which is what the pool badge on `/system/mcp` measures against the group's
 * `callsPerDayGroup` ceiling. The governor charges the pool last, so a call
 * refused by the caller's own minute or day window, a call the MCP floor or
 * the tool allowlist refused before any budget ran, and a tool that was never
 * served all leave the pool untouched; counting them would let one noisy
 * caller show an exhausted pool while nearly all of it is still available. A
 * call the tool-minute, global-minute, or cost window refused had already
 * been charged to the pool, and so had a `pool-day` refusal itself, because
 * each counter is incremented before it is compared.
 */
const POOL_CHARGED_FILTER = `(status IN ('ok', 'error') OR limit_hit IN ('tool-minute', 'global-minute', 'cost', 'pool-day'))`;

/** The aggregate columns as ClickHouse returns them; 64-bit counts arrive as strings. */
interface IFigureColumns {
    calls: string | number;
    succeeded: string | number;
    refused: string | number;
    limited: string | number;
    failed: string | number;
    callers: string | number;
    ran: string | number;
    p95: string | number | null;
    cost: string | number;
}

/** Error thrown for a report request the service cannot answer. */
export class McpUsageError extends Error {
    /**
     * @param message - Sentence explaining the refusal, returned to the admin.
     * @param status - HTTP status the controller should answer with.
     */
    constructor(message: string, readonly status: 400 | 404) {
        super(message);
        this.name = 'McpUsageError';
    }
}

/**
 * Reads MCP usage totals for the admin page.
 */
export class McpUsageService {
    /**
     * @param clickhouse - The ClickHouse service, or undefined when ClickHouse
     *   is not configured.
     * @param policies - Group settings, for each group's switch and pool limit
     *   and to list groups that have been charged nothing yet.
     * @param accounts - Account directory, to label signed-in callers by email.
     * @param logger - Module logger.
     */
    constructor(
        private readonly clickhouse: IClickHouseService | undefined,
        private readonly policies: McpGroupPolicyService,
        private readonly accounts: Pick<IAccountDirectoryService, 'getAccountsByIds'>,
        private readonly logger: ISystemLogService
    ) {}

    /**
     * Endpoint totals and one line per group over a window.
     *
     * Groups appear when they were charged a call in the window, and
     * `mcp-users` and `anonymous` always appear, so the two groups that decide
     * who can reach the endpoint are on screen even on a quiet day.
     *
     * @param window - How far back to look.
     * @returns The report, with `available: false` when the table cannot be read.
     */
    async report(window: McpUsageWindow): Promise<IMcpUsageReport> {
        const { windowStart, windowEnd } = windowBounds(window);
        const groups = await this.policies.listGroups();
        const policyById = new Map(groups.map(group => [group.id, group.policy]));
        let report: IMcpUsageReport = {
            window, windowStart, windowEnd, available: false,
            totals: emptyFigures(),
            groups: []
        };
        const read = await this.readOrExplain(async () => {
            const params = { hours: WINDOW_HOURS[window] };
            const [totals, perGroup] = await Promise.all([
                this.clickhouse!.query<IFigureColumns>(`SELECT ${FIGURE_COLUMNS} FROM ${MCP_CALLS_TABLE} WHERE ${WINDOW_FILTER}`, params),
                this.clickhouse!.query<IFigureColumns & { charged_group: string; last24: string | number }>(
                    `SELECT charged_group, ${FIGURE_COLUMNS},
                            countIf(timestamp >= now64(3) - INTERVAL 24 HOUR AND ${POOL_CHARGED_FILTER}) AS last24
                     FROM ${MCP_CALLS_TABLE} WHERE ${WINDOW_FILTER}
                     GROUP BY charged_group ORDER BY calls DESC`,
                    params
                )
            ]);
            return { totals: totals[0], perGroup };
        });
        if (read.ok) {
            const seen = new Set(read.value.perGroup.map(row => row.charged_group));
            const rows: IMcpUsageGroupRow[] = read.value.perGroup.map(row => {
                const policy = policyById.get(row.charged_group);
                return {
                    groupId: row.charged_group,
                    ...toFigures(row),
                    callsLast24h: Number(row.last24),
                    poolCallsPerDay: policy?.limits.callsPerDayGroup ?? null,
                    enabled: policy?.enabled ?? true
                };
            });
            for (const groupId of [MCP_USERS_GROUP_ID, MCP_ANONYMOUS_GROUP_ID]) {
                const policy = policyById.get(groupId);
                if (!seen.has(groupId) && policy) {
                    rows.push({ groupId, ...emptyFigures(), callsLast24h: 0, poolCallsPerDay: policy.limits.callsPerDayGroup, enabled: policy.enabled });
                }
            }
            report = { ...report, available: true, totals: read.value.totals ? toFigures(read.value.totals) : emptyFigures(), groups: rows };
        } else {
            report = { ...report, unavailableReason: read.reason };
        }
        return report;
    }

    /**
     * One group's tools and busiest callers over a window.
     *
     * @param groupId - The group to open.
     * @param window - How far back to look.
     * @param toolName - When set, the callers list counts only this tool's calls.
     * @returns The detail, with `available: false` when the table cannot be read.
     * @throws {McpUsageError} 404 when the group does not exist and was never charged.
     */
    async groupDetail(groupId: string, window: McpUsageWindow, toolName: string | null): Promise<IMcpUsageGroupDetail> {
        if (!(await this.policies.groupExists(groupId))) {
            throw new McpUsageError(`User group "${groupId}" does not exist.`, 404);
        }
        const { windowStart, windowEnd } = windowBounds(window);
        let detail: IMcpUsageGroupDetail = { window, windowStart, windowEnd, available: false, groupId, toolName, tools: [], callers: [] };
        const read = await this.readOrExplain(async () => {
            const params = { hours: WINDOW_HOURS[window], group: groupId, tool: toolName ?? '', limit: DETAIL_ROW_LIMIT };
            const [tools, callers] = await Promise.all([
                this.clickhouse!.query<IFigureColumns & { tool: string }>(
                    `SELECT tool, ${FIGURE_COLUMNS} FROM ${MCP_CALLS_TABLE}
                     WHERE charged_group = {group:String} AND ${WINDOW_FILTER}
                     GROUP BY tool ORDER BY calls DESC LIMIT {limit:UInt32}`,
                    params
                ),
                this.clickhouse!.query<IFigureColumns & { principal_kind: string; principal_id: string; last_call: string; client_names: string[] }>(
                    `SELECT principal_kind, principal_id, ${FIGURE_COLUMNS},
                            max(timestamp) AS last_call, topK(3)(client_name) AS client_names
                     FROM ${MCP_CALLS_TABLE}
                     WHERE charged_group = {group:String} AND ${WINDOW_FILTER}
                       AND ({tool:String} = '' OR tool = {tool:String})
                     GROUP BY principal_kind, principal_id ORDER BY calls DESC LIMIT {limit:UInt32}`,
                    params
                )
            ]);
            return { tools, callers };
        });
        if (read.ok) {
            const toolRows: IMcpUsageToolRow[] = read.value.tools.map(row => ({ toolName: row.tool, ...toFigures(row) }));
            const labels = await this.labelsFor(read.value.callers.filter(row => row.principal_kind === 'user').map(row => row.principal_id));
            const callerRows: IMcpUsageCallerRow[] = read.value.callers.map(row => ({
                principalKind: row.principal_kind,
                principalId: row.principal_id,
                label: labels.get(row.principal_id) ?? shortLabel(row.principal_kind, row.principal_id),
                clientNames: (row.client_names ?? []).filter(name => name.length > 0),
                lastCallAt: parseClickHouseDateTime64Utc(row.last_call).toISOString(),
                ...toFigures(row)
            }));
            detail = { ...detail, available: true, tools: toolRows, callers: callerRows };
        }
        return detail;
    }

    /**
     * Run the ClickHouse reads for a report, turning the two expected failures
     * into a sentence for the page.
     *
     * A missing ClickHouse service and a missing table are both normal states
     * a deployment can be in, and each has a fix an admin can act on. Any other
     * failure is unexpected and is thrown, so the controller answers a 500 and
     * the real error reaches the logs.
     *
     * @param read - The queries to run once ClickHouse is known to be present.
     * @returns The queries' result, or the reason the report is unavailable.
     */
    private async readOrExplain<T>(read: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; reason: string }> {
        let outcome: { ok: true; value: T } | { ok: false; reason: string };
        if (!this.clickhouse) {
            outcome = { ok: false, reason: 'ClickHouse is not configured on this deployment, so MCP calls are not being counted.' };
        } else {
            try {
                outcome = { ok: true, value: await read() };
            } catch (error: unknown) {
                if (!isMissingTableError(error)) {
                    throw error;
                }
                this.logger.warn('MCP usage requested before the mcp_calls table exists');
                outcome = { ok: false, reason: 'The mcp_calls table does not exist yet. Run the migration module:mcp:002_create_mcp_calls_table from /system/database.' };
            }
        }
        return outcome;
    }

    /**
     * Look up email addresses for signed-in callers in one query.
     *
     * A failed lookup is logged and leaves the short labels in place, because
     * the figures matter more than the names beside them.
     *
     * @param userIds - Better Auth user ids.
     * @returns Email addresses keyed by user id, for the accounts that exist.
     */
    private async labelsFor(userIds: string[]): Promise<Map<string, string>> {
        const labels = new Map<string, string>();
        if (userIds.length > 0) {
            try {
                for (const account of await this.accounts.getAccountsByIds(userIds)) {
                    labels.set(account.id, account.email);
                }
            } catch (error: unknown) {
                this.logger.warn({ err: error }, 'Could not label MCP callers with their email addresses');
            }
        }
        return labels;
    }
}

/**
 * Parse a window name sent by the admin page.
 *
 * @param value - The raw query parameter.
 * @returns The window, defaulting to 24 hours when absent.
 * @throws {McpUsageError} 400 when the value names no known window.
 */
export function parseUsageWindow(value: unknown): McpUsageWindow {
    let window: McpUsageWindow;
    if (value === undefined || value === '') {
        window = '24h';
    } else if (value === '24h' || value === '7d' || value === '30d') {
        window = value;
    } else {
        throw new McpUsageError('window must be one of 24h, 7d, or 30d.', 400);
    }
    return window;
}

/** Compute a window's start and end as ISO strings, for the page's heading. */
function windowBounds(window: McpUsageWindow): { windowStart: string; windowEnd: string } {
    const end = new Date();
    const start = new Date(end.getTime() - WINDOW_HOURS[window] * 3_600_000);
    return { windowStart: start.toISOString(), windowEnd: end.toISOString() };
}

/** Figures for a slice with no calls. */
function emptyFigures(): IMcpUsageFigures {
    return { calls: 0, succeeded: 0, refused: 0, limited: 0, failed: 0, callers: 0, p95DurationMs: null, costUsd: 0 };
}

/**
 * Convert ClickHouse's aggregate columns into the page's figures.
 *
 * ClickHouse returns 64-bit counts as strings, and the percentile as NaN when
 * no tool ran, so both are normalised here.
 *
 * @param row - One aggregate row.
 * @returns The figures.
 */
function toFigures(row: IFigureColumns): IMcpUsageFigures {
    const p95 = Number(row.p95);
    return {
        calls: Number(row.calls),
        succeeded: Number(row.succeeded),
        refused: Number(row.refused),
        limited: Number(row.limited),
        failed: Number(row.failed),
        callers: Number(row.callers),
        p95DurationMs: Number(row.ran) > 0 && Number.isFinite(p95) ? Math.round(p95) : null,
        costUsd: Number(row.cost) || 0
    };
}

/**
 * Build the label shown for a caller whose email is unknown: always an id
 * fragment, never an address, because the table stores none.
 */
function shortLabel(kind: string, id: string): string {
    return kind === 'anonymous' ? `Network ${id.slice(0, 8)}` : `Account ${id.slice(0, 8)}`;
}

/**
 * Decide whether a ClickHouse error means the table does not exist yet.
 *
 * @param error - The error a query threw.
 * @returns True for ClickHouse's unknown-table error (code 60).
 */
function isMissingTableError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return /UNKNOWN_TABLE|Code:\s*60\b|doesn't exist|does not exist/i.test(message);
}
