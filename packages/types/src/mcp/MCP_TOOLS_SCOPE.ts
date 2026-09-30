/**
 * @file MCP_TOOLS_SCOPE.ts
 *
 * The OAuth scope that lets a connected app list and call MCP tools.
 */

/**
 * The single OAuth scope the MCP endpoint requires.
 *
 * The identity module offers it at the consent screen, and the MCP module
 * refuses any token that does not carry it. Version 1 exposes read-only tools
 * only, so one narrow scope covers the whole surface; a wildcard or
 * all-access scope is deliberately not offered.
 */
export const MCP_TOOLS_SCOPE = 'mcp:tools';
