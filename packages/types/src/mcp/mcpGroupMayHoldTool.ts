/**
 * @file mcpGroupMayHoldTool.ts
 *
 * The rule that decides whether a user group may hold an MCP grant for a tool,
 * shared by the backend (granting and serving) and the admin page (which
 * switches are enabled), so the two can never disagree.
 */

import type { IMcpGroupPolicy } from './IMcpGroupPolicy.js';
import { MCP_USERS_GROUP_ID } from './MCP_USERS_GROUP_ID.js';

/**
 * Decide whether a group may hold a grant for a tool, given whether the tool
 * is restricted.
 *
 * A tool that passes the MCP safety floor may be granted to any group. A
 * restricted tool may be granted only to a group whose policy allows
 * restricted tools, and never to `mcp-users`, because that group is every MCP
 * user. The group id is checked here as well as in policy validation, so a
 * policy document edited by hand cannot open restricted tools to everyone.
 *
 * @param restricted - Whether the tool fails the MCP safety floor
 *   (`getMcpToolIneligibility` returned a reason).
 * @param policy - The group's MCP policy, which carries the group id.
 * @returns True when the group may hold, and be served through, the grant.
 */
export function mcpGroupMayHoldTool(restricted: boolean, policy: IMcpGroupPolicy): boolean {
    return !restricted || (policy.allowRestrictedTools && policy.groupId !== MCP_USERS_GROUP_ID);
}
