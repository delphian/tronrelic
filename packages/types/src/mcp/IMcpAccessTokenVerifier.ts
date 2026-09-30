/**
 * @file IMcpAccessTokenVerifier.ts
 *
 * The contract the identity module fulfils so the MCP module can check a
 * bearer token without holding any signing keys itself.
 */

import type { IMcpAccessTokenClaims } from './IMcpAccessTokenClaims.js';

/**
 * Verifies bearer tokens presented to the MCP endpoint.
 *
 * The identity module owns the OAuth authorization server and its signing
 * keys, so it is the only component that can check a token. The MCP module
 * receives this verifier through dependency injection and never parses a
 * token itself.
 */
export interface IMcpAccessTokenVerifier {
    /**
     * Check a bearer token and return its claims, or null when it is not a
     * valid token for the MCP endpoint.
     *
     * A token is rejected when its signature fails, it has expired, its issuer
     * is not this server, or its audience is not the MCP resource URL. A token
     * minted for any other audience must never be accepted here.
     *
     * A failure to read the state the check depends on, such as the grant
     * store, is not a verdict on the token, so it throws rather than returning
     * null. The caller answers it as a temporary outage instead of telling
     * the client its token is invalid.
     *
     * @param token - The raw bearer token from the `Authorization` header.
     * @returns The verified claims, or null when the token is not acceptable.
     * @throws When the state the check depends on cannot be read.
     */
    verify(token: string): Promise<IMcpAccessTokenClaims | null>;
}
