/// <reference types="vitest" />

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { UserService } from '../services/user.service.js';
import type { ILinkWalletInput } from '../database/IUserDocument.js';
import type { WalletChallengeAction } from '../services/wallet-challenge.service.js';
import { UserIdentityState } from '@/types';
import type { ICacheService, ISystemLogService } from '@/types';
import { createMockDatabaseService } from '../../../tests/vitest/mocks/database-service.js';

/**
 * Mint a real challenge via the service and build the corresponding wallet
 * input. Tests use the production challenge flow (rather than fabricating
 * canonical messages by hand) so any change to the message format or nonce
 * binding is exercised end-to-end.
 */
async function buildWalletInput(
    svc: UserService,
    uuid: string,
    addr: string,
    action: WalletChallengeAction
): Promise<{ message: string; signature: string; nonce: string }> {
    const challenge = await svc.issueWalletChallenge(uuid, action, addr);
    return { message: challenge.message, signature: 'mock-sig', nonce: challenge.nonce };
}

async function buildLinkInput(svc: UserService, uuid: string, addr: string): Promise<ILinkWalletInput> {
    const c = await buildWalletInput(svc, uuid, addr, 'link');
    return { address: addr, ...c };
}

/** Mint a challenge then call linkWallet — collapses the legacy 4-field literal that 20+ tests inlined. */
async function linkWalletWithChallenge(svc: UserService, uuid: string, addr: string) {
    return svc.linkWallet(uuid, await buildLinkInput(svc, uuid, addr));
}

/** Mint a challenge then call unlinkWallet — same role as the link helper for the unlink path. */
async function unlinkWalletWithChallenge(svc: UserService, uuid: string, addr: string) {
    const c = await buildWalletInput(svc, uuid, addr, 'unlink');
    return svc.unlinkWallet(uuid, addr, c.message, c.signature, c.nonce);
}

// Mock SignatureService to avoid TRON address validation in unit tests
vi.mock('../../auth/signature.service.js', () => {
    return {
        SignatureService: class MockSignatureService {
            normalizeAddress(address: string): string {
                return address;
            }
            async verifyMessage(address: string): Promise<string> {
                // Mirror real signature recovery: the recovered address is
                // whatever was passed in (signature is mock-trusted). Older
                // tests pass `walletAddress = 'mocked-address'`, so the
                // historical literal still applies in those cases. New
                // tests can pass any wallet address and have the format
                // check + reconciliation lookup behave consistently.
                return address;
            }
        }
    };
});

/**
 * Mock CacheService for testing Redis operations with tag support.
 */
class MockCacheService implements ICacheService {
    private cache = new Map<string, { value: any; ttl?: number; tags?: string[] }>();

    async get<T = any>(key: string): Promise<T | null> {
        const entry = this.cache.get(key);
        return entry ? entry.value : null;
    }

    async set<T = any>(key: string, value: T, ttl?: number, tags?: string[]): Promise<void> {
        this.cache.set(key, { value, ttl, tags });
    }

    async del(key: string): Promise<number> {
        const deleted = this.cache.delete(key);
        return deleted ? 1 : 0;
    }

    async invalidate(tag: string): Promise<void> {
        const keysToDelete: string[] = [];
        for (const [key, entry] of this.cache.entries()) {
            if (entry.tags && entry.tags.includes(tag)) {
                keysToDelete.push(key);
            }
        }
        for (const key of keysToDelete) {
            this.cache.delete(key);
        }
    }

    async keys(pattern: string): Promise<string[]> {
        const regex = new RegExp(pattern.replace(/\*/g, '.*'));
        return Array.from(this.cache.keys()).filter(k => regex.test(k));
    }

    clear(): void {
        this.cache.clear();
    }
}

/**
 * Mock SystemLogService for testing logging operations.
 */
class MockSystemLogService implements ISystemLogService {
    public logs: Array<{ level: string; message: string; metadata?: any }> = [];
    public level: string = 'info';

    info(messageOrMetadata: string | any, metadataOrMessage?: any): void {
        if (typeof messageOrMetadata === 'string') {
            this.logs.push({ level: 'info', message: messageOrMetadata, metadata: metadataOrMessage });
        } else {
            this.logs.push({ level: 'info', message: metadataOrMessage, metadata: messageOrMetadata });
        }
    }

    warn(messageOrMetadata: string | any, metadataOrMessage?: any): void {
        if (typeof messageOrMetadata === 'string') {
            this.logs.push({ level: 'warn', message: messageOrMetadata, metadata: metadataOrMessage });
        } else {
            this.logs.push({ level: 'warn', message: metadataOrMessage, metadata: messageOrMetadata });
        }
    }

    error(messageOrMetadata: string | any, metadataOrMessage?: any): void {
        if (typeof messageOrMetadata === 'string') {
            this.logs.push({ level: 'error', message: messageOrMetadata, metadata: metadataOrMessage });
        } else {
            this.logs.push({ level: 'error', message: metadataOrMessage, metadata: messageOrMetadata });
        }
    }

    debug(messageOrMetadata: string | any, metadataOrMessage?: any): void {
        if (typeof messageOrMetadata === 'string') {
            this.logs.push({ level: 'debug', message: messageOrMetadata, metadata: metadataOrMessage });
        } else {
            this.logs.push({ level: 'debug', message: metadataOrMessage, metadata: messageOrMetadata });
        }
    }

    trace(messageOrMetadata: string | any, metadataOrMessage?: any): void {
        if (typeof messageOrMetadata === 'string') {
            this.logs.push({ level: 'trace', message: messageOrMetadata, metadata: metadataOrMessage });
        } else {
            this.logs.push({ level: 'trace', message: metadataOrMessage, metadata: messageOrMetadata });
        }
    }

    fatal(messageOrMetadata: string | any, metadataOrMessage?: any): void {
        if (typeof messageOrMetadata === 'string') {
            this.logs.push({ level: 'fatal', message: messageOrMetadata, metadata: metadataOrMessage });
        } else {
            this.logs.push({ level: 'fatal', message: metadataOrMessage, metadata: messageOrMetadata });
        }
    }

    child(bindings: Record<string, any>): ISystemLogService {
        return this;
    }

    async initialize(logger?: any): Promise<void> {}
    async saveLog(data: any): Promise<void> {}
    async getLogs(query: any): Promise<any> {
        return { logs: [], total: 0, page: 1, limit: 50, totalPages: 0, hasNextPage: false, hasPrevPage: false };
    }
    async markAsResolved(logId: string, resolvedBy: string): Promise<void> {}
    async cleanup(): Promise<number> { return 0; }
    async getStatistics(): Promise<any> { return { total: 0, byLevel: {}, byService: {}, unresolved: 0 }; }
    async getLogById(id: string): Promise<any> { return null; }
    async markAsUnresolved(id: string): Promise<any> { return null; }
    async deleteAllLogs(): Promise<number> { return 0; }
    async getStats(): Promise<any> { return { total: 0, byLevel: {}, resolved: 0, unresolved: 0 }; }

    clear(): void {
        this.logs = [];
    }
}

describe('UserService', () => {
    let userService: UserService;
    let mockDatabase: ReturnType<typeof createMockDatabaseService>;
    let mockCache: MockCacheService;
    let mockLogger: MockSystemLogService;

    const validUUID = '550e8400-e29b-41d4-a716-446655440000';
    const validUUID2 = '660e8400-e29b-41d4-a716-446655440001';
    const validUUID3 = '770e8400-e29b-41d4-a716-446655440002';

    beforeEach(() => {
        mockDatabase = createMockDatabaseService();
        mockCache = new MockCacheService();
        mockLogger = new MockSystemLogService();

        // Reset singleton instance
        UserService.resetInstance();

        // Initialize service
        // Mock systemConfig stub: returns a known site URL so the
        // body-vs-header referrer logic in startSession behaves predictably
        // under tests without needing the real SystemConfigService.
        const mockSystemConfig = {
            getSiteUrl: async () => 'http://localhost:3000',
            getConfig: async () => ({ siteUrl: 'http://localhost:3000' } as any),
            updateConfig: async (u: any) => ({ siteUrl: 'http://localhost:3000', ...u } as any),
            clearCache: () => { /* no-op */ }
        };
        UserService.setDependencies(mockDatabase, mockCache, mockLogger, mockSystemConfig as any, {} as any);
        userService = UserService.getInstance();
    });

    afterEach(() => {
        mockDatabase.clear();
        mockCache.clear();
        mockLogger.clear();
    });

    describe('Singleton Pattern', () => {
        it('should return the same instance on multiple calls', () => {
            const instance1 = UserService.getInstance();
            const instance2 = UserService.getInstance();

            expect(instance1).toBe(instance2);
        });

        it('should throw error if getInstance called before setDependencies', () => {
            UserService.resetInstance();

            expect(() => UserService.getInstance()).toThrow(
                'UserService.setDependencies() must be called before getInstance()'
            );
        });
    });

    describe('getOrCreate', () => {
        it('should create a new user with default values', async () => {
            const user = await userService.getOrCreate(validUUID);

            expect(user.id).toBe(validUUID);
            expect(user.wallets).toEqual([]);
            expect(user.preferences).toEqual({});
            expect(user.activity.pageViews).toBe(0);
            expect(user.activity.sessionsCount).toBe(0);
            expect(user.createdAt).toBeInstanceOf(Date);
        });

        it('should return existing user if already exists', async () => {
            // Create first
            const user1 = await userService.getOrCreate(validUUID);

            // Clear cache to force database lookup
            mockCache.clear();

            // Get again
            const user2 = await userService.getOrCreate(validUUID);

            expect(user2.id).toBe(user1.id);
            expect(user2.createdAt.getTime()).toBe(user1.createdAt.getTime());
        });

        it('should return cached user on subsequent calls', async () => {
            // Create and cache
            await userService.getOrCreate(validUUID);

            // Clear database to prove we're using cache
            mockDatabase.clear();

            // Should still work from cache
            const user = await userService.getOrCreate(validUUID);
            expect(user.id).toBe(validUUID);
        });

        it('should reject invalid UUID format', async () => {
            await expect(userService.getOrCreate('not-a-uuid')).rejects.toThrow(
                'Invalid UUID format'
            );
        });

        it('should reject UUID v1 format', async () => {
            const v1UUID = '550e8400-e29b-11d4-a716-446655440000'; // v1

            await expect(userService.getOrCreate(v1UUID)).rejects.toThrow(
                'Invalid UUID format'
            );
        });
    });

    describe('getById', () => {
        it('should return user by UUID', async () => {
            await userService.getOrCreate(validUUID);
            mockCache.clear();

            const user = await userService.getById(validUUID);

            expect(user).toBeDefined();
            expect(user?.id).toBe(validUUID);
        });

        it('should return null for non-existent UUID', async () => {
            const user = await userService.getById(validUUID);

            expect(user).toBeNull();
        });

        it('should return null for invalid UUID format', async () => {
            const user = await userService.getById('invalid');

            expect(user).toBeNull();
        });
    });

    describe('updatePreferences', () => {
        it('should update user preferences', async () => {
            await userService.getOrCreate(validUUID);

            const updated = await userService.updatePreferences(validUUID, {
                theme: 'dark-theme-uuid',
                notifications: true
            });

            expect(updated.preferences.theme).toBe('dark-theme-uuid');
            expect(updated.preferences.notifications).toBe(true);
        });

        it('should merge preferences with existing values', async () => {
            await userService.getOrCreate(validUUID);
            await userService.updatePreferences(validUUID, { theme: 'theme-1' });
            const updated = await userService.updatePreferences(validUUID, { notifications: false });

            expect(updated.preferences.theme).toBe('theme-1');
            expect(updated.preferences.notifications).toBe(false);
        });

        it('upserts an anonymous row for a non-existent user (Phase 4)', async () => {
            // Phase 4 of the traffic-events split: cookie-validated writes
            // route through `ensureExists`, so a fresh cookie holder who
            // updates preferences before any session/start gets a row
            // synthesised on the fly. The pre-Phase-4 behaviour was a
            // 400-mapped throw — now it persists the deliberate user
            // choice. See PLAN-traffic-events.md.
            const updated = await userService.updatePreferences(validUUID, { theme: 'theme-1' });
            expect(updated.preferences.theme).toBe('theme-1');

            const persisted = await userService.getById(validUUID);
            expect(persisted).not.toBeNull();
            expect(persisted?.preferences.theme).toBe('theme-1');
        });

        it('should invalidate cache after update', async () => {
            await userService.getOrCreate(validUUID);

            // Verify cache exists
            let cached = await mockCache.get(`user:${validUUID}`);
            expect(cached).toBeDefined();

            // Update
            await userService.updatePreferences(validUUID, { theme: 'new' });

            // Cache should be invalidated
            cached = await mockCache.get(`user:${validUUID}`);
            expect(cached).toBeNull();
        });
    });

    describe('logout', () => {
        it('downgrades verified user to registered and clears identityVerifiedAt', async () => {
            await userService.getOrCreate(validUUID);
            const linkResult = await linkWalletWithChallenge(userService, validUUID, 'TXyz123456789');
            expect(linkResult.user.identityState).toBe(UserIdentityState.Verified);
            expect(linkResult.user.identityVerifiedAt).not.toBeNull();
            mockCache.clear();

            const loggedOut = await userService.logout(validUUID);

            expect(loggedOut.identityState).toBe(UserIdentityState.Registered);
            expect(loggedOut.identityVerifiedAt).toBeNull();
        });

        it('downgrades to anonymous when no wallets remain', async () => {
            await userService.getOrCreate(validUUID);
            mockCache.clear();

            const loggedOut = await userService.logout(validUUID);

            expect(loggedOut.identityState).toBe(UserIdentityState.Anonymous);
            expect(loggedOut.identityVerifiedAt).toBeNull();
        });

        it('preserves wallets after logout', async () => {
            await userService.getOrCreate(validUUID);
            await userService.connectWallet(validUUID, 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb');
            mockCache.clear();

            const beforeLogout = await userService.getById(validUUID);
            expect(beforeLogout?.wallets.length).toBe(1);

            await userService.logout(validUUID);
            mockCache.clear();

            const afterLogout = await userService.getById(validUUID);
            expect(afterLogout?.wallets.length).toBe(1);
            expect(afterLogout?.identityState).toBe(UserIdentityState.Registered);
            expect(afterLogout?.identityVerifiedAt).toBeNull();
        });

        it('returns ephemeral payload for non-existent user without writing (Phase 4)', async () => {
            // Phase 4 of the traffic-events split: logout from an ephemeral
            // cookie (no Mongo row yet) is semantically a no-op — there is
            // nothing to downgrade. The pre-Phase-4 throw forced any
            // hand-rolled client to call `/session/start` first; now the
            // service synthesises the same anonymous payload `bootstrap`
            // returns, without persisting. See PLAN-traffic-events.md.
            const result = await userService.logout(validUUID);
            expect(result.id).toBe(validUUID);
            expect(result.identityState).toBe(UserIdentityState.Anonymous);
            expect(result.identityVerifiedAt).toBeNull();

            // No Mongo row should have been spawned.
            expect(await userService.getById(validUUID)).toBeNull();
        });

        it('invalidates cache after logout', async () => {
            await userService.getOrCreate(validUUID);
            await userService.connectWallet(validUUID, 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb');

            await userService.getById(validUUID);
            let cached = await mockCache.get(`user:${validUUID}`);
            expect(cached).toBeDefined();

            await userService.logout(validUUID);

            cached = await mockCache.get(`user:${validUUID}`);
            expect(cached).toBeNull();
        });

        it('logs the logout action', async () => {
            await userService.getOrCreate(validUUID);
            mockLogger.clear();

            await userService.logout(validUUID);

            const infoLogs = mockLogger.logs.filter(l => l.level === 'info');
            const hasLogoutLog = infoLogs.some(l => l.message?.includes('logged out'));
            expect(hasLogoutLog).toBe(true);
        });
    });

    describe('recordActivity', () => {
        it('should increment page views', async () => {
            await userService.getOrCreate(validUUID);
            const initial = await userService.getById(validUUID);

            await userService.recordActivity(validUUID);
            mockCache.clear();

            const updated = await userService.getById(validUUID);

            expect(updated!.activity.pageViews).toBe(initial!.activity.pageViews + 1);
        });

        it('should not throw on non-existent user', async () => {
            // Should complete without error (fire-and-forget)
            await expect(userService.recordActivity(validUUID)).resolves.not.toThrow();
        });
    });

    describe('setPrimaryWallet', () => {
        // Valid TRON address format: 34 characters, starts with T, base58 encoded
        const validTronAddress = 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb';

        it('should throw error if user not found', async () => {
            await expect(
                userService.setPrimaryWallet(validUUID, validTronAddress, 'msg', 'sig', 'nonce')
            ).rejects.toThrow('User with id');
        });

        it('should throw error if wallet not linked', async () => {
            await userService.getOrCreate(validUUID);
            const c = await buildWalletInput(userService, validUUID, validTronAddress, 'set-primary');

            await expect(
                userService.setPrimaryWallet(validUUID, validTronAddress, c.message, c.signature, c.nonce)
            ).rejects.toThrow('Wallet is not linked to this user');
        });

        it('rejects an expired or already-consumed challenge', async () => {
            await userService.getOrCreate(validUUID);
            // Wallet must be linked so the failure surfaces from the challenge,
            // not the wallet-existence check.
            const collection = mockDatabase.getCollection('users');
            await collection.updateOne(
                { id: validUUID },
                { $set: {
                    wallets: [{ address: validTronAddress, linkedAt: new Date(), isPrimary: true, verified: true, verifiedAt: new Date(), lastUsed: new Date() }]
                } }
            );

            const c = await buildWalletInput(userService, validUUID, validTronAddress, 'set-primary');
            // First call consumes the nonce successfully.
            await userService.setPrimaryWallet(validUUID, validTronAddress, c.message, c.signature, c.nonce);
            // Second call with the same nonce must fail — single-use guarantee.
            await expect(
                userService.setPrimaryWallet(validUUID, validTronAddress, c.message, c.signature, c.nonce)
            ).rejects.toThrow(/Wallet challenge expired or already used/);
        });

        it('rejects a tampered canonical message', async () => {
            await userService.getOrCreate(validUUID);
            const c = await buildWalletInput(userService, validUUID, validTronAddress, 'set-primary');
            await expect(
                userService.setPrimaryWallet(validUUID, validTronAddress, 'TronRelic set-primary wallet evil (nonce x)', c.signature, c.nonce)
            ).rejects.toThrow(/canonical challenge form/);
        });
    });

    describe('Admin Operations', () => {
        beforeEach(async () => {
            // Create multiple users
            await userService.getOrCreate(validUUID);
            await userService.getOrCreate(validUUID2);
        });

        describe('listUsers', () => {
            it('should return paginated users', async () => {
                const users = await userService.listUsers(10, 0);

                expect(users.length).toBe(2);
            });

            it('should respect limit parameter', async () => {
                const users = await userService.listUsers(1, 0);

                expect(users.length).toBe(1);
            });
        });

        describe('searchUsers', () => {
            it('should find users by partial UUID', async () => {
                const users = await userService.searchUsers('550e8400');

                expect(users.length).toBe(1);
                expect(users[0].id).toBe(validUUID);
            });

            it('should return empty array for no matches', async () => {
                const users = await userService.searchUsers('nonexistent');

                expect(users).toEqual([]);
            });
        });

        describe('getStats', () => {
            it('should return user statistics', async () => {
                const stats = await userService.getStats();

                expect(stats.totalUsers).toBe(2);
                expect(stats.usersWithWallets).toBe(0);
                expect(stats.totalWalletLinks).toBe(0);
                expect(stats.activeToday).toBeGreaterThanOrEqual(0);
                expect(stats.activeThisWeek).toBeGreaterThanOrEqual(0);
                expect(stats.averageWalletsPerUser).toBe(0);
            });
        });

        describe('countUsers', () => {
            it('should return total user count', async () => {
                const count = await userService.countUsers();

                expect(count).toBe(2);
            });
        });
    });

    describe('createIndexes', () => {
        it('should create indexes without error', async () => {
            await expect(userService.createIndexes()).resolves.not.toThrow();

            // Verify info log
            const infoLogs = mockLogger.logs.filter(l => l.level === 'info');
            const hasIndexLog = infoLogs.some(l => l.message?.includes('indexes'));
            expect(hasIndexLog).toBe(true);
        });
    });

    describe('Identity Reconciliation', () => {
        const walletAddress = 'mocked-address';
        const otherWallet = 'other-wallet';

        describe('merge pointer resolution', () => {
            it('getById should follow mergedInto pointer to canonical user', async () => {
                // Create two users
                await userService.getOrCreate(validUUID);
                await userService.getOrCreate(validUUID2);

                // Manually create tombstone: validUUID merged into validUUID2
                const collection = mockDatabase.getCollection('users');
                await collection.updateOne(
                    { id: validUUID },
                    { $set: { mergedInto: validUUID2, wallets: [] } }
                );
                mockCache.clear();

                // Lookup by merged UUID should return canonical user
                const user = await userService.getById(validUUID);

                expect(user).not.toBeNull();
                expect(user!.id).toBe(validUUID2);
            });

            it('getOrCreate should follow mergedInto pointer to canonical user', async () => {
                await userService.getOrCreate(validUUID);
                await userService.getOrCreate(validUUID2);

                const collection = mockDatabase.getCollection('users');
                await collection.updateOne(
                    { id: validUUID },
                    { $set: { mergedInto: validUUID2, wallets: [] } }
                );
                mockCache.clear();

                // getOrCreate with merged UUID should return canonical user, not create new
                const user = await userService.getOrCreate(validUUID);

                expect(user.id).toBe(validUUID2);
            });

            it('getById should return null for broken merge pointer', async () => {
                await userService.getOrCreate(validUUID);

                // Point to non-existent UUID
                const collection = mockDatabase.getCollection('users');
                await collection.updateOne(
                    { id: validUUID },
                    { $set: { mergedInto: validUUID3 } }
                );
                mockCache.clear();

                const user = await userService.getById(validUUID);

                expect(user).toBeNull();
            });

            it('getOrCreate should log error and return tombstone for broken merge pointer', async () => {
                await userService.getOrCreate(validUUID);

                // Point to non-existent UUID
                const collection = mockDatabase.getCollection('users');
                await collection.updateOne(
                    { id: validUUID },
                    { $set: { mergedInto: validUUID3 } }
                );
                mockCache.clear();
                mockLogger.clear();

                // Should return the tombstone (degraded but reachable) instead of
                // creating a new user or throwing
                const user = await userService.getOrCreate(validUUID);
                expect(user.id).toBe(validUUID);

                // Should log an error for operator visibility
                const errorLogs = mockLogger.logs.filter(l => l.level === 'error');
                const hasBrokenPointerLog = errorLogs.some(l =>
                    l.message?.includes('Broken merge pointer')
                );
                expect(hasBrokenPointerLog).toBe(true);
            });

            it('getOrCreate should follow pointer even when cache is empty', async () => {
                await userService.getOrCreate(validUUID);
                const canonical = await userService.getOrCreate(validUUID2);

                const collection = mockDatabase.getCollection('users');
                await collection.updateOne(
                    { id: validUUID },
                    { $set: { mergedInto: validUUID2, wallets: [] } }
                );
                mockCache.clear();
                mockDatabase.getCollection('users'); // ensure no stale refs

                const resolved = await userService.getOrCreate(validUUID);
                expect(resolved.id).toBe(canonical.id);
            });
        });

        describe('connectWallet - cross-UUID conflict detection', () => {
            it('should return loginRequired when wallet belongs to another user', async () => {
                // User A owns wallet
                await userService.getOrCreate(validUUID);
                await userService.connectWallet(validUUID, walletAddress);

                // User B tries to claim same wallet
                await userService.getOrCreate(validUUID2);
                const result = await userService.connectWallet(validUUID2, walletAddress);

                expect(result.success).toBe(false);
                expect(result.loginRequired).toBe(true);
                expect(result.existingUserId).toBe(validUUID);
            });

            it('should allow reconnecting own wallet without loginRequired', async () => {
                await userService.getOrCreate(validUUID);
                await userService.connectWallet(validUUID, walletAddress);

                // Same user reconnects same wallet
                const result = await userService.connectWallet(validUUID, walletAddress);

                expect(result.success).toBe(true);
                expect(result.loginRequired).toBeUndefined();
            });
        });

        describe('linkWallet - identity swap', () => {
            it('should transfer wallets from loser to winner', async () => {
                // User A (winner) has walletAddress
                await userService.getOrCreate(validUUID);
                await userService.connectWallet(validUUID, walletAddress);

                // User B (loser) has otherWallet
                await userService.getOrCreate(validUUID2);
                await userService.connectWallet(validUUID2, otherWallet);

                // User B proves ownership of walletAddress → swap
                const result = await linkWalletWithChallenge(userService, validUUID2, walletAddress);

                expect(result.identitySwapped).toBe(true);
                expect(result.previousUserId).toBe(validUUID2);
                expect(result.user.id).toBe(validUUID);

                // Winner should have both wallets
                const winnerWalletAddresses = result.user.wallets.map(w => w.address);
                expect(winnerWalletAddresses).toContain(walletAddress);
                expect(winnerWalletAddresses).toContain(otherWallet);
            });

            it('should mark disputed wallet as verified on winner', async () => {
                await userService.getOrCreate(validUUID);
                await userService.connectWallet(validUUID, walletAddress);

                await userService.getOrCreate(validUUID2);

                const result = await linkWalletWithChallenge(userService, validUUID2, walletAddress);

                const disputed = result.user.wallets.find(w => w.address === walletAddress);
                expect(disputed).toBeDefined();
                expect(disputed!.verified).toBe(true);
            });

            it('should create tombstone on loser with mergedInto pointer', async () => {
                await userService.getOrCreate(validUUID);
                await userService.connectWallet(validUUID, walletAddress);

                await userService.getOrCreate(validUUID2);
                await userService.connectWallet(validUUID2, otherWallet);

                await linkWalletWithChallenge(userService, validUUID2, walletAddress);

                // Read loser document directly from database (bypass pointer resolution)
                const collection = mockDatabase.getCollection('users');
                const loserDoc = await collection.findOne({ id: validUUID2 });

                expect(loserDoc).not.toBeNull();
                expect(loserDoc!.mergedInto).toBe(validUUID);
                expect(loserDoc!.wallets).toEqual([]);
            });

            it('should flatten existing pointer chains', async () => {
                // Create 3 users: A (winner), B (loser), C (already points to B)
                await userService.getOrCreate(validUUID);
                await userService.connectWallet(validUUID, walletAddress);

                await userService.getOrCreate(validUUID2);
                await userService.getOrCreate(validUUID3);

                // C already merged into B from a previous reconciliation
                const collection = mockDatabase.getCollection('users');
                await collection.updateOne(
                    { id: validUUID3 },
                    { $set: { mergedInto: validUUID2, wallets: [] } }
                );

                // B proves ownership of walletAddress → swap B into A
                await linkWalletWithChallenge(userService, validUUID2, walletAddress);

                // C should now point directly to A (not B)
                const cDoc = await collection.findOne({ id: validUUID3 });
                expect(cDoc!.mergedInto).toBe(validUUID);
            });

            it('should not create duplicate wallets when both users share a wallet', async () => {
                // Edge case: both users somehow have the same wallet
                // (shouldn't happen with new guards, but defensive)
                await userService.getOrCreate(validUUID);
                await userService.connectWallet(validUUID, walletAddress);

                await userService.getOrCreate(validUUID2);
                // Manually add same wallet to loser to simulate legacy data
                const collection = mockDatabase.getCollection('users');
                await collection.updateOne(
                    { id: validUUID2 },
                    {
                        $set: {
                            wallets: [{
                                address: walletAddress,
                                linkedAt: new Date(),
                                isPrimary: false,
                                verified: false,
                                verifiedAt: null,
                                lastUsed: new Date()
                            }]
                        }
                    }
                );

                const result = await linkWalletWithChallenge(userService, validUUID2, walletAddress);

                // Winner should not have duplicate wallet entries
                const matchingWallets = result.user.wallets.filter(w => w.address === walletAddress);
                expect(matchingWallets.length).toBe(1);
            });

            it('should invalidate caches for both winner and loser', async () => {
                await userService.getOrCreate(validUUID);
                await userService.connectWallet(validUUID, walletAddress);

                await userService.getOrCreate(validUUID2);

                // Ensure both are cached
                await userService.getById(validUUID);
                await userService.getById(validUUID2);

                await linkWalletWithChallenge(userService, validUUID2, walletAddress);

                // Both user caches should be invalidated
                const winnerCached = await mockCache.get(`user:${validUUID}`);
                const loserCached = await mockCache.get(`user:${validUUID2}`);
                expect(winnerCached).toBeNull();
                expect(loserCached).toBeNull();
            });

            it('should throw when an already-consumed nonce is replayed during swap', async () => {
                await userService.getOrCreate(validUUID);
                await userService.connectWallet(validUUID, walletAddress);
                await userService.getOrCreate(validUUID2);

                // First consumption succeeds (it's the swap itself).
                const input = await buildLinkInput(userService, validUUID2, walletAddress);
                await userService.linkWallet(validUUID2, input);

                // Replaying the same captured nonce must fail — single-use guarantee.
                await expect(
                    userService.linkWallet(validUUID2, input)
                ).rejects.toThrow(/Wallet challenge expired or already used/);
            });

            it('should throw when the signed message diverges from the canonical form', async () => {
                await userService.getOrCreate(validUUID);
                await userService.connectWallet(validUUID, walletAddress);
                await userService.getOrCreate(validUUID2);

                const input = await buildLinkInput(userService, validUUID2, walletAddress);
                await expect(
                    userService.linkWallet(validUUID2, {
                        ...input,
                        message: 'TronRelic link wallet other-thing (nonce x)'
                    })
                ).rejects.toThrow(/canonical challenge form/);
            });

            it('upserts the loser row and runs identity swap when no row exists for the caller (Phase 4)', async () => {
                // Phase 4 of the traffic-events split: linkWallet routes
                // through `ensureExists`, so a fresh cookie holder coming
                // from a new browser (the cross-browser login path) gets
                // their loser row synthesised before identity reconciliation
                // runs. Pre-Phase-4 the missing row threw "User with id"
                // and the cross-browser login flow had to go through
                // session/start first. The reconciliation tombstones the
                // synthesised loser row anyway, so the upsert costs at
                // most a transient document. See PLAN-traffic-events.md.
                await userService.getOrCreate(validUUID);
                await userService.connectWallet(validUUID, walletAddress);

                // No row for validUUID2 yet — this is the new-browser case.
                expect(await userService.getById(validUUID2)).toBeNull();

                const input = await buildLinkInput(userService, validUUID2, walletAddress);
                const result = await userService.linkWallet(validUUID2, input);

                expect(result.identitySwapped).toBe(true);
                expect(result.user.id).toBe(validUUID); // canonical winner
                expect(result.previousUserId).toBe(validUUID2);
            });

            it('should log reconciliation with wallet transfer count', async () => {
                await userService.getOrCreate(validUUID);
                await userService.connectWallet(validUUID, walletAddress);

                await userService.getOrCreate(validUUID2);
                await userService.connectWallet(validUUID2, otherWallet);
                mockLogger.clear();

                await linkWalletWithChallenge(userService, validUUID2, walletAddress);

                const infoLogs = mockLogger.logs.filter(l => l.level === 'info');
                const hasReconciliationLog = infoLogs.some(l =>
                    l.message?.includes('reconciliation') || l.message?.includes('Identity reconciliation')
                );
                expect(hasReconciliationLog).toBe(true);
            });
        });

        describe('post-merge behavior', () => {
            it('getById on loser UUID should resolve to winner after swap', async () => {
                await userService.getOrCreate(validUUID);
                await userService.connectWallet(validUUID, walletAddress);

                await userService.getOrCreate(validUUID2);

                await linkWalletWithChallenge(userService, validUUID2, walletAddress);
                mockCache.clear();

                // Looking up loser should resolve to winner
                const resolved = await userService.getById(validUUID2);
                expect(resolved).not.toBeNull();
                expect(resolved!.id).toBe(validUUID);
            });

            it('getByWallet on transferred wallet should return winner', async () => {
                await userService.getOrCreate(validUUID);
                await userService.connectWallet(validUUID, walletAddress);

                await userService.getOrCreate(validUUID2);
                await userService.connectWallet(validUUID2, otherWallet);

                await linkWalletWithChallenge(userService, validUUID2, walletAddress);
                mockCache.clear();

                // otherWallet was transferred from loser to winner
                const user = await userService.getByWallet(otherWallet);
                expect(user).not.toBeNull();
                expect(user!.id).toBe(validUUID);
            });

            it('connectWallet on loser wallet after merge should find winner', async () => {
                await userService.getOrCreate(validUUID);
                await userService.connectWallet(validUUID, walletAddress);

                await userService.getOrCreate(validUUID2);
                await userService.connectWallet(validUUID2, otherWallet);

                // Perform merge
                await linkWalletWithChallenge(userService, validUUID2, walletAddress);

                // Third user tries to claim otherWallet (now on winner)
                await userService.getOrCreate(validUUID3);
                const result = await userService.connectWallet(validUUID3, otherWallet);

                expect(result.success).toBe(false);
                expect(result.loginRequired).toBe(true);
                expect(result.existingUserId).toBe(validUUID);
            });
        });
    });

    describe('Mutation methods resolve merged UUIDs', () => {
        /**
         * These tests verify that all mutation methods transparently
         * redirect operations to the canonical user when called with
         * a merged (tombstone) UUID. Without this, a stale cookie
         * arriving during the narrow window between identity swap and
         * page reload would silently mutate the tombstone instead of
         * the real user.
         */
        const walletAddress = 'mocked-address';

        /**
         * Helper: create two users, merge loser into winner via wallet swap,
         * clear caches so subsequent calls hit the resolveUserId path.
         */
        async function setupMerge(
            svc: UserService,
            db: ReturnType<typeof createMockDatabaseService>,
            cache: MockCacheService,
            winnerId: string,
            loserId: string
        ): Promise<void> {
            await svc.getOrCreate(winnerId);
            await svc.connectWallet(winnerId, walletAddress);
            await svc.getOrCreate(loserId);

            await linkWalletWithChallenge(svc, loserId, walletAddress);
            cache.clear();
        }

        it('updatePreferences with merged UUID should update canonical user', async () => {
            await setupMerge(userService, mockDatabase, mockCache, validUUID, validUUID2);

            const updated = await userService.updatePreferences(validUUID2, { theme: 'dark-id' });

            expect(updated.id).toBe(validUUID);
            expect(updated.preferences.theme).toBe('dark-id');
        });

        it('logout with merged UUID downgrades canonical user', async () => {
            await setupMerge(userService, mockDatabase, mockCache, validUUID, validUUID2);
            // setupMerge ends with the canonical user in Verified state
            // (the loser's link reconciliation lifted the winner). Logging
            // out via the loser cookie must downgrade the winner.
            mockCache.clear();

            const result = await userService.logout(validUUID2);

            expect(result.id).toBe(validUUID);
            expect(result.identityState).toBe(UserIdentityState.Registered);
            expect(result.identityVerifiedAt).toBeNull();
        });

        it('recordActivity with merged UUID should increment canonical user pageViews', async () => {
            await setupMerge(userService, mockDatabase, mockCache, validUUID, validUUID2);

            const before = await userService.getById(validUUID);
            const beforeViews = before!.activity.pageViews;

            await userService.recordActivity(validUUID2);
            mockCache.clear();

            const after = await userService.getById(validUUID);
            expect(after!.activity.pageViews).toBe(beforeViews + 1);
        });

        it('connectWallet with merged UUID should attach wallet to canonical user', async () => {
            await setupMerge(userService, mockDatabase, mockCache, validUUID, validUUID2);

            const result = await userService.connectWallet(validUUID2, 'brand-new-wallet');

            expect(result.success).toBe(true);
            expect(result.user!.id).toBe(validUUID);
            const walletAddresses = result.user!.wallets.map(w => w.address);
            expect(walletAddresses).toContain('brand-new-wallet');
        });
    });

    describe('Referral System', () => {
        describe('linkWallet - referral code generation', () => {
            it('should generate referral code on first wallet verification', async () => {
                // Create user
                const user = await userService.getOrCreate(validUUID);
                expect(user.referral).toBeNull();

                // Link wallet (triggers verification and code generation)
                // Mock verifyMessage returns 'mocked-address', so message must include it
                const result = await linkWalletWithChallenge(userService, validUUID, 'mocked-address');

                // Verify referral code was generated
                expect(result.user.referral).not.toBeNull();
                expect(result.user.referral?.code).toBeTruthy();
                expect(typeof result.user.referral?.code).toBe('string');
                expect(result.user.referral?.code?.length).toBe(8);
            });

            it('should preserve existing referredBy when generating code', async () => {
                // Create user and manually set referredBy (simulating attribution before verify)
                await userService.getOrCreate(validUUID);
                const collection = mockDatabase.getCollection('users');
                await collection.updateOne(
                    { id: validUUID },
                    {
                        $set: {
                            referral: {
                                code: null,
                                referredBy: 'abc12345',
                                referredAt: new Date()
                            }
                        }
                    }
                );

                // Link wallet — should generate code but preserve referredBy
                const result = await linkWalletWithChallenge(userService, validUUID, 'mocked-address');

                expect(result.user.referral?.code).toBeTruthy();
                expect(result.user.referral?.referredBy).toBe('abc12345');
            });

            it('should not regenerate code on subsequent wallet verifications', async () => {
                // Create user with existing referral code
                await userService.getOrCreate(validUUID);
                const collection = mockDatabase.getCollection('users');
                await collection.updateOne(
                    { id: validUUID },
                    {
                        $set: {
                            referral: {
                                code: 'existing1',
                                referredBy: null,
                                referredAt: null
                            }
                        }
                    }
                );

                // Link another wallet
                const result = await linkWalletWithChallenge(userService, validUUID, 'mocked-address');

                // Code should remain unchanged
                expect(result.user.referral?.code).toBe('existing1');
            });
        });

        describe('startSession - referral attribution', () => {
            it('should attribute referral on first session with valid UTM', async () => {
                // Create referring user with a code
                await userService.getOrCreate(validUUID);
                const collection = mockDatabase.getCollection('users');
                await collection.updateOne(
                    { id: validUUID },
                    {
                        $set: {
                            referral: { code: 'aef12345', referredBy: null, referredAt: null }
                        }
                    }
                );

                // Create new user arriving via referral link
                await userService.getOrCreate(validUUID2);

                await userService.startSession({
                    userId: validUUID2,
                    clientIP: '127.0.0.1',
                    userAgent: 'Mozilla/5.0 Desktop',
                    screenWidth: 1200,
                    rawUtm: { source: 'referral', medium: 'link', content: 'aef12345' },
                    landingPage: '/'
                });

                // Verify attribution was recorded
                const referred = await collection.findOne({ id: validUUID2 });
                expect(referred?.referral?.referredBy).toBe('aef12345');
                expect(referred?.referral?.referredAt).toBeTruthy();
            });

            it('should not attribute self-referrals', async () => {
                // Create user with a code
                await userService.getOrCreate(validUUID);
                const collection = mockDatabase.getCollection('users');
                await collection.updateOne(
                    { id: validUUID },
                    {
                        $set: {
                            referral: { code: 'aabb0011', referredBy: null, referredAt: null }
                        }
                    }
                );

                // Same user arrives with their own referral code
                await userService.startSession({
                    userId: validUUID,
                    clientIP: '127.0.0.1',
                    userAgent: 'Mozilla/5.0 Desktop',
                    screenWidth: 1200,
                    rawUtm: { source: 'referral', medium: 'link', content: 'aabb0011' },
                    landingPage: '/'
                });

                // Should NOT record self-referral
                const user = await collection.findOne({ id: validUUID });
                expect(user?.referral?.referredBy).toBeNull();
            });

            it('should not overwrite existing referral attribution', async () => {
                // Create referred user with existing attribution
                await userService.getOrCreate(validUUID2);
                const collection = mockDatabase.getCollection('users');
                await collection.updateOne(
                    { id: validUUID2 },
                    {
                        $set: {
                            referral: { code: null, referredBy: 'original', referredAt: new Date('2025-01-01') }
                        }
                    }
                );

                // Create second referrer
                await userService.getOrCreate(validUUID);
                await collection.updateOne(
                    { id: validUUID },
                    {
                        $set: {
                            referral: { code: 'ccdd2233', referredBy: null, referredAt: null }
                        }
                    }
                );

                // Start session with new referral — should be ignored
                await userService.startSession({
                    userId: validUUID2,
                    clientIP: '127.0.0.1',
                    userAgent: 'Mozilla/5.0 Desktop',
                    screenWidth: 1200,
                    rawUtm: { source: 'referral', medium: 'link', content: 'ccdd2233' },
                    landingPage: '/'
                });

                const user = await collection.findOne({ id: validUUID2 });
                expect(user?.referral?.referredBy).toBe('original');
            });

            it('should reject invalid referral code formats', async () => {
                await userService.getOrCreate(validUUID2);

                // Start session with invalid code (too short, not hex)
                await userService.startSession({
                    userId: validUUID2,
                    clientIP: '127.0.0.1',
                    userAgent: 'Mozilla/5.0 Desktop',
                    screenWidth: 1200,
                    rawUtm: { source: 'referral', medium: 'link', content: 'bad!' },
                    landingPage: '/'
                });

                const collection = mockDatabase.getCollection('users');
                const user = await collection.findOne({ id: validUUID2 });
                expect(user?.referral?.referredBy ?? null).toBeNull();
            });
        });

        describe('getReferralStats', () => {
            it('should return null for user without referral code', async () => {
                await userService.getOrCreate(validUUID);
                const stats = await userService.getReferralStats(validUUID);
                expect(stats).toBeNull();
            });

            it('should return code and zero counts when no referrals', async () => {
                await userService.getOrCreate(validUUID);
                const collection = mockDatabase.getCollection('users');
                await collection.updateOne(
                    { id: validUUID },
                    {
                        $set: {
                            referral: { code: 'test1234', referredBy: null, referredAt: null }
                        }
                    }
                );

                const stats = await userService.getReferralStats(validUUID);
                expect(stats).not.toBeNull();
                expect(stats!.code).toBe('test1234');
                expect(stats!.referredCount).toBe(0);
                expect(stats!.convertedCount).toBe(0);
            });
        });

        describe('date range filtering (via getEngagementMetrics)', () => {
            it('should return results for open-ended range (preset period)', async () => {
                const collection = mockDatabase.getCollection('users');
                await userService.getOrCreate(validUUID);
                await collection.updateOne(
                    { id: validUUID },
                    {
                        $set: {
                            'activity.lastSeen': new Date(),
                            'activity.sessions': [{
                                startedAt: new Date(),
                                durationSeconds: 60,
                                pages: [{ path: '/', timestamp: new Date() }]
                            }]
                        }
                    }
                );

                const result = await userService.getEngagementMetrics({
                    since: new Date(Date.now() - 24 * 60 * 60 * 1000)
                });

                expect(result).toHaveProperty('totalUsers');
                expect(result).toHaveProperty('avgSessionDuration');
                expect(result).toHaveProperty('bounceRate');
            });

            it('should return results for bounded range (custom dates)', async () => {
                const now = new Date();
                const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
                const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

                const collection = mockDatabase.getCollection('users');
                await userService.getOrCreate(validUUID);
                await collection.updateOne(
                    { id: validUUID },
                    {
                        $set: {
                            'activity.lastSeen': now,
                            'activity.sessions': [{
                                startedAt: now,
                                durationSeconds: 120,
                                pages: [{ path: '/', timestamp: now }]
                            }]
                        }
                    }
                );

                const result = await userService.getEngagementMetrics({
                    since: yesterday,
                    until: tomorrow
                });

                expect(result).toHaveProperty('totalUsers');
                expect(result).toHaveProperty('avgSessionDuration');
            });

            it('should return empty results when bounded range has no matching sessions', async () => {
                const collection = mockDatabase.getCollection('users');
                await userService.getOrCreate(validUUID);
                await collection.updateOne(
                    { id: validUUID },
                    {
                        $set: {
                            'activity.lastSeen': new Date(),
                            'activity.sessions': [{
                                startedAt: new Date(),
                                durationSeconds: 60,
                                pages: [{ path: '/', timestamp: new Date() }]
                            }]
                        }
                    }
                );

                // Range entirely in the past — no sessions should match
                const longAgo = new Date('2020-01-01');
                const alsoLongAgo = new Date('2020-01-02');
                const result = await userService.getEngagementMetrics({
                    since: longAgo,
                    until: alsoLongAgo
                });

                expect(result.totalUsers).toBe(0);
                expect(result.avgSessionDuration).toBe(0);
            });

            it('should handle getConversionFunnel with bounded range', async () => {
                const result = await userService.getConversionFunnel({
                    since: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
                    until: new Date()
                });

                expect(result).toHaveProperty('stages');
                expect(Array.isArray(result.stages)).toBe(true);
            });

            it('should handle getTrafficSources with bounded range', async () => {
                const result = await userService.getTrafficSources({
                    since: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
                    until: new Date()
                });

                expect(result).toHaveProperty('sources');
                expect(result).toHaveProperty('total');
            });
        });

        describe('getReferralOverview', () => {
            it('should return correct shape with zero totals when no referrals exist', async () => {
                // The mock aggregate doesn't support complex $group with $cond/$filter,
                // so this test verifies the method handles empty data gracefully and
                // returns the correct response shape.
                const overview = await userService.getReferralOverview({ since: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) });

                expect(overview).toHaveProperty('totalReferrals');
                expect(overview).toHaveProperty('totalConverted');
                expect(overview).toHaveProperty('conversionRate');
                expect(overview).toHaveProperty('usersWithCodes');
                expect(overview).toHaveProperty('topReferrers');
                expect(overview).toHaveProperty('recentReferrals');
                expect(Array.isArray(overview.topReferrers)).toBe(true);
                expect(Array.isArray(overview.recentReferrals)).toBe(true);
            });

            it('should include recent referrals from find query', async () => {
                const collection = mockDatabase.getCollection('users');

                // Create referrer with code
                await userService.getOrCreate(validUUID);
                await collection.updateOne(
                    { id: validUUID },
                    { $set: { referral: { code: 'aabb1122', referredBy: null, referredAt: null } } }
                );

                // Create referred user with recent referral date
                await userService.getOrCreate(validUUID2);
                await collection.updateOne(
                    { id: validUUID2 },
                    {
                        $set: {
                            referral: { code: null, referredBy: 'aabb1122', referredAt: new Date() },
                            'activity.lastSeen': new Date()
                        }
                    }
                );

                const overview = await userService.getReferralOverview({ since: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) });

                // Recent referrals use find() (not aggregate), so the mock handles it
                expect(overview.recentReferrals.length).toBe(1);
                expect(overview.recentReferrals[0].userId).toBe(validUUID2);
                expect(overview.recentReferrals[0].referredBy).toBe('aabb1122');
            });

            it('should count users with referral codes', async () => {
                const collection = mockDatabase.getCollection('users');

                // Create user with code
                await userService.getOrCreate(validUUID);
                await collection.updateOne(
                    { id: validUUID },
                    { $set: { referral: { code: 'ee556677', referredBy: null, referredAt: null } } }
                );

                const overview = await userService.getReferralOverview({ since: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) });

                // countDocuments with $ne + $exists is handled by mock
                expect(overview.usersWithCodes).toBeGreaterThanOrEqual(1);
            });
        });
    });

    describe('identityState (canonical anonymous/registered/verified taxonomy)', () => {
        const walletAddress = 'TXyz123456789';
        const otherWallet = 'TWallet111111111';

        it('initializes a brand-new user as anonymous', async () => {
            const user = await userService.getOrCreate(validUUID);
            expect(user.identityState).toBe(UserIdentityState.Anonymous);
        });

        it('persists anonymous on the underlying document', async () => {
            await userService.getOrCreate(validUUID);
            const collection = mockDatabase.getCollection('users');
            const doc = await collection.findOne({ id: validUUID });
            expect(doc!.identityState).toBe(UserIdentityState.Anonymous);
        });

        it('transitions anonymous → registered after connectWallet', async () => {
            await userService.getOrCreate(validUUID);
            const result = await userService.connectWallet(validUUID, walletAddress);

            expect(result.success).toBe(true);
            expect(result.user!.identityState).toBe(UserIdentityState.Registered);

            const collection = mockDatabase.getCollection('users');
            const doc = await collection.findOne({ id: validUUID });
            expect(doc!.identityState).toBe(UserIdentityState.Registered);
        });

        it('transitions registered → verified after linkWallet (signature)', async () => {
            await userService.getOrCreate(validUUID);
            await userService.connectWallet(validUUID, walletAddress);

            const result = await linkWalletWithChallenge(userService, validUUID, walletAddress);

            expect(result.user.identityState).toBe(UserIdentityState.Verified);

            const collection = mockDatabase.getCollection('users');
            const doc = await collection.findOne({ id: validUUID });
            expect(doc!.identityState).toBe(UserIdentityState.Verified);
        });

        it('transitions anonymous → verified directly when linkWallet adds a new wallet', async () => {
            await userService.getOrCreate(validUUID);

            const result = await linkWalletWithChallenge(userService, validUUID, walletAddress);

            expect(result.user.identityState).toBe(UserIdentityState.Verified);
        });

        it('stays verified when an additional unverified wallet is connected', async () => {
            await userService.getOrCreate(validUUID);
            await linkWalletWithChallenge(userService, validUUID, walletAddress);
            await userService.connectWallet(validUUID, otherWallet);

            const collection = mockDatabase.getCollection('users');
            const doc = await collection.findOne({ id: validUUID });
            expect(doc!.identityState).toBe(UserIdentityState.Verified);
        });

        it('demotes verified → registered when the only verified wallet is unlinked but another remains', async () => {
            await userService.getOrCreate(validUUID);
            await linkWalletWithChallenge(userService, validUUID, walletAddress);
            await userService.connectWallet(validUUID, otherWallet);

            // The signature mock returns whatever address is passed to
            // verifyMessage, so we stub the stored wallets to use the same
            // address we will pass to unlinkWallet — that way the recovered
            // address matches and the unlink lookup succeeds.
            const collection = mockDatabase.getCollection('users');
            await collection.updateOne(
                { id: validUUID },
                { $set: {
                    wallets: [
                        { address: 'mocked-address', linkedAt: new Date(), isPrimary: false, verified: true, verifiedAt: new Date(), lastUsed: new Date() },
                        { address: otherWallet, linkedAt: new Date(), isPrimary: false, verified: false, verifiedAt: null, lastUsed: new Date() }
                    ]
                } }
            );

            await unlinkWalletWithChallenge(userService, validUUID, 'mocked-address');

            const doc = await collection.findOne({ id: validUUID });
            expect(doc!.identityState).toBe(UserIdentityState.Registered);
        });

        it('demotes registered → anonymous when the last wallet is unlinked', async () => {
            await userService.getOrCreate(validUUID);
            await userService.connectWallet(validUUID, walletAddress);

            // Same trick: align stored wallet with what verifyMessage returns.
            const collection = mockDatabase.getCollection('users');
            await collection.updateOne(
                { id: validUUID },
                { $set: {
                    wallets: [
                        { address: 'mocked-address', linkedAt: new Date(), isPrimary: true, verified: false, verifiedAt: null, lastUsed: new Date() }
                    ]
                } }
            );

            await unlinkWalletWithChallenge(userService, validUUID, 'mocked-address');

            const doc = await collection.findOne({ id: validUUID });
            expect(doc!.identityState).toBe(UserIdentityState.Anonymous);
            expect(doc!.wallets).toEqual([]);
        });

        it('sets winner to verified after identity reconciliation', async () => {
            await userService.getOrCreate(validUUID);
            await userService.connectWallet(validUUID, walletAddress);

            await userService.getOrCreate(validUUID2);
            await userService.connectWallet(validUUID2, otherWallet);

            const result = await linkWalletWithChallenge(userService, validUUID2, walletAddress);

            expect(result.identitySwapped).toBe(true);
            expect(result.user.identityState).toBe(UserIdentityState.Verified);

            const collection = mockDatabase.getCollection('users');
            const winnerDoc = await collection.findOne({ id: validUUID });
            expect(winnerDoc!.identityState).toBe(UserIdentityState.Verified);
        });

        it('forces loser tombstone to anonymous after identity reconciliation', async () => {
            await userService.getOrCreate(validUUID);
            await userService.connectWallet(validUUID, walletAddress);

            await userService.getOrCreate(validUUID2);
            await userService.connectWallet(validUUID2, otherWallet);

            await linkWalletWithChallenge(userService, validUUID2, walletAddress);

            const collection = mockDatabase.getCollection('users');
            const loserDoc = await collection.findOne({ id: validUUID2 });
            expect(loserDoc!.identityState).toBe(UserIdentityState.Anonymous);
            expect(loserDoc!.wallets).toEqual([]);
            expect(loserDoc!.mergedInto).toBe(validUUID);
        });
    });
});
