/// <reference types="vitest" />

/**
 * @fileoverview Phase 1 sanity tests for {@link GroupService}.
 *
 * Covers the singleton contract, the read methods (which the in-memory
 * mock supports), and the user-id boundary: Better Auth stores the user
 * `_id` as a native `ObjectId` and exposes it as a hex string, so every
 * method converts the incoming hex id to an `ObjectId` before querying.
 * The seeds therefore store `_id: new ObjectId(hex)` and the mutation
 * spies assert the filter is keyed by that ObjectId — a regression to a
 * raw-string filter would never match the stored `_id`. Malformed ids
 * short-circuit to a no-match read / no-op write without touching Mongo.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ObjectId } from 'mongodb';
import type { ISystemLogService } from '@/types';
import { GroupService, ADMIN_GROUP_ID } from '../services/group.service.js';
import { AUTH_USERS_COLLECTION } from '../services/auth-constants.js';
import { createMockDatabaseService } from '../../../tests/vitest/mocks/database-service.js';

/** Valid 24-character hex Better Auth user ids used across the suite. */
const USER_ABC = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const USER_ADMIN = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const USER_PLAIN = 'cccccccccccccccccccccccc';
const USER_NO_GROUPS = 'dddddddddddddddddddddddd';
const USER_MISSING = 'eeeeeeeeeeeeeeeeeeeeeeee';

/** Not a 24-hex string — {@link toUserKey} rejects it. */
const MALFORMED_ID = 'not-a-valid-object-id';

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
 * Stores `_id` as an `ObjectId` — exactly as Better Auth's adapter does —
 * so the service's hex-to-ObjectId conversion is exercised on reads.
 * Bypasses {@link GroupService.addMember} because the mock doesn't
 * implement `$addToSet`.
 *
 * @param db - Mock database service.
 * @param id - 24-character hex user id.
 * @param groups - Group ids to seed onto the row.
 */
function seedAuthUser(
    db: ReturnType<typeof createMockDatabaseService>,
    id: string,
    groups: string[] = []
): void {
    db.getCollectionData(AUTH_USERS_COLLECTION).push({
        _id: new ObjectId(id),
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
            seedAuthUser(mockDatabase, USER_ABC, ['admin', 'vip']);
            const groups = await service.getUserGroups(USER_ABC);
            expect(groups).toEqual(expect.arrayContaining(['admin', 'vip']));
        });

        it('returns an empty array for an unknown user', async () => {
            const groups = await service.getUserGroups(USER_MISSING);
            expect(groups).toEqual([]);
        });

        it('returns an empty array when the user has no groups field', async () => {
            mockDatabase.getCollectionData(AUTH_USERS_COLLECTION).push({
                _id: new ObjectId(USER_NO_GROUPS),
                email: 'x@example.com'
            });
            const groups = await service.getUserGroups(USER_NO_GROUPS);
            expect(groups).toEqual([]);
        });
    });

    describe('isMember', () => {
        it('returns true when the user is in the requested group', async () => {
            seedAuthUser(mockDatabase, USER_ADMIN, ['admin', 'vip']);
            const result = await service.isMember(USER_ADMIN, 'admin');
            expect(result).toBe(true);
        });

        it('returns false when the user is not in the requested group', async () => {
            seedAuthUser(mockDatabase, USER_PLAIN, ['vip']);
            const result = await service.isMember(USER_PLAIN, 'admin');
            expect(result).toBe(false);
        });

        it('returns false for a missing user', async () => {
            const result = await service.isMember(USER_MISSING, 'admin');
            expect(result).toBe(false);
        });
    });

    describe('isAdmin', () => {
        it('delegates to isMember with the reserved admin group id', async () => {
            seedAuthUser(mockDatabase, USER_ADMIN, ['admin']);
            const spy = vi.spyOn(service, 'isMember');
            await service.isAdmin(USER_ADMIN);
            expect(spy).toHaveBeenCalledWith(USER_ADMIN, ADMIN_GROUP_ID);
        });
    });

    describe('addMember', () => {
        it('issues an $addToSet update keyed by the ObjectId form of the user id', async () => {
            const collection = mockDatabase.getCollection(AUTH_USERS_COLLECTION);
            const spy = vi.spyOn(collection, 'updateOne');
            await service.addMember(USER_ABC, 'admin');
            expect(spy).toHaveBeenCalledTimes(1);
            const [filter, update] = spy.mock.calls[0];
            expect((filter._id as ObjectId).toHexString()).toBe(USER_ABC);
            expect(update).toEqual({ $addToSet: { groups: 'admin' } });
        });
    });

    describe('removeMember', () => {
        it('issues a $pull update keyed by the ObjectId form of the user id', async () => {
            const collection = mockDatabase.getCollection(AUTH_USERS_COLLECTION);
            const spy = vi.spyOn(collection, 'updateOne');
            await service.removeMember(USER_ABC, 'admin');
            expect(spy).toHaveBeenCalledTimes(1);
            const [filter, update] = spy.mock.calls[0];
            expect((filter._id as ObjectId).toHexString()).toBe(USER_ABC);
            expect(update).toEqual({ $pull: { groups: 'admin' } });
        });
    });

    describe('setUserGroups', () => {
        it('replaces the groups array with $set, deduplicates, and keys by ObjectId', async () => {
            const collection = mockDatabase.getCollection(AUTH_USERS_COLLECTION);
            const spy = vi.spyOn(collection, 'updateOne');
            await service.setUserGroups(USER_ABC, ['admin', 'vip', 'admin']);
            expect(spy).toHaveBeenCalledTimes(1);
            const [filter, update] = spy.mock.calls[0];
            expect((filter._id as ObjectId).toHexString()).toBe(USER_ABC);
            expect(update).toEqual({ $set: { groups: ['admin', 'vip'] } });
        });
    });

    describe('getMembers', () => {
        it('returns member ids as hex strings, not ObjectIds', async () => {
            seedAuthUser(mockDatabase, USER_ABC, ['admin']);
            seedAuthUser(mockDatabase, USER_ADMIN, ['admin']);
            const { userIds, total } = await service.getMembers('admin');
            expect(total).toBe(2);
            expect(userIds).toEqual(expect.arrayContaining([USER_ABC, USER_ADMIN]));
            expect(userIds.every((id) => typeof id === 'string')).toBe(true);
        });
    });

    describe('malformed user id', () => {
        it('getUserGroups returns [] and never queries the collection', async () => {
            const collection = mockDatabase.getCollection(AUTH_USERS_COLLECTION);
            const spy = vi.spyOn(collection, 'findOne');
            const groups = await service.getUserGroups(MALFORMED_ID);
            expect(groups).toEqual([]);
            expect(spy).not.toHaveBeenCalled();
        });

        it('isMember returns false for a malformed id', async () => {
            const result = await service.isMember(MALFORMED_ID, 'admin');
            expect(result).toBe(false);
        });

        it('addMember returns false and issues no write for a malformed id', async () => {
            const collection = mockDatabase.getCollection(AUTH_USERS_COLLECTION);
            const spy = vi.spyOn(collection, 'updateOne');
            const result = await service.addMember(MALFORMED_ID, 'admin');
            expect(result).toBe(false);
            expect(spy).not.toHaveBeenCalled();
        });
    });
});
