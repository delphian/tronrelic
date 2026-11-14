/**
 * @file IMcpUsageGroupRow.ts
 *
 * One group's line in the MCP usage overview.
 */

import type { IMcpUsageFigures } from './IMcpUsageFigures.js';

/**
 * Usage charged to one user group over the report's window, plus how much of
 * its 24-hour pool it has used, so the overview can show at a glance which
 * group is close to its ceiling.
 */
export interface IMcpUsageGroupRow extends IMcpUsageFigures {
    /** The group the calls were charged to. */
    groupId: string;

    /** Calls charged to the group in the last 24 hours, whatever the report's window. */
    callsLast24h: number;

    /** The group's pooled 24-hour limit, or null when it sets none. */
    poolCallsPerDay: number | null;

    /** Whether the group is currently switched on. */
    enabled: boolean;
}
