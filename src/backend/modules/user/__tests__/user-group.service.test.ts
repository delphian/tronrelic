/// <reference types="vitest" />

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ICacheService, ISystemLogService } from '@/types';
import { UserGroupService } from '../services/user-group.service.js';
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
 * Helper: seed a system or admin-defined group row directly into the mock
 * collection, sidestepping `$setOnInsert` upsert (unsupported by the
 * shared mock). Tests that exercise `seedSystemGroups` itself still call
 * the service method — this helper is only for setup of dependent state.
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
 * Helper: seed a user document directly into the users collection. The
 * shared mock doesn't apply `$addToSet`/`$pull`, so membership state is
 * established by direct seeding rather than service calls.
 */
function seedUser(
    db: ReturnType<typeof createMockDatabaseService>,
    id: string,
    groups: string[] = []
): void {
    const now = new Date();
    db.getCollectionData('users').push({
        id,
        groups,
        wallets: [],
        preferences: {},
        activity: {},
        createdAt: now,
        updatedAt: now
    });
}

/**
 * Minimal in-memory mock of `ICacheService`. The user-group service only
 * calls `invalidate()` so the rest of the surface area is no-op stubs.
 */
function createMockCache(): ICacheService {
    return {
        get: vi.fn(async () => null),
        set: vi.fn(async () => {}),
        invalidate: vi.fn(async () => {}),
        del: vi.fn(async () => 0),
        keys: vi.fn(async () => [])
    } as unknown as ICacheService;
}

describe('UserGroupService', () => {
    let mockDatabase: ReturnType<typeof createMockDatabaseService>;
    let mockCache: ICacheService;
    let service: UserGroupService;

    beforeEach(async () => {
        mockDatabase = createMockDatabaseService();
        mockCache = createMockCache();
        UserGroupService.resetInstance();
        UserGroupService.setDependencies(mockDatabase, mockCache, new StubLogger());
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

    // -------- Reserved-admin pattern --------

    describe('createGroup reserved-admin enforcement', () => {
        const rejectedSlugs = [
            'admin',
            'admins',
            'administrator',
            'administrators',
            'super-admin',
            'super-admins',
            'superadmin',
            'sub-admin',
            'subadmins',
            'root',
            'roots'
        ];

        for (const slug of rejectedSlugs) {
            it(`rejects "${slug}" as reserved`, async () => {
                await expect(
                    service.createGroup({ id: slug, name: 'X' })
                ).rejects.toThrow(/reserved|already exists/i);
            });
        }

        const acceptedSlugs = [
            'market-admin',
            'plugin-admins',
            'bazi-administrator',
            'admin-market',
            'vip-traders',
            'whale-watchers'
        ];

        for (const slug of acceptedSlugs) {
            it(`accepts "${slug}" as context-scoped`, async () => {
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

    // -------- Membership --------
    //
    // Note: membership write paths (`addMember`/`removeMember`/cascade on
    // delete) rely on `$addToSet` and `$pull`, neither of which is
    // implemented by the shared mock. We therefore seed membership state
    // directly and assert the read-side contract (`isMember`,
    // `getUserGroups`, error paths). The mutation paths are exercised
    // end-to-end by integration tests against a real database.

    describe('membership reads', () => {
        const userId = 'user-1';

        beforeEach(() => {
            seedUser(mockDatabase, userId, ['vip']);
            seedGroup(mockDatabase, { id: 'vip', name: 'VIP' });
        });

        it('isMember returns true when group is in user.groups', async () => {
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
        const userId = 'user-1';

        beforeEach(() => {
            seedUser(mockDatabase, userId);
        });

        it('addMember throws on unknown group', async () => {
            await expect(service.addMember(userId, 'nope')).rejects.toThrow(/does not exist/i);
        });

        it('addMember throws on unknown user', async () => {
            seedGroup(mockDatabase, { id: 'vip', name: 'VIP' });
            await expect(service.addMember('ghost', 'vip')).rejects.toThrow(/does not exist/i);
        });

        it('removeMember throws on unknown group', async () => {
            await expect(service.removeMember(userId, 'nope')).rejects.toThrow(/does not exist/i);
        });
    });

    // -------- setUserGroups --------

    describe('setUserGroups', () => {
        const userId = 'user-1';

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
            ).rejects.toThrow(/does not exist/i);
        });

        it('replaces user.groups atomically with dedup and lowercase', async () => {
            const result = await service.setUserGroups(userId, ['VIP', 'whales', 'vip']);
            expect(result).toEqual(['vip', 'whales']);
            // Confirm the persisted document reflects the new array, not the
            // originally-seeded ['vip']. The mock supports $set on top-level
            // fields, which is what the service uses for the atomic replace.
            const doc = mockDatabase.getCollectionData('users').find(u => u.id === userId);
            expect(doc?.groups).toEqual(['vip', 'whales']);
        });

        it('accepts an empty array to clear all memberships', async () => {
            const result = await service.setUserGroups(userId, []);
            expect(result).toEqual([]);
            const doc = mockDatabase.getCollectionData('users').find(u => u.id === userId);
            expect(doc?.groups).toEqual([]);
        });

        it('invalidates the user cache after a successful write', async () => {
            await service.setUserGroups(userId, ['whales']);
            expect(mockCache.invalidate).toHaveBeenCalledWith(`user:${userId}`);
        });
    });

    // -------- getMembers --------

    describe('getMembers', () => {
        beforeEach(() => {
            seedGroup(mockDatabase, { id: 'vip', name: 'VIP' });
            seedUser(mockDatabase, 'alice', ['vip']);
            seedUser(mockDatabase, 'bob', ['vip']);
            seedUser(mockDatabase, 'carol', []);
        });

        it('throws on unknown group so admin UIs can distinguish "no members" from "wrong slug"', async () => {
            await expect(service.getMembers('not-real')).rejects.toThrow(/does not exist/i);
        });

        it('returns the user ids that belong to the group with total count', async () => {
            const result = await service.getMembers('vip');
            expect(new Set(result.userIds)).toEqual(new Set(['alice', 'bob']));
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
        const adminUser = 'admin-user';
        const normalUser = 'normal-user';

        beforeEach(() => {
            seedUser(mockDatabase, adminUser, ['admin']);
            seedUser(mockDatabase, normalUser, ['vip-traders']);
            seedGroup(mockDatabase, { id: 'vip-traders', name: 'VIP Traders' });
        });

        it('returns true for member of system admin group', async () => {
            expect(await service.isAdmin(adminUser)).toBe(true);
        });

        it('returns false for member of admin-pattern group that is NOT system-flagged', async () => {
            // Forge a non-system group whose id matches the reserved-admin
            // pattern. The service refuses to create such rows itself, but
            // direct DB seeding bypasses validation. `isAdmin` must still
            // return false because the row's `system` flag is false.
            seedGroup(mockDatabase, { id: 'super-admin', name: 'Forged', system: false });
            seedUser(mockDatabase, 'forger', ['super-admin']);
            expect(await service.isAdmin('forger')).toBe(false);
        });

        it('returns false for non-admin user', async () => {
            expect(await service.isAdmin(normalUser)).toBe(false);
        });

        it('returns false for unknown user', async () => {
            expect(await service.isAdmin('ghost')).toBe(false);
        });
    });
});
