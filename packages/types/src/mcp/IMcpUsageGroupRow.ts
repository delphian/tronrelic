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

    /**
     * Calls that spent the group's shared 24-hour pool in the last 24 hours,
     * whatever the report's window. Refusals that never reached the pool — a
     * caller over its own minute or day limit, a call the MCP floor or the tool
     * allowlist refused, or a tool that was never served — are left out, so
     * this reads as pool use rather than attempts; the row's `calls` figure is
     * the attempt count. It is a rolling 24 hours, while the enforced pool is a
     * fixed 24-hour window started by the group's first call, so it is a close
     * estimate rather than the enforced counter.
     */
    callsLast24h: number;

    /** The group's pooled 24-hour limit, or null when it sets none. */
    poolCallsPerDay: number | null;

    /** Whether the group is currently switched on. */
    enabled: boolean;
}
