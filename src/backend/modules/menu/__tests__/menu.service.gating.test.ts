/// <reference types="vitest" />

/**
 * MenuService gating filter tests.
 *
 * Covers `getTreeForUser` and `getChildrenForUser`: identity-state allow-list,
 * group OR-membership, admin predicate via the user-groups service registry
 * entry, and combinations. The mock `IUserGroupService` only stubs the
 * methods the filter actually calls (`isAdmin`, `isMember`); the registry is
 * a minimal in-memory implementation.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ObjectId } from 'mongodb';
import type {
    IDatabaseService,
    IServiceRegistry,
    IServiceWatchHandlers,
    ServiceWatchDisposer,
    IUser,
    IUserGroupService,
    UserIdentityState as UserIdentityStateType
} from '@/types';
import { UserIdentityState } from '@/types';

vi.mock('../../../../services/websocket.service.js', () => ({
    WebSocketService: {
        getInstance: vi.fn(() => ({ emit: vi.fn() }))
    }
}));

import { MenuService } from '../services/menu.service.js';

// Minimal in-memory database mock — enough surface for MenuService.initialize
// and the create() path used to seed gated nodes.
function createDatabase(): IDatabaseService {
    const collections = new Map<string, any[]>();

    const buildCollection = (name: string) => {
        if (!collections.has(name)) collections.set(name, []);
        const data = collections.get(name)!;
        return {
            find: () => ({ toArray: async () => data }),
            findOne: async (filter: any) => data.find((d) => Object.entries(filter).every(([k, v]) => (k === '_id' && v instanceof ObjectId ? d._id.equals(v) : d[k] === v))) ?? null,
            insertOne: async (doc: any) => {
                const id = new ObjectId();
                data.push({ ...doc, _id: id });
                return { insertedId: id, acknowledged: true };
            },
            updateOne: async () => ({ modifiedCount: 0, acknowledged: true }),
            deleteOne: async () => ({ deletedCount: 0, acknowledged: true }),
            createIndex: async () => 'idx',
            deleteMany: async () => ({ deletedCount: 0, acknowledged: true }),
            updateMany: async () => ({ modifiedCount: 0, acknowledged: true }),
            countDocuments: async () => data.length
        };
    };

    return {
        registerModel: () => undefined,
        getModel: () => undefined,
        initializeMigrations: async () => undefined,
        getMigrationsPending: async () => [],
        getMigrationsCompleted: async () => [],
        executeMigration: async () => undefined,
        executeMigrationsAll: async () => undefined,
        isMigrationRunning: () => false,
        getCollection: <T>(name: string) => buildCollection(name) as any,
        get: async () => undefined,
        set: async () => undefined,
        delete: async () => false,
        createIndex: async () => undefined,
        count: async () => 0,
        find: async () => [],
        findOne: async () => null,
        insertOne: async () => new ObjectId() as any,
        updateMany: async () => 0,
        deleteMany: async () => 0
    } as unknown as IDatabaseService;
}

// In-memory IServiceRegistry. The MenuService only calls `get`, but a full
// implementation lets test setup wire services in the standard way.
function createRegistry(): IServiceRegistry {
    const services = new Map<string, unknown>();
    return {
        register: <T,>(name: string, service: T) => {
            services.set(name, service);
        },
        unregister: (name: string) => services.delete(name),
        get: <T,>(name: string) => services.get(name) as T | undefined,
        has: (name: string) => services.has(name),
        getNames: () => Array.from(services.keys()),
        watch: <T,>(name: string, handlers: IServiceWatchHandlers<T>): ServiceWatchDisposer => {
            const svc = services.get(name) as T | undefined;
            if (svc !== undefined && handlers.onAvailable) void handlers.onAvailable(svc);
            return () => undefined;
        }
    };
}

// Stub IUserGroupService implementing only what the menu filter calls. The
// admin predicate uses the user's `groups[]` array as an allow-list, since the
// MenuService never asks the service for membership directly — group-membership
// checks read off the user object in-memory.
function createGroupsService(adminUserIds: Set<string>): IUserGroupService {
    return {
        listGroups: async () => [],
        getGroup: async () => null,
        createGroup: async () => { throw new Error('not used'); },
        updateGroup: async () => { throw new Error('not used'); },
        deleteGroup: async () => undefined,
        getUserGroups: async (userId: string) => [],
        isMember: async (userId: string, groupId: string) => false,
        addMember: async () => undefined,
        removeMember: async () => undefined,
        setUserGroups: async () => [],
        getMembers: async () => ({ userIds: [], total: 0 }),
        isAdmin: async (userId: string) => adminUserIds.has(userId)
    } as IUserGroupService;
}

function makeUser(overrides: Partial<IUser> = {}): IUser {
    return {
        id: 'u-1',
        identityState: UserIdentityState.Verified,
        identityVerifiedAt: new Date(),
        wallets: [],
        preferences: {} as IUser['preferences'],
        activity: { firstSeen: new Date(), lastSeen: new Date(), pageViews: 0 } as IUser['activity'],
        groups: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        ...overrides
    };
}

describe('MenuService gating filter', () => {
    let db: IDatabaseService;
    let registry: IServiceRegistry;
    let svc: MenuService;

    beforeEach(async () => {
        vi.clearAllMocks();
        db = createDatabase();
        registry = createRegistry();
        MenuService.__resetForTests();
        MenuService.setDependencies(db, registry);
        svc = MenuService.getInstance();
        await svc.initialize();
    });

    it('treats a missing user as anonymous and shows only ungated or anonymous-allowed nodes', async () => {
        await svc.create({ namespace: 'main', label: 'Public', url: '/p', order: 1, parent: null, enabled: true });
        await svc.create({ namespace: 'main', label: 'Anon-only', url: '/a', order: 2, parent: null, enabled: true, allowedIdentityStates: [UserIdentityState.Anonymous] });
        await svc.create({ namespace: 'main', label: 'Verified-only', url: '/v', order: 3, parent: null, enabled: true, allowedIdentityStates: [UserIdentityState.Verified] });

        const tree = await svc.getTreeForUser('main', undefined);
        const labels = tree.all.map((n) => n.label).sort();
        // Default Home is auto-created on empty initialize — include it.
        expect(labels).toEqual(['Anon-only', 'Home', 'Public']);
    });

    it('hides anonymous-only nodes from a verified user and shows verified-only nodes', async () => {
        await svc.create({ namespace: 'main', label: 'Anon-only', url: '/a', order: 1, parent: null, enabled: true, allowedIdentityStates: [UserIdentityState.Anonymous] });
        await svc.create({ namespace: 'main', label: 'Verified-only', url: '/v', order: 2, parent: null, enabled: true, allowedIdentityStates: [UserIdentityState.Verified] });

        const verified = makeUser({ id: 'u-verified', identityState: UserIdentityState.Verified });
        const tree = await svc.getTreeForUser('main', verified);
        const labels = tree.all.map((n) => n.label).sort();
        expect(labels).toEqual(['Home', 'Verified-only']);
    });

    it('honors the "verified or anonymous" combination', async () => {
        await svc.create({ namespace: 'main', label: 'Mixed', url: '/m', order: 1, parent: null, enabled: true, allowedIdentityStates: [UserIdentityState.Anonymous, UserIdentityState.Verified] });

        const anon = await svc.getTreeForUser('main', undefined);
        expect(anon.all.some((n) => n.label === 'Mixed')).toBe(true);

        const verified = await svc.getTreeForUser('main', makeUser({ id: 'u-verified', identityState: UserIdentityState.Verified }));
        expect(verified.all.some((n) => n.label === 'Mixed')).toBe(true);

        const registered = await svc.getTreeForUser('main', makeUser({ id: 'u-reg', identityState: UserIdentityState.Registered }));
        expect(registered.all.some((n) => n.label === 'Mixed')).toBe(false);
    });

    it('shows group-gated nodes only to users in any required group', async () => {
        await svc.create({ namespace: 'main', label: 'VIP', url: '/vip', order: 1, parent: null, enabled: true, requiresGroups: ['vip-traders', 'whales'] });

        const outsider = await svc.getTreeForUser('main', makeUser({ id: 'u-out', groups: [] }));
        expect(outsider.all.some((n) => n.label === 'VIP')).toBe(false);

        const insider = await svc.getTreeForUser('main', makeUser({ id: 'u-in', groups: ['whales'] }));
        expect(insider.all.some((n) => n.label === 'VIP')).toBe(true);
    });

    it('treats missing user-groups service as "no admin" — admin-gated nodes hidden from everyone', async () => {
        await svc.create({ namespace: 'main', label: 'Admin', url: '/admin', order: 1, parent: null, enabled: true, requiresAdmin: true });

        const tree = await svc.getTreeForUser('main', makeUser({ id: 'u-1', groups: ['admin'] }));
        // No user-groups service registered yet — isAdmin always returns false.
        expect(tree.all.some((n) => n.label === 'Admin')).toBe(false);
    });

    it('shows admin-gated nodes when the user is an admin per the registered service', async () => {
        registry.register('user-groups', createGroupsService(new Set(['u-admin'])));

        await svc.create({ namespace: 'main', label: 'Admin', url: '/admin', order: 1, parent: null, enabled: true, requiresAdmin: true });

        const admin = await svc.getTreeForUser('main', makeUser({ id: 'u-admin' }));
        expect(admin.all.some((n) => n.label === 'Admin')).toBe(true);

        const peasant = await svc.getTreeForUser('main', makeUser({ id: 'u-peasant' }));
        expect(peasant.all.some((n) => n.label === 'Admin')).toBe(false);
    });

    it('ANDs identity-state, group, and admin predicates together', async () => {
        registry.register('user-groups', createGroupsService(new Set(['u-admin'])));

        await svc.create({
            namespace: 'main',
            label: 'AdminAndVerifiedAndVip',
            url: '/x',
            order: 1,
            parent: null,
            enabled: true,
            allowedIdentityStates: [UserIdentityState.Verified],
            requiresGroups: ['vip-traders'],
            requiresAdmin: true
        });

        // Wrong on every axis
        const noFit = await svc.getTreeForUser('main', makeUser({ id: 'u-1', identityState: UserIdentityState.Anonymous, groups: [] }));
        expect(noFit.all.some((n) => n.label === 'AdminAndVerifiedAndVip')).toBe(false);

        // Verified but missing group + not admin
        const verifiedOnly = await svc.getTreeForUser('main', makeUser({ id: 'u-2', identityState: UserIdentityState.Verified, groups: [] }));
        expect(verifiedOnly.all.some((n) => n.label === 'AdminAndVerifiedAndVip')).toBe(false);

        // Hits all three predicates
        const allFit = await svc.getTreeForUser('main', makeUser({ id: 'u-admin', identityState: UserIdentityState.Verified, groups: ['vip-traders'] }));
        expect(allFit.all.some((n) => n.label === 'AdminAndVerifiedAndVip')).toBe(true);
    });

    it('getChildrenForUser applies the same gating to direct children', async () => {
        const parent = await svc.create({ namespace: 'main', label: 'Tools', url: '/tools', order: 1, parent: null, enabled: true });
        await svc.create({ namespace: 'main', label: 'Public-tool', url: '/tools/p', order: 1, parent: parent._id!, enabled: true });
        await svc.create({ namespace: 'main', label: 'Verified-tool', url: '/tools/v', order: 2, parent: parent._id!, enabled: true, allowedIdentityStates: [UserIdentityState.Verified] });

        const anonChildren = await svc.getChildrenForUser(parent._id!, 'main', undefined);
        expect(anonChildren.map((n) => n.label).sort()).toEqual(['Public-tool']);

        const verifiedChildren = await svc.getChildrenForUser(parent._id!, 'main', makeUser({ id: 'u-v', identityState: UserIdentityState.Verified }));
        expect(verifiedChildren.map((n) => n.label).sort()).toEqual(['Public-tool', 'Verified-tool']);
    });
});
