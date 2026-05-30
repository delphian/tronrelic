/// <reference types="vitest" />

/**
 * MenuService gating filter tests.
 *
 * Covers `getTreeForUser` and `getChildrenForUser`: group OR-membership and
 * the admin predicate, driven by the `IMenuViewer` resolved from the Better
 * Auth session. An `undefined` viewer denotes an anonymous visitor, who sees
 * only ungated nodes.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ObjectId } from 'mongodb';
import type { IDatabaseService, IMenuViewer } from '@/types';

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

/** Build a viewer with the given groups and admin flag. */
function viewer(groups: string[], isAdmin = false): IMenuViewer {
    return { groups, isAdmin };
}

describe('MenuService gating filter', () => {
    let db: IDatabaseService;
    let svc: MenuService;

    beforeEach(async () => {
        vi.clearAllMocks();
        db = createDatabase();
        MenuService.__resetForTests();
        MenuService.setDependencies(db);
        svc = MenuService.getInstance();
        await svc.initialize();
    });

    it('treats an undefined viewer as anonymous and shows only ungated nodes', async () => {
        await svc.create({ namespace: 'main', label: 'Public', url: '/p', order: 1, parent: null, enabled: true });
        await svc.create({ namespace: 'main', label: 'VIP', url: '/vip', order: 2, parent: null, enabled: true, requiresGroups: ['vip-traders'] });
        await svc.create({ namespace: 'main', label: 'Admin', url: '/admin', order: 3, parent: null, enabled: true, requiresAdmin: true });

        const tree = await svc.getTreeForUser('main', undefined);
        const labels = tree.all.map((n) => n.label).sort();
        // Default Home is auto-created on empty initialize — include it.
        expect(labels).toEqual(['Home', 'Public']);
    });

    it('shows group-gated nodes only to viewers in any required group', async () => {
        await svc.create({ namespace: 'main', label: 'VIP', url: '/vip', order: 1, parent: null, enabled: true, requiresGroups: ['vip-traders', 'whales'] });

        const outsider = await svc.getTreeForUser('main', viewer([]));
        expect(outsider.all.some((n) => n.label === 'VIP')).toBe(false);

        const insider = await svc.getTreeForUser('main', viewer(['whales']));
        expect(insider.all.some((n) => n.label === 'VIP')).toBe(true);
    });

    it('hides admin-gated nodes from non-admin viewers (even with an "admin" group string)', async () => {
        await svc.create({ namespace: 'main', label: 'Admin', url: '/admin', order: 1, parent: null, enabled: true, requiresAdmin: true });

        const nonAdmin = await svc.getTreeForUser('main', viewer(['admin'], false));
        expect(nonAdmin.all.some((n) => n.label === 'Admin')).toBe(false);
    });

    it('shows admin-gated nodes to admin viewers', async () => {
        await svc.create({ namespace: 'main', label: 'Admin', url: '/admin', order: 1, parent: null, enabled: true, requiresAdmin: true });

        const admin = await svc.getTreeForUser('main', viewer([], true));
        expect(admin.all.some((n) => n.label === 'Admin')).toBe(true);
    });

    it('ANDs group and admin predicates together', async () => {
        await svc.create({
            namespace: 'main',
            label: 'AdminAndVip',
            url: '/x',
            order: 1,
            parent: null,
            enabled: true,
            requiresGroups: ['vip-traders'],
            requiresAdmin: true
        });

        // Admin but missing the required group.
        const adminNoGroup = await svc.getTreeForUser('main', viewer([], true));
        expect(adminNoGroup.all.some((n) => n.label === 'AdminAndVip')).toBe(false);

        // In the group but not admin.
        const groupNoAdmin = await svc.getTreeForUser('main', viewer(['vip-traders'], false));
        expect(groupNoAdmin.all.some((n) => n.label === 'AdminAndVip')).toBe(false);

        // Satisfies both predicates.
        const both = await svc.getTreeForUser('main', viewer(['vip-traders'], true));
        expect(both.all.some((n) => n.label === 'AdminAndVip')).toBe(true);
    });

    it('getChildrenForUser applies the same gating to direct children', async () => {
        const parent = await svc.create({ namespace: 'main', label: 'Tools', url: '/tools', order: 1, parent: null, enabled: true });
        await svc.create({ namespace: 'main', label: 'Public-tool', url: '/tools/p', order: 1, parent: parent._id!, enabled: true });
        await svc.create({ namespace: 'main', label: 'VIP-tool', url: '/tools/v', order: 2, parent: parent._id!, enabled: true, requiresGroups: ['vip-traders'] });

        const anonChildren = await svc.getChildrenForUser(parent._id!, 'main', undefined);
        expect(anonChildren.map((n) => n.label).sort()).toEqual(['Public-tool']);

        const vipChildren = await svc.getChildrenForUser(parent._id!, 'main', viewer(['vip-traders']));
        expect(vipChildren.map((n) => n.label).sort()).toEqual(['Public-tool', 'VIP-tool']);
    });
});
