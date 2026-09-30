/**
 * @file MCP_OAUTH_SCOPES.ts
 *
 * The full list of OAuth scopes a connected app should request for the MCP
 * endpoint.
 */

import { MCP_TOOLS_SCOPE } from './MCP_TOOLS_SCOPE.js';

/**
 * Every scope the authorization server offers to MCP clients, in one list so
 * the server that grants them and the endpoint that advertises them cannot
 * drift apart.
 *
 * `mcp:tools` is what the endpoint requires. `offline_access` is the standard
 * OAuth scope that makes the server issue a refresh token. Clients pick their
 * scopes from what the endpoint advertises, so leaving it out of the
 * advertised list means no refresh token, and the user has to sign in again
 * each time the 15-minute access token expires.
 */
export const MCP_OAUTH_SCOPES: readonly string[] = [MCP_TOOLS_SCOPE, 'offline_access'];
