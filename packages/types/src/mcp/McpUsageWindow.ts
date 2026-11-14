/**
 * @file McpUsageWindow.ts
 *
 * The time windows the MCP usage view can report over.
 */

/**
 * How far back an MCP usage report looks, counted back from now.
 */
export type McpUsageWindow = '24h' | '7d' | '30d';
