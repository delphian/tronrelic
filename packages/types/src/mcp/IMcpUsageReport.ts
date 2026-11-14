/**
 * @file IMcpUsageReport.ts
 *
 * The top level of the MCP usage view on `/system/mcp`: totals for the whole
 * endpoint and one row per group.
 */

import type { IMcpUsageFigures } from './IMcpUsageFigures.js';
import type { IMcpUsageGroupRow } from './IMcpUsageGroupRow.js';
import type { McpUsageWindow } from './McpUsageWindow.js';

/**
 * MCP usage over one window, from the ClickHouse `mcp_calls` table.
 *
 * `available` is false when ClickHouse is not configured or the table does not
 * exist yet (its migration is run by an operator from `/system/database`); the
 * figures are then zero and the page says why rather than showing an empty
 * report as if nothing had happened.
 */
export interface IMcpUsageReport {
    /** The window asked for. */
    window: McpUsageWindow;

    /** ISO 8601 start of the window. */
    windowStart: string;

    /** ISO 8601 end of the window. */
    windowEnd: string;

    /** Whether the accounting table could be read. */
    available: boolean;

    /** A sentence explaining why the figures are unavailable, when they are. */
    unavailableReason?: string;

    /** Totals across every group. */
    totals: IMcpUsageFigures;

    /** One row per group that was charged at least one call, or is configured with limits, busiest first. */
    groups: IMcpUsageGroupRow[];
}
