/// <reference types="vitest" />

/**
 * @fileoverview Phase 1 sanity tests for {@link GroupService}.
 *
 * Covers the singleton contract and the read methods (which the
 * in-memory mock supports). Mutation tests are deferred to integration
 * coverage because the shared `createMockDatabaseService` mock does not
 * implement `$addToSet` / `$pull` semantics; spying on the underlying
 * collection handle here is sufficient to verify that the right MongoDB
 * operator is issued.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ISystemLogService } from '@/types';
import { GroupService, ADMIN_GROUP_ID } from '../services/group.service.js';
import { AUTH_USERS_COLLECTION } from '../services/auth-constants.js';
import { createMockDatabaseService } from '../../../tests/vitest/mocks/database-service.js';

/**
 * Minimal stub logger — GroupService only emits debug-level breadcrumbs.
 */
class StubLogger implements ISystemLogService {
    public level: string = 'info';
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

/**
 * Seed a BA-shaped user row directly into the mock's users collection.
 *
 * Bypasses {@link GroupService.addMember} because the mock doesn't
 * implement `$addToSet`; reads can still exercise the documents.
 */
function seedAuthUser(
    db: ReturnType<typeof createMockDatabaseService>,
    id: string,
    groups: string[] = []
): void {
    db.getCollectionData(AUTH_USERS_COLLECTION).push({
        _id: id,
        email: `${id}@example.com`,
        emailVerified: true,
        groups
    });
}

describe('GroupService', () => {
    let mockDatabase: ReturnType<typeof createMockDatabaseService>;
    let service: GroupService;

    beforeEach(() => {
        mockDatabase = createMockDatabaseService();
        GroupService.resetForTests();
        GroupService.setDependencies(mockDatabase, new StubLogger());
        service = GroupService.getInstance();
    });

    afterEach(() => {
        GroupService.resetForTests();
    });

    describe('singleton contract', () => {
        it('throws when getInstance() runs before setDependencies()', () => {
            GroupService.resetForTests();
            expect(() => GroupService.getInstance()).toThrow(/setDependencies/i);
        });

        it('returns the same instance across calls', () => {
            const a = GroupService.getInstance();
            const b = GroupService.getInstance();
            expect(a).toBe(b);
        });

        it('keeps the first dependencies on a second setDependencies() call', () => {
            const firstInstance = GroupService.getInstance();
            GroupService.setDependencies(createMockDatabaseService(), new StubLogger());
            const secondInstance = GroupService.getInstance();
            expect(secondInstance).toBe(firstInstance);
        });
    });

    describe('getUserGroups', () => {
        it('returns the stored groups array for a known user', async () => {
            seedAuthUser(mockDatabase, 'user_abc', ['admin', 'vip']);
            const groups = await service.getUserGroups('user_abc');
            expect(groups).toEqual(expect.arrayContaining(['admin', 'vip']));
        });

        it('returns an empty array for an unknown user', async () => {
            const groups = await service.getUserGroups('user_missing');
            expect(groups).toEqual([]);
        });

        it('returns an empty array when the user has no groups field', async () => {
            mockDatabase.getCollectionData(AUTH_USERS_COLLECTION).push({
                _id: 'user_no_groups',
                email: 'x@example.com'
            });
            const groups = await service.getUserGroups('user_no_groups');
            expect(groups).toEqual([]);
        });
    });

    describe('isMember', () => {
        it('returns true when the user is in the requested group', async () => {
            seedAuthUser(mockDatabase, 'user_admin', ['admin', 'vip']);
            const result = await service.isMember('user_admin', 'admin');
            expect(result).toBe(true);
        });

        it('returns false when the user is not in the requested group', async () => {
            seedAuthUser(mockDatabase, 'user_plain', ['vip']);
            const result = await service.isMember('user_plain', 'admin');
            expect(result).toBe(false);
        });

        it('returns false for a missing user', async () => {
            const result = await service.isMember('user_missing', 'admin');
            expect(result).toBe(false);
        });
    });

    describe('isAdmin', () => {
        it('delegates to isMember with the reserved admin group id', async () => {
            seedAuthUser(mockDatabase, 'user_admin', ['admin']);
            const spy = vi.spyOn(service, 'isMember');
            await service.isAdmin('user_admin');
            expect(spy).toHaveBeenCalledWith('user_admin', ADMIN_GROUP_ID);
        });
    });

    describe('addMember', () => {
        it('issues an $addToSet update against the users collection', async () => {
            const collection = mockDatabase.getCollection(AUTH_USERS_COLLECTION);
            const spy = vi.spyOn(collection, 'updateOne');
            await service.addMember('user_abc', 'admin');
            expect(spy).toHaveBeenCalledWith(
                { _id: 'user_abc' },
                { $addToSet: { groups: 'admin' } }
            );
        });
    });

    describe('removeMember', () => {
        it('issues a $pull update against the users collection', async () => {
            const collection = mockDatabase.getCollection(AUTH_USERS_COLLECTION);
            const spy = vi.spyOn(collection, 'updateOne');
            await service.removeMember('user_abc', 'admin');
            expect(spy).toHaveBeenCalledWith(
                { _id: 'user_abc' },
                { $pull: { groups: 'admin' } }
            );
        });
    });

    describe('setUserGroups', () => {
        it('replaces the groups array with $set and deduplicates input', async () => {
            const collection = mockDatabase.getCollection(AUTH_USERS_COLLECTION);
            const spy = vi.spyOn(collection, 'updateOne');
            await service.setUserGroups('user_abc', ['admin', 'vip', 'admin']);
            expect(spy).toHaveBeenCalledWith(
                { _id: 'user_abc' },
                { $set: { groups: ['admin', 'vip'] } }
            );
        });
    });
});
