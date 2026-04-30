/// <reference types="vitest" />

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ICacheService, ISystemLogService } from '@/types';
import { UserService } from '../services/user.service.js';
import { TrafficService } from '../services/traffic.service.js';
import { createMockDatabaseService } from '../../../tests/vitest/mocks/database-service.js';

vi.mock('../../auth/signature.service.js', () => ({
    SignatureService: class {
        normalizeAddress(a: string) { return a; }
        async verifyMessage(a: string) { return a; }
    }
}));

// Don't mock WalletChallengeService — its `buildMessage` is a pure static
// helper used by both the production code and these tests. Instead, swap
// the singleton's instance methods after UserService boots so `issue` and
// `consume` are deterministic without depending on Redis.

class MockCache implements ICacheService {
    private store = new Map<string, any>();
    async get<T>(k: string) { return (this.store.get(k) ?? null) as T | null; }
    async set<T>(k: string, v: T) { this.store.set(k, v); }
    async del(k: string) { return this.store.delete(k) ? 1 : 0; }
    async invalidate() { /* unused */ }
    async keys() { return []; }
}

class NullLogger implements ISystemLogService {
    info() {} warn() {} error() {} debug() {} trace() {} fatal() {}
    child(): ISystemLogService { return this; }
    async initialize() {} async saveLog() {}
    async getLogs() { return { logs: [], total: 0, page: 1, limit: 50, totalPages: 0, hasNextPage: false, hasPrevPage: false }; }
    async markAsResolved() {} async markAsUnresolved() { return null; }
    async cleanup() { return 0; }
    async getStatistics(): Promise<any> { return { total: 0, byLevel: {}, byService: {}, unresolved: 0 }; }
    async getLogById() { return null; }
    async deleteAllLogs() { return 0; }
    async getStats(): Promise<any> { return { total: 0, byLevel: {}, resolved: 0, unresolved: 0 }; }
    level = 'info';
}

const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000';
const ADDRESS = 'TXyzAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

/**
 * Phase 4 of the traffic-events split centralizes "create the row if a
 * cookie-validated write needs one" in `UserService.ensureExists`. These
 * tests assert two invariants that together fence off the orphan-row bug
 * fixed in Phase 2 from regressing as more endpoints learn to upsert:
 *
 *   1. Cookie-validated *write* endpoints (`connectWallet`, `linkWallet`,
 *      `issueWalletChallenge`, `updatePreferences`) auto-create the row
 *      when bootstrap left none.
 *   2. Endpoints that operate on existing wallets (`setPrimaryWallet`,
 *      `unlinkWallet`, `refreshWalletVerification`) and observability
 *      writes (`recordPage`, `heartbeat`, `endSession`, `recordActivity`,
 *      `logout`) do NOT create rows — they fail loudly or no-op.
 *
 * Together with `start-session.test.ts` (Phase 3) and `bootstrap.controller.test.ts`
 * (Phase 2), these make the visitor-lifecycle persistence story bisectable
 * end-to-end.
 */
describe('UserService.ensureExists (Phase 4)', () => {
    let mockDb: ReturnType<typeof createMockDatabaseService>;
    let mockCache: MockCache;
    let userService: UserService;

    beforeEach(() => {
        mockDb = createMockDatabaseService();
        mockCache = new MockCache();
        UserService.resetInstance();
        TrafficService.resetInstance();
        TrafficService.setDependencies(undefined, new NullLogger());
        UserService.setDependencies(
            mockDb,
            mockCache,
            new NullLogger(),
            {
                getSiteUrl: async () => 'http://localhost:3000',
                getConfig: async () => ({ siteUrl: 'http://localhost:3000' }),
                updateConfig: async (u: any) => u,
                clearCache: () => {}
            } as any,
            {} as any
        );
        userService = UserService.getInstance();
    });

    describe('row-creating helper', () => {
        it('creates an anonymous row when none exists', async () => {
            const collection = mockDb.getCollection('users');
            expect(await collection.findOne({ id: VALID_UUID })).toBeNull();

            const doc = await userService.ensureExists(VALID_UUID);
            expect(doc.id).toBe(VALID_UUID);
            expect(doc.identityState).toBe('anonymous');
            expect(doc.wallets).toEqual([]);

            const persisted = await collection.findOne({ id: VALID_UUID });
            expect(persisted).not.toBeNull();
        });

        it('returns the existing row without re-inserting', async () => {
            await userService.ensureExists(VALID_UUID);
            const collection = mockDb.getCollection('users');
            const before = await collection.findOne({ id: VALID_UUID });

            const second = await userService.ensureExists(VALID_UUID);
            const after = await collection.findOne({ id: VALID_UUID });

            expect(second.id).toBe(VALID_UUID);
            // The mock database doesn't expose `_id`, but a re-insert would
            // change `createdAt`. The race-safe path resolves to the
            // existing row, so timestamps must be stable.
            expect(after?.createdAt).toEqual(before?.createdAt);
        });

        it('rejects malformed UUIDs', async () => {
            await expect(userService.ensureExists('not-a-uuid')).rejects.toThrow(/Invalid UUID/);
        });
    });

    describe('writes that auto-create rows', () => {
        it('connectWallet creates a row for a fresh cookie holder', async () => {
            const collection = mockDb.getCollection('users');
            expect(await collection.findOne({ id: VALID_UUID })).toBeNull();

            const result = await userService.connectWallet(VALID_UUID, ADDRESS);
            expect(result.success).toBe(true);

            const persisted = await collection.findOne({ id: VALID_UUID });
            expect(persisted).not.toBeNull();
            expect(persisted?.wallets).toHaveLength(1);
            expect(persisted?.wallets[0].address).toBe(ADDRESS);
            expect(persisted?.identityState).toBe('registered');
        });

        it('issueWalletChallenge creates a row for a fresh cookie holder', async () => {
            const collection = mockDb.getCollection('users');
            expect(await collection.findOne({ id: VALID_UUID })).toBeNull();

            const challenge = await userService.issueWalletChallenge(VALID_UUID, 'link', ADDRESS);
            expect(challenge.message).toContain(ADDRESS);

            const persisted = await collection.findOne({ id: VALID_UUID });
            expect(persisted).not.toBeNull();
        });

        it('updatePreferences creates a row for a fresh cookie holder', async () => {
            const collection = mockDb.getCollection('users');
            expect(await collection.findOne({ id: VALID_UUID })).toBeNull();

            const user = await userService.updatePreferences(VALID_UUID, { theme: 'dark' as any });
            expect(user.preferences).toMatchObject({ theme: 'dark' });

            const persisted = await collection.findOne({ id: VALID_UUID });
            expect(persisted?.preferences).toMatchObject({ theme: 'dark' });
        });

        it('linkWallet completes for a fresh cookie holder without prior session/start', async () => {
            // End-to-end Phase 4 invariant for the wallet flow: a brand-new
            // cookie holder who skipped session/start (e.g. cross-browser
            // login) can mint a challenge and verify a wallet without any
            // intermediate "must register identity first" step. The signature
            // mock returns the address verbatim so verification passes.
            const collection = mockDb.getCollection('users');
            expect(await collection.findOne({ id: VALID_UUID })).toBeNull();

            const challenge = await userService.issueWalletChallenge(VALID_UUID, 'link', ADDRESS);

            const result = await userService.linkWallet(VALID_UUID, {
                address: ADDRESS,
                message: challenge.message,
                signature: ADDRESS,
                nonce: challenge.nonce
            });
            expect(result.user.id).toBe(VALID_UUID);

            const persisted = await collection.findOne({ id: VALID_UUID });
            expect(persisted).not.toBeNull();
            expect(persisted?.wallets[0].verified).toBe(true);
        });
    });

    describe('writes that do NOT auto-create rows', () => {
        it('setPrimaryWallet still throws without a pre-existing row', async () => {
            await expect(
                userService.setPrimaryWallet(VALID_UUID, ADDRESS, 'msg', 'sig', 'nonce')
            ).rejects.toThrow();

            // Row must not have been created.
            const collection = mockDb.getCollection('users');
            expect(await collection.findOne({ id: VALID_UUID })).toBeNull();
        });

        it('unlinkWallet still throws without a pre-existing row', async () => {
            await expect(
                userService.unlinkWallet(VALID_UUID, ADDRESS, 'msg', 'sig', 'nonce')
            ).rejects.toThrow();

            const collection = mockDb.getCollection('users');
            expect(await collection.findOne({ id: VALID_UUID })).toBeNull();
        });

        it('refreshWalletVerification still throws without a pre-existing row', async () => {
            await expect(
                userService.refreshWalletVerification(VALID_UUID, ADDRESS, 'msg', 'sig', 'nonce')
            ).rejects.toThrow();

            const collection = mockDb.getCollection('users');
            expect(await collection.findOne({ id: VALID_UUID })).toBeNull();
        });

        it('logout returns ephemeral payload without creating a row', async () => {
            const collection = mockDb.getCollection('users');
            expect(await collection.findOne({ id: VALID_UUID })).toBeNull();

            const result = await userService.logout(VALID_UUID);
            expect(result.id).toBe(VALID_UUID);
            expect(result.identityState).toBe('anonymous');

            // No row created.
            expect(await collection.findOne({ id: VALID_UUID })).toBeNull();
        });

        it('observability methods silently no-op without a pre-existing row', async () => {
            const collection = mockDb.getCollection('users');
            expect(await collection.findOne({ id: VALID_UUID })).toBeNull();

            // None of these should throw or create a row.
            await userService.recordActivity(VALID_UUID);
            await userService.recordPage(VALID_UUID, '/markets');
            await userService.heartbeat(VALID_UUID);
            await userService.endSession(VALID_UUID);

            expect(await collection.findOne({ id: VALID_UUID })).toBeNull();
        });
    });
});
