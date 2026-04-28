/// <reference types="vitest" />

import { describe, it, expect, beforeEach } from 'vitest';
import type { ICacheService } from '@/types';
import { WalletChallengeService } from '../services/wallet-challenge.service.js';

/**
 * In-memory ICacheService double that mirrors the production semantics the
 * challenge service relies on: TTL is honored well enough for tests, `del()`
 * returns 1 only for the caller that actually removed the key, and `get()`
 * returns the stored value without parsing.
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

    async invalidate(): Promise<void> { /* not used by this test */ }
    async keys(): Promise<string[]> { return []; }

    /** Force expire a key without removing it — simulates Redis TTL elapsing. */
    expireNow(key: string): void {
        const entry = this.store.get(key);
        if (entry) entry.expiresAt = Date.now() - 1;
    }
}

describe('WalletChallengeService', () => {
    const userId = '550e8400-e29b-41d4-a716-446655440000';
    const otherUserId = '660e8400-e29b-41d4-a716-446655440001';
    const address = 'TXyz0000000000000000000000000000AB';
    const otherAddress = 'TXyz9999999999999999999999999999CD';

    let cache: MockCacheService;
    let challenges: WalletChallengeService;

    beforeEach(() => {
        cache = new MockCacheService();
        challenges = new WalletChallengeService(cache);
    });

    describe('issue', () => {
        it('returns a nonce, canonical message, and future expiry', async () => {
            const before = Date.now();
            const result = await challenges.issue(userId, 'link', address);
            const after = Date.now();

            expect(result.nonce).toMatch(/^[a-f0-9]{48}$/);
            expect(result.message).toBe(`TronRelic link wallet ${address} (nonce ${result.nonce})`);
            expect(result.expiresAt).toBeGreaterThanOrEqual(before + WalletChallengeService.TTL_SECONDS * 1000 - 50);
            expect(result.expiresAt).toBeLessThanOrEqual(after + WalletChallengeService.TTL_SECONDS * 1000 + 50);
        });

        it('binds the canonical message to the action verb', async () => {
            const link = await challenges.issue(userId, 'link', address);
            const unlink = await challenges.issue(userId, 'unlink', address);
            const setPrimary = await challenges.issue(userId, 'set-primary', address);

            expect(link.message).toContain('link wallet');
            expect(unlink.message).toContain('unlink wallet');
            expect(setPrimary.message).toContain('set-primary wallet');
        });

        it('rejects unknown actions', async () => {
            await expect(
                challenges.issue(userId, 'evil-action' as any, address)
            ).rejects.toThrow(/Unknown wallet challenge action/);
        });

        it('overwrites a previous unconsumed nonce for the same tuple', async () => {
            const first = await challenges.issue(userId, 'link', address);
            const second = await challenges.issue(userId, 'link', address);

            expect(second.nonce).not.toBe(first.nonce);

            // The first nonce is no longer redeemable — the second overwrote it.
            const firstConsumed = await challenges.consume(userId, 'link', address, first.nonce);
            expect(firstConsumed).toBe(false);

            // The second nonce still works.
            const secondConsumed = await challenges.consume(userId, 'link', address, second.nonce);
            expect(secondConsumed).toBe(true);
        });
    });

    describe('consume', () => {
        it('returns true exactly once per issued nonce', async () => {
            const challenge = await challenges.issue(userId, 'link', address);

            const first = await challenges.consume(userId, 'link', address, challenge.nonce);
            const second = await challenges.consume(userId, 'link', address, challenge.nonce);

            expect(first).toBe(true);
            expect(second).toBe(false);
        });

        it('returns false for an unknown nonce', async () => {
            await challenges.issue(userId, 'link', address);
            const result = await challenges.consume(userId, 'link', address, 'not-the-real-nonce');
            expect(result).toBe(false);
        });

        it('returns false for an expired nonce', async () => {
            const challenge = await challenges.issue(userId, 'link', address);
            cache.expireNow(`user:wallet:challenge:${userId}:link:${address}`);

            const result = await challenges.consume(userId, 'link', address, challenge.nonce);
            expect(result).toBe(false);
        });

        it('refuses to cross the userId scope', async () => {
            const challenge = await challenges.issue(userId, 'link', address);

            const result = await challenges.consume(otherUserId, 'link', address, challenge.nonce);
            expect(result).toBe(false);

            // Original holder can still consume — cross-user attempt did not steal it.
            const owner = await challenges.consume(userId, 'link', address, challenge.nonce);
            expect(owner).toBe(true);
        });

        it('refuses to cross the action scope', async () => {
            const challenge = await challenges.issue(userId, 'unlink', address);

            const wrongAction = await challenges.consume(userId, 'set-primary', address, challenge.nonce);
            expect(wrongAction).toBe(false);

            const correctAction = await challenges.consume(userId, 'unlink', address, challenge.nonce);
            expect(correctAction).toBe(true);
        });

        it('refuses to cross the address scope', async () => {
            const challenge = await challenges.issue(userId, 'link', address);

            const wrongAddress = await challenges.consume(userId, 'link', otherAddress, challenge.nonce);
            expect(wrongAddress).toBe(false);

            const correctAddress = await challenges.consume(userId, 'link', address, challenge.nonce);
            expect(correctAddress).toBe(true);
        });

        it('returns false for an empty nonce string', async () => {
            await challenges.issue(userId, 'link', address);
            const result = await challenges.consume(userId, 'link', address, '');
            expect(result).toBe(false);
        });
    });

    describe('buildMessage', () => {
        it('produces the same canonical form the consumer reconstructs', async () => {
            const challenge = await challenges.issue(userId, 'link', address);
            const reconstructed = WalletChallengeService.buildMessage('link', address, challenge.nonce);
            expect(reconstructed).toBe(challenge.message);
        });
    });
});
