/**
 * @file IMcpAccessTokenClaims.ts
 *
 * The facts the MCP endpoint needs from a verified access token.
 */

/**
 * The verified contents of an MCP access token.
 *
 * Produced only after the token's signature, issuer, audience, and expiry have
 * all been checked, so every field here can be trusted. The MCP module uses
 * `userId` as the end user of each tool call, and copies `clientId` and
 * `tokenId` into the audit record.
 */
export interface IMcpAccessTokenClaims {
    /** Better Auth user id the token was issued to (the `sub` claim). */
    userId: string;

    /** OAuth client id of the connected app that holds the token. */
    clientId?: string;

    /** Scopes granted to the token. */
    scopes: string[];

    /** Token identifier (the `jti` claim), recorded instead of the token itself. */
    tokenId?: string;

    /** Expiry as seconds since the Unix epoch. */
    expiresAt?: number;
}
