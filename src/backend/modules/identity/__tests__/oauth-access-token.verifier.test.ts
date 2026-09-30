/**
 * @fileoverview Tests for the MCP access token verifier: the issuer and
 * audience it demands, DPoP-bound tokens refused, revoked grants refused,
 * claims mapped for the MCP module, and the cooldown that keeps forged key ids
 * from reaching the key store on every request.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const verifyJwsAccessToken = vi.fn();

vi.mock('better-auth/oauth2', () => ({
    verifyJwsAccessToken: (...args: unknown[]) => verifyJwsAccessToken(...args)
}));

import { OAuthAccessTokenVerifier, JWKS_REFETCH_COOLDOWN_MS } from '../services/oauth-access-token.verifier.js';

/** A silent logger. */
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn() } as any;

/** The issuer and audience the verifier is configured with. */
const EXPECTED = { issuer: 'https://tronrelic.test', audience: 'https://tronrelic.test/mcp' };

describe('OAuthAccessTokenVerifier', () => {
    beforeEach(() => {
        verifyJwsAccessToken.mockReset();
    });

    it('demands the configured issuer, the MCP audience, and the access-token type', async () => {
        verifyJwsAccessToken.mockResolvedValue({ sub: 'u1', client_id: 'c1', scope: 'mcp:tools', jti: 'j1', exp: 123 });
        const verifier = new OAuthAccessTokenVerifier(async () => ({ keys: [] }), EXPECTED, { hasGrant: async () => true }, logger);
        await verifier.verify('token');
        expect(verifyJwsAccessToken).toHaveBeenCalledWith('token', expect.objectContaining({
            verifyOptions: { issuer: EXPECTED.issuer, audience: EXPECTED.audience, typ: 'at+jwt' }
        }));
    });

    it('maps a valid token to claims', async () => {
        verifyJwsAccessToken.mockResolvedValue({ sub: 'u1', client_id: 'c1', scope: 'mcp:tools offline_access', jti: 'j1', exp: 123 });
        const verifier = new OAuthAccessTokenVerifier(async () => ({ keys: [] }), EXPECTED, { hasGrant: async () => true }, logger);
        expect(await verifier.verify('token')).toEqual({ userId: 'u1', clientId: 'c1', scopes: ['mcp:tools', 'offline_access'], tokenId: 'j1', expiresAt: 123 });
    });

    it('refuses a token whose signature, issuer, audience, or expiry fails', async () => {
        verifyJwsAccessToken.mockRejectedValue(new Error('unexpected "aud" claim value'));
        const verifier = new OAuthAccessTokenVerifier(async () => ({ keys: [] }), EXPECTED, { hasGrant: async () => true }, logger);
        expect(await verifier.verify('token')).toBeNull();
    });

    it('refuses a DPoP-bound token', async () => {
        verifyJwsAccessToken.mockResolvedValue({ sub: 'u1', client_id: 'c1', scope: 'mcp:tools', cnf: { jkt: 'x' } });
        const verifier = new OAuthAccessTokenVerifier(async () => ({ keys: [] }), EXPECTED, { hasGrant: async () => true }, logger);
        expect(await verifier.verify('token')).toBeNull();
    });

    it('refuses a token whose grant was revoked', async () => {
        verifyJwsAccessToken.mockResolvedValue({ sub: 'u1', client_id: 'c1', scope: 'mcp:tools' });
        const verifier = new OAuthAccessTokenVerifier(async () => ({ keys: [] }), EXPECTED, { hasGrant: async () => false }, logger);
        expect(await verifier.verify('token')).toBeNull();
    });

    it('lets a grant-store failure propagate instead of calling the token invalid', async () => {
        verifyJwsAccessToken.mockResolvedValue({ sub: 'u1', client_id: 'c1', scope: 'mcp:tools' });
        const verifier = new OAuthAccessTokenVerifier(
            async () => ({ keys: [] }),
            EXPECTED,
            { hasGrant: async () => { throw new Error('database down'); } },
            logger
        );
        await expect(verifier.verify('token')).rejects.toThrow('database down');
    });

    it('lets a key-store failure propagate instead of calling the token invalid', async () => {
        verifyJwsAccessToken.mockImplementation(readKeysThenReject);
        const verifier = new OAuthAccessTokenVerifier(
            async () => { throw new Error('key store down'); },
            EXPECTED,
            { hasGrant: async () => true },
            logger
        );
        await expect(verifier.verify('token')).rejects.toThrow('key store down');
    });

    describe('signing key reads', () => {
        afterEach(() => {
            vi.useRealTimers();
        });

        it('reads the key store at most once per cooldown however many unknown key ids arrive', async () => {
            vi.useFakeTimers();
            verifyJwsAccessToken.mockImplementation(readKeysThenReject);
            const getJwks = vi.fn(async () => ({ keys: [] }));
            const verifier = new OAuthAccessTokenVerifier(getJwks, EXPECTED, { hasGrant: async () => true }, logger);
            for (let i = 0; i < 5; i++) {
                expect(await verifier.verify(`forged-${i}`)).toBeNull();
            }
            expect(getJwks).toHaveBeenCalledTimes(1);

            vi.advanceTimersByTime(JWKS_REFETCH_COOLDOWN_MS);
            await verifier.verify('forged-after-cooldown');
            expect(getJwks).toHaveBeenCalledTimes(2);
        });

        it('shares one key-store read between requests that arrive together', async () => {
            verifyJwsAccessToken.mockImplementation(readKeysThenReject);
            const getJwks = vi.fn(async () => ({ keys: [] }));
            const verifier = new OAuthAccessTokenVerifier(getJwks, EXPECTED, { hasGrant: async () => true }, logger);
            await Promise.all([verifier.verify('a'), verifier.verify('b'), verifier.verify('c')]);
            expect(getJwks).toHaveBeenCalledTimes(1);
        });

        it('does not start a cooldown after a failed read, so the next request tries the store again', async () => {
            verifyJwsAccessToken.mockImplementation(readKeysThenReject);
            const getJwks = vi.fn()
                .mockRejectedValueOnce(new Error('key store down'))
                .mockResolvedValue({ keys: [] });
            const verifier = new OAuthAccessTokenVerifier(getJwks, EXPECTED, { hasGrant: async () => true }, logger);
            await expect(verifier.verify('first')).rejects.toThrow('key store down');
            expect(await verifier.verify('second')).toBeNull();
            expect(getJwks).toHaveBeenCalledTimes(2);
        });
    });
});

/**
 * Stand-in for Better Auth's verifier that reads the key set, the way it does
 * for a token naming a key id it has not cached, and then refuses the token.
 * Lets the tests count how often a forged token reaches the key store.
 *
 * @param _token - The token under test; unused because the outcome is fixed.
 * @param opts - The options the verifier passed, carrying its `jwksFetch`.
 * @returns Nothing; the promise always rejects.
 * @throws The key-store error when the read fails, otherwise a no-matching-key error.
 */
async function readKeysThenReject(_token: string, opts: { jwksFetch: () => Promise<unknown> }): Promise<never> {
    await opts.jwksFetch();
    throw new Error('no applicable key found in the JSON Web Key Set');
}
