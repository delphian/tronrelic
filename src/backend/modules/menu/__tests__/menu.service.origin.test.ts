/// <reference types="vitest" />

/**
 * Origin-resolution tests for `MenuService.getTreeAdminView`.
 *
 * Covers the three states the admin UI distinguishes (`manual`,
 * `plugin`, `plugin-overridden`), plus the supporting invariants:
 *
 * - Override-keys cache hydrates from the `menu_node_overrides`
 *   collection on init (so a memory-only node registered after restart
 *   immediately reads as `plugin-overridden`).
 * - `saveOverride` adds both the original URL and any renamed URL to
 *   the in-memory cache, so the badge stays consistent when an admin
 *   patches a plugin node's URL during the live session.
 * - `getTreeAdminView` projects the `origin` field onto both `roots`
 *   and the flat `all` list.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { IDatabaseService } from '@/types';
import { ObjectId } from 'mongodb';

vi.mock('../../../../services/websocket.service.js', () => ({
    WebSocketService: {
        getInstance: vi.fn(() => ({ emit: vi.fn() }))
    }
}));

// Import MenuService AFTER mocking WebSocketService so the singleton
// captures the mock instance during emit calls.
import { MenuService } from '../services/menu.service.js';

/**
 * Minimal in-memory IDatabaseService mock that supports the subset of
 * Mongo operations MenuService exercises for these tests: find/findOne,
 * insertOne, updateOne (with `$set`, `$setOnInsert`, and `upsert`), and
 * createIndex. Other interface methods stub out as no-ops because the
 * code paths under test never reach them.
 */
class MockDatabase implements IDatabaseService {
    private collections = new Map<string, any[]>();

    registerModel(): void {}
    getModel(): any { return undefined; }
    async initializeMigrations(): Promise<void> {}
    async getMigrationsPending(): Promise<any[]> { return []; }
    async getMigrationsCompleted(): Promise<any[]> { return []; }
    async executeMigration(): Promise<void> {}
    async executeMigrationsAll(): Promise<void> {}
    isMigrationRunning(): boolean { return false; }
    async createIndex(): Promise<void> {}
    async count(): Promise<number> { return 0; }
    async find(): Promise<any[]> { return []; }
    async findOne(): Promise<any> { return null; }
    async insertOne(): Promise<any> { return new ObjectId(); }
    async updateMany(): Promise<number> { return 0; }
    async deleteMany(): Promise<number> { return 0; }
    async get(): Promise<any> { return undefined; }
    async set(): Promise<void> {}
    async delete(): Promise<boolean> { return false; }

    /**
     * Pre-seed a collection with documents — used to plant override
     * rows before `MenuService.initialize()` so the hydration path can
     * be exercised.
     */
    seed(name: string, docs: any[]): void {
        const items = docs.map((doc) => ({ _id: doc._id ?? new ObjectId(), ...doc }));
        this.collections.set(name, items);
    }

    clear(): void {
        this.collections.clear();
    }

    getCollection<T = any>(name: string) {
        if (!this.collections.has(name)) {
            this.collections.set(name, []);
        }
        const data = this.collections.get(name)!;

        const matches = (filter: any) => (doc: any) =>
            Object.entries(filter).every(([key, value]) => {
                if (key === '_id' && value instanceof ObjectId) {
                    return doc._id?.equals?.(value);
                }
                return doc[key] === value;
            });

        return {
            find: vi.fn((filter: any = {}, _options?: any) => ({
                toArray: vi.fn(async () => {
                    if (Object.keys(filter).length === 0) return data;
                    return data.filter(matches(filter));
                }),
                sort: vi.fn(function (this: any) { return this; }),
                skip: vi.fn(function (this: any) { return this; }),
                limit: vi.fn(function (this: any) { return this; })
            })),
            findOne: vi.fn(async (filter: any) => data.find(matches(filter)) ?? null),
            insertOne: vi.fn(async (doc: any) => {
                const id = new ObjectId();
                data.push({ ...doc, _id: id });
                return { insertedId: id, acknowledged: true };
            }),
            updateOne: vi.fn(async (filter: any, update: any, options?: any) => {
                const idx = data.findIndex(matches(filter));
                if (idx !== -1) {
                    data[idx] = { ...data[idx], ...(update.$set ?? {}) };
                    return { modifiedCount: 1, acknowledged: true };
                }
                if (options?.upsert) {
                    const id = new ObjectId();
                    data.push({
                        _id: id,
                        ...(update.$setOnInsert ?? {}),
                        ...(update.$set ?? {})
                    });
                    return {
                        modifiedCount: 0,
                        upsertedCount: 1,
                        upsertedId: id,
                        acknowledged: true
                    };
                }
                return { modifiedCount: 0, acknowledged: true };
            }),
            deleteOne: vi.fn(async (filter: any) => {
                const idx = data.findIndex(matches(filter));
                if (idx !== -1) {
                    data.splice(idx, 1);
                    return { deletedCount: 1, acknowledged: true };
                }
                return { deletedCount: 0, acknowledged: true };
            }),
            countDocuments: vi.fn(async () => data.length),
            createIndex: vi.fn(async () => 'index_name')
        } as any;
    }
}

describe('MenuService origin resolution', () => {
    let menuService: MenuService;
    let mockDatabase: MockDatabase;

    const newService = async () => {
        (MenuService as any).instance = undefined;
        MenuService.setDependencies(mockDatabase);
        const svc = MenuService.getInstance();
        await svc.initialize();
        return svc;
    };

    beforeEach(() => {
        vi.clearAllMocks();
        mockDatabase = new MockDatabase();
    });

    afterEach(() => {
        mockDatabase.clear();
    });

    /**
     * Tags as `manual` when the node lives in `menu_nodes`.
     */
    it('tags admin-created nodes as origin="manual"', async () => {
        menuService = await newService();
        const node = await menuService.create(
            { label: 'Dashboard', url: '/dashboard', order: 10, enabled: true },
            true
        );

        const tree = menuService.getTreeAdminView('main');
        const projected = tree.all.find((n) => n._id === node._id);

        expect(projected?.origin).toBe('manual');
    });

    /**
     * Tags as `plugin` when the node is memory-only with no override row.
     */
    it('tags memory-only nodes as origin="plugin" when no override exists', async () => {
        menuService = await newService();
        const node = await menuService.create(
            { label: 'Whale Alerts', url: '/plugins/whale-alerts', order: 50, enabled: true },
            false
        );

        const tree = menuService.getTreeAdminView('main');
        const projected = tree.all.find((n) => n._id === node._id);

        expect(projected?.origin).toBe('plugin');
    });

    /**
     * Tags as `plugin-overridden` once an admin patches a memory-only node
     * with `persist=true` — `saveOverride` upserts the override row and
     * adds the key to the in-memory cache.
     */
    it('tags memory-only nodes as origin="plugin-overridden" after an admin override', async () => {
        menuService = await newService();
        const node = await menuService.create(
            { label: 'Whale Alerts', url: '/plugins/whale-alerts', order: 50, enabled: true },
            false
        );

        await menuService.update(node._id!, { order: 5 }, true);

        const tree = menuService.getTreeAdminView('main');
        const projected = tree.all.find((n) => n._id === node._id);

        expect(projected?.origin).toBe('plugin-overridden');
    });

    /**
     * Hydration path: an override row that exists in Mongo before
     * `initialize()` runs should make the matching memory-only node
     * read as `plugin-overridden` from the first admin tree fetch.
     */
    it('hydrates the override-keys cache from menu_node_overrides on initialize', async () => {
        mockDatabase.seed('menu_node_overrides', [{
            namespace: 'main',
            url: '/plugins/whale-alerts',
            order: 5,
            createdAt: new Date(),
            updatedAt: new Date()
        }]);

        menuService = await newService();
        const node = await menuService.create(
            { label: 'Whale Alerts', url: '/plugins/whale-alerts', order: 50, enabled: true },
            false
        );

        const tree = menuService.getTreeAdminView('main');
        const projected = tree.all.find((n) => n._id === node._id);

        expect(projected?.origin).toBe('plugin-overridden');
    });

    /**
     * When an admin renames a plugin node's URL during the live session,
     * the override row stays keyed by the original URL (the canonical
     * plugin-registered identity), but the in-memory node carries the
     * new URL. The cache must hold both keys so `resolveOrigin` still
     * tags the in-memory node as overridden — without this, the origin
     * badge would flicker off until the next service restart.
     */
    it('keeps origin="plugin-overridden" when an admin renames the URL during the session', async () => {
        menuService = await newService();
        const node = await menuService.create(
            { label: 'Whale Alerts', url: '/plugins/whale-alerts', order: 50, enabled: true },
            false
        );

        await menuService.update(
            node._id!,
            { url: '/plugins/whales', label: 'Whales' },
            true
        );

        const tree = menuService.getTreeAdminView('main');
        const projected = tree.all.find((n) => n._id === node._id);

        expect(projected?.url).toBe('/plugins/whales');
        expect(projected?.origin).toBe('plugin-overridden');
    });

    /**
     * `getTreeAdminView` must populate origin on both the hierarchical
     * `roots` projection and the flat `all` list — consumers iterate
     * either depending on the UI surface.
     */
    it('projects origin onto both roots and the flat all list', async () => {
        menuService = await newService();
        const manual = await menuService.create(
            { label: 'Dashboard', url: '/dashboard', order: 10, enabled: true },
            true
        );
        const plugin = await menuService.create(
            { label: 'Plugin', url: '/plugins/p', order: 20, enabled: true },
            false
        );

        const tree = menuService.getTreeAdminView('main');

        const manualInAll = tree.all.find((n) => n._id === manual._id);
        const pluginInAll = tree.all.find((n) => n._id === plugin._id);
        expect(manualInAll?.origin).toBe('manual');
        expect(pluginInAll?.origin).toBe('plugin');

        const manualInRoots = tree.roots.find((n) => n._id === manual._id);
        const pluginInRoots = tree.roots.find((n) => n._id === plugin._id);
        expect(manualInRoots?.origin).toBe('manual');
        expect(pluginInRoots?.origin).toBe('plugin');
    });
});
