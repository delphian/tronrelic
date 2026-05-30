/// <reference types="vitest" />

/**
 * @fileoverview Phase 4 unit tests for {@link WalletService}.
 *
 * Exercises the Better Auth-keyed wallet store against the shared
 * in-memory `createMockDatabaseService` mock plus a minimal cache double
 * (so the internal {@link WalletChallengeService} round-trips). The
 * SignatureService is mocked module-wide — address normalization is
 * identity and signature recovery returns the submitted address — so the
 * tests focus on the store's link/unlink/set-primary/conflict logic and
 * the denormalized `primaryWallet` write onto the BA user row, not on
 * TRON cryptography.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ICacheService, ISystemLogService } from '@/types';
import { WalletService, WALLETS_COLLECTION } from '../services/wallet.service.js';
import { WalletChallengeService } from '../services/wallet-challenge.service.js';
import { AUTH_USERS_COLLECTION } from '../services/auth-constants.js';
import { createMockDatabaseService } from '../../../tests/vitest/mocks/database-service.js';

// Mock SignatureService so unit tests don't need a real TronWeb instance.
// normalizeAddress is identity; verifyMessage echoes the submitted
// address back as the recovered signer (the signature is mock-trusted).
vi.mock('../../auth/signature.service.js', () => {
    return {
        SignatureService: class MockSignatureService {
            normalizeAddress(address: string): string {
                return address;
            }
            async verifyMessage(address: string): Promise<string> {
                return address;
            }
        }
    };
});

/**
 * Minimal in-memory ICacheService double for the challenge round-trip.
 * `del()` returns 1 only for the caller that removed the key, matching
 * the single-use semantics the challenge service relies on.
 */
class MockCacheService implements ICacheService {
    private store = new Map<string, { value: any; expiresAt?: number }>();

    async get<T>(key: string): Promise<T | null> {
        const entry = this.store.get(key);
        if (!entry) return null;
        if (entry.expiresAt && entry.expiresAt < Date.now()) {
            this.store.delete(key);
            return null;
        }
        return entry.value as T;
    }

    async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
        this.store.set(key, {
            value,
            expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : undefined
        });
    }

    async del(key: string): Promise<number> {
        return this.store.delete(key) ? 1 : 0;
    }

    async invalidate(): Promise<void> {}
    async keys(): Promise<string[]> { return []; }
}

/**
 * Stub logger — WalletService only emits info/error breadcrumbs.
 */
class StubLogger implements ISystemLogService {
    public level = 'info';
    info(): void {}
    warn(): void {}
    error(): void {}
    debug(): void {}
    trace(): void {}
    fatal(): void {}
    child(): ISystemLogService { return this; }
    async initialize(): Promise<void> {}
    async saveLog(): Promise<void> {}
    async getLogs(): Promise<any> {
        return { logs: [], total: 0, page: 1, limit: 50, totalPages: 0, hasNextPage: false, hasPrevPage: false };
    }
    async markAsResolved(): Promise<void> {}
    async cleanup(): Promise<number> { return 0; }
    async getStatistics(): Promise<any> { return { total: 0, byLevel: {}, byService: {}, unresolved: 0 }; }
    async getLogById(): Promise<any> { return null; }
    async markAsUnresolved(): Promise<any> { return null; }
    async deleteAllLogs(): Promise<number> { return 0; }
    async getStats(): Promise<any> { return { total: 0, byLevel: {}, resolved: 0, unresolved: 0 }; }
}

const USER_A = 'user_aaa';
const USER_B = 'user_bbb';
const WALLET_1 = 'TWallet1111111111111111111111111111';
const WALLET_2 = 'TWallet2222222222222222222222222222';

describe('WalletService', () => {
    let mockDatabase: ReturnType<typeof createMockDatabaseService>;
    let cache: MockCacheService;
    let service: WalletService;

    /**
     * Mint a challenge through the service and build the signed mutation
     * input a caller would submit. The mock signature service trusts any
     * signature, so a fixed placeholder string suffices.
     */
    async function buildInput(userId: string, action: 'link' | 'unlink' | 'set-primary', address: string) {
        const challenge = await service.issueChallenge(userId, action, address);
        return { address, message: challenge.message, signature: 'sig', nonce: challenge.nonce };
    }

    /** Read the denormalized primaryWallet from the seeded BA user row. */
    function authPrimary(userId: string): string | null | undefined {
        const row = mockDatabase
            .getCollectionData(AUTH_USERS_COLLECTION)
            .find((d: any) => d._id === userId);
        return row ? row.primaryWallet : undefined;
    }

    beforeEach(() => {
        mockDatabase = createMockDatabaseService();
        cache = new MockCacheService();
        // Seed BA user rows so the denormalized primaryWallet write lands.
        mockDatabase.getCollectionData(AUTH_USERS_COLLECTION).push({ _id: USER_A, primaryWallet: null });
        mockDatabase.getCollectionData(AUTH_USERS_COLLECTION).push({ _id: USER_B, primaryWallet: null });
        WalletService.resetForTests();
        WalletService.setDependencies(mockDatabase, cache, new StubLogger(), {} as any);
        service = WalletService.getInstance();
    });

    afterEach(() => {
        WalletService.resetForTests();
        mockDatabase.clear();
    });

    describe('singleton contract', () => {
        it('throws when getInstance() runs before setDependencies()', () => {
            WalletService.resetForTests();
            expect(() => WalletService.getInstance()).toThrow(/setDependencies/i);
        });

        it('keeps the first dependencies on a second setDependencies() call', () => {
            const first = WalletService.getInstance();
            WalletService.setDependencies(createMockDatabaseService(), new MockCacheService(), new StubLogger(), {} as any);
            expect(WalletService.getInstance()).toBe(first);
        });
    });

    describe('linkWallet', () => {
        it('links the first wallet and marks it primary', async () => {
            const wallets = await service.linkWallet(USER_A, await buildInput(USER_A, 'link', WALLET_1));
            expect(wallets).toHaveLength(1);
            expect(wallets[0]).toMatchObject({ address: WALLET_1, isPrimary: true });
            expect(authPrimary(USER_A)).toBe(WALLET_1);
        });

        it('links a second wallet as non-primary and leaves primary unchanged', async () => {
            await service.linkWallet(USER_A, await buildInput(USER_A, 'link', WALLET_1));
            const wallets = await service.linkWallet(USER_A, await buildInput(USER_A, 'link', WALLET_2));
            expect(wallets).toHaveLength(2);
            const second = wallets.find(w => w.address === WALLET_2);
            expect(second?.isPrimary).toBe(false);
            expect(authPrimary(USER_A)).toBe(WALLET_1);
        });

        it('rejects a wallet already linked to another account', async () => {
            await service.linkWallet(USER_A, await buildInput(USER_A, 'link', WALLET_1));
            await expect(
                service.linkWallet(USER_B, await buildInput(USER_B, 'link', WALLET_1))
            ).rejects.toThrow(/already linked to another account/i);
        });

        it('is idempotent when the same account re-links a held wallet', async () => {
            await service.linkWallet(USER_A, await buildInput(USER_A, 'link', WALLET_1));
            const wallets = await service.linkWallet(USER_A, await buildInput(USER_A, 'link', WALLET_1));
            expect(wallets).toHaveLength(1);
            expect(mockDatabase.getCollectionData(WALLETS_COLLECTION)).toHaveLength(1);
        });

        it('rejects a replayed nonce', async () => {
            const input = await buildInput(USER_A, 'link', WALLET_1);
            await service.linkWallet(USER_A, input);
            await expect(service.linkWallet(USER_A, input)).rejects.toThrow(/expired or already used/i);
        });

        it('rejects a tampered (non-canonical) message', async () => {
            const challenge = await service.issueChallenge(USER_A, 'link', WALLET_1);
            await expect(
                service.linkWallet(USER_A, {
                    address: WALLET_1,
                    message: 'not the canonical message',
                    signature: 'sig',
                    nonce: challenge.nonce
                })
            ).rejects.toThrow(/canonical challenge form/i);
        });

        it('recovers from a concurrent-primary duplicate-key race by linking as non-primary', async () => {
            // Simulate the partial { userId, isPrimary:true } unique index
            // rejecting the first insert (a concurrent first-link already
            // claimed primary). The service must catch E11000, find no
            // address dup, and re-insert the wallet as non-primary rather
            // than leaking the raw error.
            const e11000 = Object.assign(new Error('E11000 duplicate key'), { code: 11000 });
            mockDatabase.injectError(WALLETS_COLLECTION, 'insertOne', e11000);

            const wallets = await service.linkWallet(USER_A, await buildInput(USER_A, 'link', WALLET_1));

            expect(wallets).toHaveLength(1);
            expect(wallets[0]).toMatchObject({ address: WALLET_1, isPrimary: false });
            // A non-primary link must not denormalize primaryWallet.
            expect(authPrimary(USER_A)).toBeNull();
        });
    });

    describe('setPrimaryWallet', () => {
        it('moves primary to the chosen wallet', async () => {
            await service.linkWallet(USER_A, await buildInput(USER_A, 'link', WALLET_1));
            await service.linkWallet(USER_A, await buildInput(USER_A, 'link', WALLET_2));

            const wallets = await service.setPrimaryWallet(USER_A, await buildInput(USER_A, 'set-primary', WALLET_2));
            expect(wallets.find(w => w.address === WALLET_2)?.isPrimary).toBe(true);
            expect(wallets.find(w => w.address === WALLET_1)?.isPrimary).toBe(false);
            expect(authPrimary(USER_A)).toBe(WALLET_2);
        });

        it('rejects when the wallet is not linked', async () => {
            await expect(
                service.setPrimaryWallet(USER_A, await buildInput(USER_A, 'set-primary', WALLET_1))
            ).rejects.toThrow(/not linked/i);
        });
    });

    describe('unlinkWallet', () => {
        it('promotes the most recently used remaining wallet when primary is removed', async () => {
            await service.linkWallet(USER_A, await buildInput(USER_A, 'link', WALLET_1));
            await service.linkWallet(USER_A, await buildInput(USER_A, 'link', WALLET_2));
            // WALLET_1 is primary; remove it.
            const wallets = await service.unlinkWallet(USER_A, await buildInput(USER_A, 'unlink', WALLET_1));
            expect(wallets).toHaveLength(1);
            expect(wallets[0]).toMatchObject({ address: WALLET_2, isPrimary: true });
            expect(authPrimary(USER_A)).toBe(WALLET_2);
        });

        it('clears the denormalized primary when the last wallet is removed', async () => {
            await service.linkWallet(USER_A, await buildInput(USER_A, 'link', WALLET_1));
            const wallets = await service.unlinkWallet(USER_A, await buildInput(USER_A, 'unlink', WALLET_1));
            expect(wallets).toHaveLength(0);
            expect(authPrimary(USER_A)).toBeNull();
        });

        it('rejects when the wallet is not linked', async () => {
            await expect(
                service.unlinkWallet(USER_A, await buildInput(USER_A, 'unlink', WALLET_1))
            ).rejects.toThrow(/not linked/i);
        });
    });

    describe('listWallets', () => {
        it('returns an empty array for an account with no wallets', async () => {
            expect(await service.listWallets(USER_A)).toEqual([]);
        });

        it('scopes the list to the requested account', async () => {
            await service.linkWallet(USER_A, await buildInput(USER_A, 'link', WALLET_1));
            await service.linkWallet(USER_B, await buildInput(USER_B, 'link', WALLET_2));
            const aWallets = await service.listWallets(USER_A);
            expect(aWallets).toHaveLength(1);
            expect(aWallets[0].address).toBe(WALLET_1);
        });
    });

    describe('challenge scoping', () => {
        it('does not let one account consume another account nonce', async () => {
            // USER_B mints a challenge for WALLET_2, USER_A tries to use it.
            const challenge = await service.issueChallenge(USER_B, 'link', WALLET_2);
            await expect(
                service.linkWallet(USER_A, {
                    address: WALLET_2,
                    message: challenge.message,
                    signature: 'sig',
                    nonce: challenge.nonce
                })
            ).rejects.toThrow(/expired or already used/i);
        });

        it('builds the canonical message for the action/address/nonce tuple', async () => {
            const challenge = await service.issueChallenge(USER_A, 'link', WALLET_1);
            expect(challenge.message).toBe(
                WalletChallengeService.buildMessage('link', WALLET_1, challenge.nonce)
            );
        });
    });
});
