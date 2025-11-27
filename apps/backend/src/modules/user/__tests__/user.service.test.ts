/// <reference types="vitest" />

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { UserService } from '../services/user.service.js';
import type { ICacheService, ISystemLogService } from '@tronrelic/types';
import { createMockDatabaseService } from '../../../tests/vitest/mocks/database-service.js';

// Mock SignatureService to avoid TRON address validation in unit tests
vi.mock('../../auth/signature.service.js', () => {
    return {
        SignatureService: class MockSignatureService {
            normalizeAddress(address: string): string {
                return address;
            }
            async verifyMessage(): Promise<string> {
                return 'mocked-address';
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

    beforeEach(() => {
        mockDatabase = createMockDatabaseService();
        mockCache = new MockCacheService();
        mockLogger = new MockSystemLogService();

        // Reset singleton instance
        UserService.resetInstance();

        // Initialize service
        UserService.setDependencies(mockDatabase, mockCache, mockLogger);
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
            expect(user.activity.pageViews).toBe(1);
            expect(user.activity.sessionsCount).toBe(1);
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

        it('should throw error for non-existent user', async () => {
            await expect(
                userService.updatePreferences(validUUID, { theme: 'test' })
            ).rejects.toThrow('User with id');
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
        const mockMessage = 'Set primary wallet';
        const mockSignature = 'mock-signature';

        it('should throw error if user not found', async () => {
            await expect(
                userService.setPrimaryWallet(validUUID, validTronAddress, mockMessage, mockSignature)
            ).rejects.toThrow('User with id');
        });

        it('should throw error if wallet not linked', async () => {
            await userService.getOrCreate(validUUID);

            await expect(
                userService.setPrimaryWallet(validUUID, validTronAddress, mockMessage, mockSignature)
            ).rejects.toThrow('Wallet is not linked to this user');
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
});
