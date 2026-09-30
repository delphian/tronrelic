/**
 * @fileoverview Verifies access tokens presented to the MCP endpoint.
 *
 * The identity module holds the OAuth signing keys, so it performs the check
 * and hands the MCP module only the verified claims. Verification is local:
 * the signing keys are read from the auth instance in the same process and
 * cached, so no HTTP request is made per call.
 *
 * A token passes only when all of these hold:
 * - its signature matches a current signing key,
 * - its `typ` header is `at+jwt` (an access token, not some other JWT),
 * - its issuer is this server and its audience is the MCP resource URL, so a
 *   token minted for any other resource is refused,
 * - it has not expired,
 * - it is not bound to a DPoP key, which this endpoint does not support,
 * - the user's grant to the app still exists, so a revoked app stops working
 *   before its access tokens expire, and the token was issued no earlier than
 *   that grant, so reconnecting an app does not revive tokens from before a
 *   revocation.
 *
 * The signing keys are read from the store at most once per
 * `JWKS_REFETCH_COOLDOWN_MS`, so a token naming an unknown key id cannot force
 * a database read on every request.
 */

import { verifyJwsAccessToken } from 'better-auth/oauth2';
import type { IConnectedAppsService, IMcpAccessTokenClaims, IMcpAccessTokenVerifier, ISystemLogService } from '@/types';

/**
 * A function that returns the current signing key set. Taken from Better
 * Auth's own signature rather than importing `jose`, which this project only
 * receives as a transitive dependency.
 */
export type JwksSource = Extract<Parameters<typeof verifyJwsAccessToken>[1]['jwksFetch'], () => unknown>;

/** The signing key set a `JwksSource` resolves to. */
type Jwks = Awaited<ReturnType<JwksSource>>;

/**
 * Shortest time between two reads of the signing key set from the store.
 *
 * Better Auth reads the keys again whenever a token names a key id (the `kid`
 * header) that is not in its cache. That header comes from the token before
 * its signature is checked, so anyone can send tokens with random key ids,
 * and without this limit each one would cost a database read. During the
 * cooldown the last key set read is reused, so a forged key id fails as an
 * unknown key instead of reaching the store. Thirty seconds matches the
 * default `cooldownDuration` of `createRemoteJWKSet` in the `jose` library.
 */
export const JWKS_REFETCH_COOLDOWN_MS = 30_000;

/**
 * Verifies MCP access tokens against the local OAuth server.
 */
export class OAuthAccessTokenVerifier implements IMcpAccessTokenVerifier {
    /**
     * Stable object the JWKS cache is keyed on. Better Auth caches the key set
     * for a few minutes under it and refetches when a token names an unknown
     * key id, which is how a key rotation is picked up. Those refetches go
     * through `readKeys`, which limits how often they reach the store.
     */
    private readonly jwksCacheKey = {};

    /** The key set from the last successful read, reused during the cooldown. */
    private lastKeys: Jwks | undefined;

    /** When `lastKeys` was read, in milliseconds since the epoch. */
    private lastKeysReadAt = 0;

    /**
     * The read in progress, if any. Requests that arrive while the store is
     * being read wait on this one read instead of each starting their own.
     */
    private pendingRead: Promise<Jwks> | undefined;

    /**
     * @param getJwks - Reads the current signing key set from the auth instance.
     * @param expected - The issuer and audience every token must carry.
     * @param grants - The connected-apps store, used to confirm the grant is live.
     * @param logger - Module logger, used at debug level for refused tokens.
     */
    constructor(
        private readonly getJwks: JwksSource,
        private readonly expected: { issuer: string; audience: string },
        private readonly grants: Pick<IConnectedAppsService, 'hasGrant'>,
        private readonly logger: ISystemLogService
    ) {}

    /**
     * Check a bearer token and return its claims, or null when it is not a
     * valid token for the MCP endpoint.
     *
     * Only the signature check turns an error into null. The grant lookup runs
     * outside it, so a database failure propagates to the caller instead of
     * being reported as a bad token. Reporting it as a bad token would answer
     * `401 invalid_token`, which tells a client to throw its token away and
     * start the sign-in flow again during what is only a brief outage.
     *
     * @param token - The raw bearer token from the `Authorization` header.
     * @returns The verified claims, or null when the token is not acceptable.
     * @throws When the grant store or the signing keys cannot be read.
     */
    async verify(token: string): Promise<IMcpAccessTokenClaims | null> {
        let claims: IMcpAccessTokenClaims | null = null;
        const payload = await this.verifySignature(token);
        if (payload) {
            const userId = typeof payload.sub === 'string' ? payload.sub : '';
            const clientId = typeof payload.client_id === 'string' ? payload.client_id : typeof payload.azp === 'string' ? payload.azp : undefined;
            const boundToKey = payload.cnf !== undefined;
            // Passing `iat` refuses a token issued under an earlier grant that
            // was revoked, even after the user reconnects the same app.
            const issuedAt = typeof payload.iat === 'number' ? payload.iat : undefined;
            const grantLive = userId !== '' && clientId !== undefined && !boundToKey && await this.grants.hasGrant(userId, clientId, issuedAt);
            if (grantLive) {
                claims = {
                    userId,
                    clientId,
                    scopes: typeof payload.scope === 'string' ? payload.scope.split(' ').filter(scope => scope.length > 0) : [],
                    ...(typeof payload.jti === 'string' ? { tokenId: payload.jti } : {}),
                    ...(typeof payload.exp === 'number' ? { expiresAt: payload.exp } : {})
                };
            } else {
                this.logger.debug({ userId, clientId, boundToKey, grantLive }, 'MCP access token refused after signature check');
            }
        }
        return claims;
    }

    /**
     * Check the token's signature, type, issuer, audience, and expiry.
     *
     * These failures are routine (an expired token is how refresh starts), so
     * each one becomes null and is logged quietly rather than thrown. A failure
     * to read the signing keys is different: it says nothing about the token,
     * so it is rethrown for the caller to answer as a temporary outage, the
     * same way a failed grant lookup is.
     *
     * @param token - The raw bearer token.
     * @returns The verified payload, or null when any of those checks fails.
     * @throws When the signing key set cannot be read.
     */
    private async verifySignature(token: string): Promise<Awaited<ReturnType<typeof verifyJwsAccessToken>> | null> {
        let payload: Awaited<ReturnType<typeof verifyJwsAccessToken>> | null = null;
        let keysUnreadable = false;
        /**
         * Read the signing keys, noting when the read itself fails so that
         * failure can be told apart from a token that does not verify.
         *
         * @returns The current signing key set.
         * @throws Whatever the key store threw.
         */
        const jwksFetch = (async () => {
            try {
                return await this.readKeys();
            } catch (error: unknown) {
                keysUnreadable = true;
                throw error;
            }
        }) as JwksSource;
        try {
            payload = await verifyJwsAccessToken(token, {
                jwksFetch,
                jwksCacheKey: this.jwksCacheKey,
                verifyOptions: { issuer: this.expected.issuer, audience: this.expected.audience, typ: 'at+jwt' }
            });
        } catch (error: unknown) {
            if (keysUnreadable) {
                throw error;
            }
            this.logger.debug({ reason: error instanceof Error ? error.message : String(error) }, 'MCP access token failed verification');
        }
        return payload;
    }

    /**
     * Read the signing key set, but reach the store no more than once per
     * `JWKS_REFETCH_COOLDOWN_MS`.
     *
     * Within the cooldown the last key set read is returned unchanged. After
     * it, one read goes to the store and every request arriving meanwhile waits
     * on that same read. Only a successful read starts a new cooldown, so a
     * failed read is retried by the next request rather than hidden.
     *
     * @returns The current key set, or the last one read while the cooldown runs.
     * @throws Whatever the key store threw.
     */
    private async readKeys(): Promise<Jwks> {
        let keys: Jwks;
        if (this.lastKeys !== undefined && Date.now() - this.lastKeysReadAt < JWKS_REFETCH_COOLDOWN_MS) {
            keys = this.lastKeys;
        } else {
            if (this.pendingRead === undefined) {
                /**
                 * Read the store once and remember any key set it returns, so the
                 * cooldown starts from the moment the keys were known good.
                 *
                 * @returns The key set the store returned.
                 * @throws Whatever the key store threw.
                 */
                const read = async (): Promise<Jwks> => {
                    const fresh = await this.getJwks();
                    if (fresh !== undefined) {
                        this.lastKeys = fresh;
                        this.lastKeysReadAt = Date.now();
                    }
                    return fresh;
                };
                this.pendingRead = read().finally(
                    /**
                     * Clear the pending read whether it succeeded or failed, so
                     * the next request after a failure tries the store again.
                     * Chained with `finally()` rather than written inside `read`
                     * so it always runs after `pendingRead` has been assigned.
                     */
                    () => {
                        this.pendingRead = undefined;
                    }
                );
            }
            keys = await this.pendingRead;
        }
        return keys;
    }
}
