/**
 * @file MCP_ANONYMOUS_GROUP_ID.ts
 *
 * The virtual user group every caller of the public MCP endpoint belongs to.
 */

/**
 * Id of the virtual group that stands for callers who did not sign in.
 *
 * Nobody is a member of it, because an anonymous caller has no account. The
 * MCP module treats every request to the public endpoint (`/mcp/public`) as a
 * caller in this group alone, so an admin grants tools and sets limits for
 * anonymous callers the same way as for any real group on `/system/mcp`.
 *
 * Tool grants and group policies are stored by group id, so the identity
 * module refuses to create a real group with this id. A real group under this
 * name would otherwise inherit every grant meant for anonymous callers.
 */
export const MCP_ANONYMOUS_GROUP_ID = 'anonymous';
