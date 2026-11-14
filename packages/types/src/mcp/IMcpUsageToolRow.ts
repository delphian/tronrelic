/**
 * @file IMcpUsageToolRow.ts
 *
 * One tool's line in a group's MCP usage detail.
 */

import type { IMcpUsageFigures } from './IMcpUsageFigures.js';

/**
 * Usage of one tool by calls charged to one group over the report's window.
 */
export interface IMcpUsageToolRow extends IMcpUsageFigures {
    /** The tool called. */
    toolName: string;
}
