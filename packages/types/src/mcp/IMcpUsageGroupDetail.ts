/**
 * @file IMcpUsageGroupDetail.ts
 *
 * The second level of the MCP usage view: one group's tools and callers.
 */

import type { IMcpUsageCallerRow } from './IMcpUsageCallerRow.js';
import type { IMcpUsageToolRow } from './IMcpUsageToolRow.js';
import type { McpUsageWindow } from './McpUsageWindow.js';

/**
 * What one group's calls were spent on, and by whom, over one window.
 *
 * When `toolName` is set, `callers` counts only that tool's calls, which is how
 * an admin goes from "this tool is busy" to "this caller is the one calling
 * it". `tools` always covers every tool, so the selection can be changed
 * without another request.
 */
export interface IMcpUsageGroupDetail {
    /** The window asked for. */
    window: McpUsageWindow;

    /** ISO 8601 start of the window. */
    windowStart: string;

    /** ISO 8601 end of the window. */
    windowEnd: string;

    /** Whether the accounting table could be read. */
    available: boolean;

    /** The group the detail is for. */
    groupId: string;

    /** The tool the callers list is narrowed to, or null for every tool. */
    toolName: string | null;

    /** Every tool called through the group, busiest first, at most 100. */
    tools: IMcpUsageToolRow[];

    /** The busiest callers, at most 100. */
    callers: IMcpUsageCallerRow[];
}
