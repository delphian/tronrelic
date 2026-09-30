/**
 * @file MCP_USERS_GROUP_ID.ts
 *
 * The user group whose members may connect an AI client over MCP.
 */

/**
 * Id of the user group that gates MCP access.
 *
 * Two components check it independently. The identity module refuses to issue
 * an MCP access token, or to refresh one, for a user outside the group. The
 * MCP module re-checks membership on every request, so removing a user from
 * the group cuts them off within seconds rather than at token expiry. The MCP
 * module creates the group at startup when it does not exist.
 */
export const MCP_USERS_GROUP_ID = 'mcp-users';
