/// <reference types="vitest" />

import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectId } from 'mongodb';
import type { ISystemLogService } from '@/types';
import { UserGroupService } from '../services/user-group.service.js';
import { GroupService } from '../services/group.service.js';
import { AUTH_USERS_COLLECTION } from '../services/auth-constants.js';
import { createMockDatabaseService } from '../../../tests/vitest/mocks/database-service.js';

/**
 * Minimal mock logger for UserGroupService tests. The service only emits
 * info-level events; errors propagate as thrown errors rather than logs.
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
 * Helper: seed a group definition row directly into the mock
 * `module_user_groups` collection, sidestepping `$setOnInsert` upsert
 * (unsupported by the shared mock). Tests that exercise `seedSystemGroups`
 * itself still call the service method.
 */
function seedGroup(
    db: ReturnType<typeof createMockDatabaseService>,
    overrides: Partial<{ id: string; name: string; description: string; system: boolean }>
): void {
    const now = new Date();
    db.getCollectionData('module_user_groups').push({
        id: overrides.id ?? 'group',
        name: overrides.name ?? overrides.id ?? 'Group',
        description: overrides.description ?? '',
        system: overrides.system ?? false,
        createdAt: now,
        updatedAt: now
    });
}

/**
 * Valid 24-character hex Better Auth user ids. Better Auth stores the user
 * `_id` as a native ObjectId and exposes it as this hex string, so seeded
 * users must use hex ids and seed `_id` as an ObjectId. Group *slugs*
 * (`vip`, `admin`, …) are not user ids and stay arbitrary strings.
 */
const USER_1 = '111111111111111111111111';
const ALICE = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const BOB = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const CAROL = 'cccccccccccccccccccccccc';
const ADMIN_USER = 'dddddddddddddddddddddddd';
const NORMAL_USER = 'eeeeeeeeeeeeeeeeeeeeeeee';

/**
 * Helper: seed a Better Auth user document directly into the
 * `module_user_auth_users` collection. Membership lives on the BA user's
 * `groups` additional field, keyed by the ObjectId `_id`, so seeding here is
 * how we establish membership state — the shared mock does not apply
 * `$addToSet`/`$pull`, so write paths are validated via matched/throw
 * contracts rather than array mutation. `id` must be a 24-char hex string.
 */
function seedUser(
    db: ReturnType<typeof createMockDatabaseService>,
    id: string,
    groups: string[] = []
): void {
    db.getCollectionData(AUTH_USERS_COLLECTION).push({ _id: new ObjectId(id), groups });
}

describe('UserGroupService', () => {
    let mockDatabase: ReturnType<typeof createMockDatabaseService>;
    let service: UserGroupService;

    beforeEach(async () => {
        mockDatabase = createMockDatabaseService();
        GroupService.resetForTests();
        GroupService.setDependencies(mockDatabase, new StubLogger());
        UserGroupService.resetInstance();
        UserGroupService.setDependencies(mockDatabase, GroupService.getInstance(), new StubLogger());
        service = UserGroupService.getInstance();
        // Seed the admin system row directly. The service's
        // `seedSystemGroups()` upserts via $setOnInsert which the shared
        // mock does not implement; tests that need an existing admin row
        // therefore seed it directly here.
        seedGroup(mockDatabase, { id: 'admin', name: 'Admin', system: true });
    });

    // -------- Reads against seeded admin row --------

    describe('list/get', () => {
        it('listGroups includes the seeded admin system row', async () => {
            const groups = await service.listGroups();
            const admin = groups.find(g => g.id === 'admin');
            expect(admin).toBeDefined();
            expect(admin?.system).toBe(true);
        });

        it('getGroup returns null for unknown ids', async () => {
            expect(await service.getGroup('not-real')).toBeNull();
        });
    });

    // -------- admin is just the seeded `admin` row --------

    describe('createGroup admin handling', () => {
        it('rejects "admin" because the seeded system row already holds the id', async () => {
            await expect(
                service.createGroup({ id: 'admin', name: 'X' })
            ).rejects.toThrow(/already exists/i);
        });

        const formerlyReserved = [
            'admins',
            'administrator',
            'super-admin',
            'superadmin',
            'sub-admin',
            'root',
            'roots'
        ];

        for (const slug of formerlyReserved) {
            it(`accepts "${slug}" — admin-derivative slugs are no longer reserved`, async () => {
                const group = await service.createGroup({ id: slug, name: slug });
                expect(group.id).toBe(slug);
                expect(group.system).toBe(false);
            });
        }
    });

    describe('createGroup slug validation', () => {
        it('rejects empty id', async () => {
            await expect(
                service.createGroup({ id: '', name: 'X' })
            ).rejects.toThrow(/id is required/i);
        });

        it('rejects empty name', async () => {
            await expect(
                service.createGroup({ id: 'vip', name: '' })
            ).rejects.toThrow(/name is required/i);
        });

        it('rejects malformed slugs', async () => {
            // Note: uppercase input is normalized via .toLowerCase() before
            // validation, so "VIP" → "vip" passes. Only structurally
            // invalid slugs are rejected here.
            await expect(
                service.createGroup({ id: '1abc', name: 'X' })
            ).rejects.toThrow(/Invalid group id/i);
            await expect(
                service.createGroup({ id: 'has space', name: 'X' })
            ).rejects.toThrow(/Invalid group id/i);
            await expect(
                service.createGroup({ id: 'trailing-', name: 'X' })
            ).rejects.toThrow(/Invalid group id/i);
        });

        it('rejects duplicate id', async () => {
            await service.createGroup({ id: 'vip', name: 'VIP' });
            await expect(
                service.createGroup({ id: 'vip', name: 'VIP again' })
            ).rejects.toThrow(/already exists/i);
        });
    });

    // -------- System group protection --------

    describe('system group protection', () => {
        it('refuses to update the admin system group', async () => {
            await expect(
                service.updateGroup('admin', { name: 'Admins (renamed)' })
            ).rejects.toThrow(/system group/i);
        });

        it('refuses to delete the admin system group', async () => {
            await expect(service.deleteGroup('admin')).rejects.toThrow(/system group/i);
        });

        it('allows updating an admin-defined group', async () => {
            await service.createGroup({ id: 'vip', name: 'VIP', description: 'old' });
            const updated = await service.updateGroup('vip', { description: 'new' });
            expect(updated.description).toBe('new');
        });

        it('allows deleting an admin-defined group', async () => {
            await service.createGroup({ id: 'vip', name: 'VIP' });
            await service.deleteGroup('vip');
            expect(await service.getGroup('vip')).toBeNull();
        });
    });

    // -------- Membership (delegated to GroupService over module_user_auth_users) --------
    //
    // Membership writes (`$addToSet`/`$pull`/`$set` of the array) are owned
    // by GroupService; the shared mock applies `$set` to top-level fields but
    // not `$addToSet`/`$pull`. We seed membership state directly and assert
    // the read-side contract plus the definition-validation/throw paths.

    describe('membership reads', () => {
        const userId = USER_1;

        beforeEach(() => {
            seedUser(mockDatabase, userId, ['vip']);
            seedGroup(mockDatabase, { id: 'vip', name: 'VIP' });
        });

        it('isMember returns true when group is in the BA user.groups', async () => {
            expect(await service.isMember(userId, 'vip')).toBe(true);
        });

        it('getUserGroups returns the seeded membership list', async () => {
            expect(await service.getUserGroups(userId)).toEqual(['vip']);
        });

        it('getUserGroups returns empty array for unknown user', async () => {
            expect(await service.getUserGroups('ghost')).toEqual([]);
        });

        it('isMember returns false for unknown user or group', async () => {
            expect(await service.isMember('ghost', 'admin')).toBe(false);
            expect(await service.isMember(userId, 'unknown-group')).toBe(false);
        });
    });

    describe('membership write validation', () => {
        const userId = USER_1;

        beforeEach(() => {
            seedUser(mockDatabase, userId);
        });

        it('addMember throws on unknown group', async () => {
            await expect(service.addMember(userId, 'nope')).rejects.toThrow(/does not exist/i);
        });

        it('addMember throws on unknown user', async () => {
            seedGroup(mockDatabase, { id: 'vip', name: 'VIP' });
            await expect(service.addMember('ghost', 'vip')).rejects.toThrow(/not found|does not exist/i);
        });

        it('removeMember throws on unknown group', async () => {
            await expect(service.removeMember(userId, 'nope')).rejects.toThrow(/does not exist/i);
        });
    });

    // -------- setUserGroups --------

    describe('setUserGroups', () => {
        const userId = USER_1;

        beforeEach(() => {
            seedUser(mockDatabase, userId, ['vip']);
            seedGroup(mockDatabase, { id: 'vip', name: 'VIP' });
            seedGroup(mockDatabase, { id: 'whales', name: 'Whales' });
        });

        it('throws when groupIds is not an array', async () => {
            await expect(
                service.setUserGroups(userId, 'admin' as unknown as string[])
            ).rejects.toThrow(/must be an array/i);
        });

        it('throws on unknown group id (validates before write)', async () => {
            await expect(
                service.setUserGroups(userId, ['vip', 'ghost-group'])
            ).rejects.toThrow(/does not exist/i);
        });

        it('throws on unknown user', async () => {
            await expect(
                service.setUserGroups('ghost-user', ['vip'])
            ).rejects.toThrow(/not found|does not exist/i);
        });

        it('replaces the BA user.groups atomically with dedup and lowercase', async () => {
            const result = await service.setUserGroups(userId, ['VIP', 'whales', 'vip']);
            expect(result).toEqual(['vip', 'whales']);
            // Confirm the persisted BA user document reflects the new array.
            // GroupService uses a top-level $set, which the mock supports.
            const doc = mockDatabase.getCollectionData(AUTH_USERS_COLLECTION).find(u => u._id?.toString() === userId);
            expect(doc?.groups).toEqual(['vip', 'whales']);
        });

        it('accepts an empty array to clear all memberships', async () => {
            const result = await service.setUserGroups(userId, []);
            expect(result).toEqual([]);
            const doc = mockDatabase.getCollectionData(AUTH_USERS_COLLECTION).find(u => u._id?.toString() === userId);
            expect(doc?.groups).toEqual([]);
        });
    });

    // -------- getMembers --------

    describe('getMembers', () => {
        beforeEach(() => {
            seedGroup(mockDatabase, { id: 'vip', name: 'VIP' });
            seedUser(mockDatabase, ALICE, ['vip']);
            seedUser(mockDatabase, BOB, ['vip']);
            seedUser(mockDatabase, CAROL, []);
        });

        it('throws on unknown group so admin UIs can distinguish "no members" from "wrong slug"', async () => {
            await expect(service.getMembers('not-real')).rejects.toThrow(/does not exist/i);
        });

        it('returns the user ids that belong to the group with total count', async () => {
            const result = await service.getMembers('vip');
            expect(new Set(result.userIds)).toEqual(new Set([ALICE, BOB]));
            expect(result.total).toBe(2);
        });

        it('returns empty list with zero total when the group has no members', async () => {
            seedGroup(mockDatabase, { id: 'empty-group', name: 'Empty' });
            const result = await service.getMembers('empty-group');
            expect(result.userIds).toEqual([]);
            expect(result.total).toBe(0);
        });
    });

    // -------- isAdmin --------

    describe('isAdmin', () => {
        const adminUser = ADMIN_USER;
        const normalUser = NORMAL_USER;

        beforeEach(() => {
            seedUser(mockDatabase, adminUser, ['admin']);
            seedUser(mockDatabase, normalUser, ['vip-traders']);
            seedGroup(mockDatabase, { id: 'vip-traders', name: 'VIP Traders' });
        });

        it('returns true for a member of the admin group', async () => {
            expect(await service.isAdmin(adminUser)).toBe(true);
        });

        it('returns false for a non-admin user', async () => {
            expect(await service.isAdmin(normalUser)).toBe(false);
        });

        it('returns false for an unknown user', async () => {
            expect(await service.isAdmin('ghost')).toBe(false);
        });
    });
});
