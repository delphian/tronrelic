/**
 * @file McpPrincipalKind.ts
 *
 * The kinds of caller the MCP endpoints can identify.
 */

/**
 * What kind of caller made an MCP request.
 *
 * - `user` — a signed-in account, identified by an OAuth access token on `/mcp`.
 * - `anonymous` — a caller of `/mcp/public` with no credentials, identified
 *   only by a salted hash of its network address.
 *
 * API keys are the planned third kind (`api-key`): a key issued to an
 * account, sent to `/mcp/public`, and charged to the account's groups. It is
 * not part of this union yet, because nothing issues keys. Adding it means
 * adding the member here, an authenticator in the MCP module, and nothing in
 * the accounting table, which already records the kind as a string.
 */
export type McpPrincipalKind = 'user' | 'anonymous';
