/**
 * @file McpEndpointKind.ts
 *
 * The two MCP endpoints a call can arrive through.
 */

/**
 * Which MCP endpoint a call arrived through.
 *
 * - `oauth` — `/mcp`, where every caller signs in with OAuth and must be a
 *   member of `mcp-users`.
 * - `public` — `/mcp/public`, which takes no sign-in and serves only the tools
 *   granted to the `anonymous` group.
 *
 * The two are separate URLs because MCP clients start their sign-in flow when
 * a request is refused with 401. A single endpoint that served anonymous
 * callers could never send that 401, so members would never be asked to sign
 * in and could not reach their own tools.
 */
export type McpEndpointKind = 'oauth' | 'public';
