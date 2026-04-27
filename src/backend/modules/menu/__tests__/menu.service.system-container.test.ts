/// <reference types="vitest" />

/**
 * MenuService System container tests.
 *
 * Covers the auto-`requiresAdmin` walk-up rule: any node created or
 * reparented under `MAIN_SYSTEM_CONTAINER_ID` (or the container itself)
 * gets `requiresAdmin: true` forced on it, regardless of what the caller
 * passed. Also covers explicit string `_id` passthrough on memory-only
 * create, which is the mechanism used to seed the container with a
 * stable, hard-coded id.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ObjectId } from 'mongodb';
import type {
    IDatabaseService,
    IServiceRegistry,
    IServiceWatchHandlers,
    ServiceWatchDisposer
} from '@/types';

vi.mock('../../../../services/websocket.service.js', () => ({
    WebSocketService: {
        getInstance: vi.fn(() => ({ emit: vi.fn() }))
    }
}));

import { MenuService } from '../services/menu.service.js';
import { MAIN_SYSTEM_CONTAINER_ID } from '../constants.js';

function createDatabase(): IDatabaseService {
    const collections = new Map<string, any[]>();
    const buildCollection = (name: string) => {
        if (!collections.has(name)) collections.set(name, []);
        const data = collections.get(name)!;
        return {
            find: () => ({ toArray: async () => data }),
            findOne: async (filter: any) => data.find((d) => Object.entries(filter).every(([k, v]) => (k === '_id' && v instanceof ObjectId ? d._id?.equals?.(v) : d[k] === v))) ?? null,
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

function createRegistry(): IServiceRegistry {
    const services = new Map<string, unknown>();
    return {
        register: <T,>(name: string, service: T) => { services.set(name, service); },
        unregister: (name: string) => services.delete(name),
        get: <T,>(name: string) => services.get(name) as T | undefined,
        has: (name: string) => services.has(name),
        getNames: () => Array.from(services.keys()),
        watch: <T,>(_name: string, _handlers: IServiceWatchHandlers<T>): ServiceWatchDisposer => () => undefined
    };
}

describe('MenuService System container auto-requiresAdmin', () => {
    let svc: MenuService;

    beforeEach(async () => {
        vi.clearAllMocks();
        MenuService.__resetForTests();
        MenuService.setDependencies(createDatabase(), createRegistry());
        svc = MenuService.getInstance();
        await svc.initialize();
    });

    it('honors explicit string _id on memory-only create so the System container has a stable id', async () => {
        const container = await svc.create({
            _id: MAIN_SYSTEM_CONTAINER_ID,
            namespace: 'main',
            label: 'System',
            url: '/system',
            icon: 'Settings',
            order: 9999,
            parent: null,
            enabled: true
        });

        expect(container._id).toBe(MAIN_SYSTEM_CONTAINER_ID);
        expect(svc.getNode(MAIN_SYSTEM_CONTAINER_ID)?._id).toBe(MAIN_SYSTEM_CONTAINER_ID);
    });

    it('forces requiresAdmin: true on the System container itself, even if the caller omits the flag', async () => {
        const container = await svc.create({
            _id: MAIN_SYSTEM_CONTAINER_ID,
            namespace: 'main',
            label: 'System',
            url: '/system',
            order: 9999,
            parent: null,
            enabled: true
        });
        expect(container.requiresAdmin).toBe(true);
    });

    it('forces requiresAdmin: true on a direct child of the System container, regardless of caller intent', async () => {
        await svc.create({
            _id: MAIN_SYSTEM_CONTAINER_ID,
            namespace: 'main',
            label: 'System',
            url: '/system',
            order: 9999,
            parent: null,
            enabled: true
        });

        const child = await svc.create({
            namespace: 'main',
            label: 'Logs',
            url: '/system/logs',
            order: 30,
            parent: MAIN_SYSTEM_CONTAINER_ID,
            enabled: true
            // requiresAdmin intentionally omitted — engine should set it
        });
        expect(child.requiresAdmin).toBe(true);
    });

    it('forces requiresAdmin: true on a deeper descendant whose direct parent is not the container', async () => {
        await svc.create({
            _id: MAIN_SYSTEM_CONTAINER_ID,
            namespace: 'main',
            label: 'System',
            url: '/system',
            order: 9999,
            parent: null,
            enabled: true
        });
        const middle = await svc.create({
            namespace: 'main',
            label: 'Plugins',
            url: '/system/plugins',
            order: 65,
            parent: MAIN_SYSTEM_CONTAINER_ID,
            enabled: true
        });
        const leaf = await svc.create({
            namespace: 'main',
            label: 'Whale Alerts',
            url: '/system/plugins/whale-alerts',
            order: 10,
            parent: middle._id!,
            enabled: true
        });
        expect(leaf.requiresAdmin).toBe(true);
    });

    it('does NOT auto-set requiresAdmin on nodes that do not reach the System container', async () => {
        // No container seeded — a top-level main node stays ungated.
        const top = await svc.create({
            namespace: 'main',
            label: 'Markets',
            url: '/markets',
            order: 50,
            parent: null,
            enabled: true
        });
        expect(top.requiresAdmin).toBeUndefined();
    });

    it('overrides an explicit requiresAdmin: false on a System-subtree node', async () => {
        await svc.create({
            _id: MAIN_SYSTEM_CONTAINER_ID,
            namespace: 'main',
            label: 'System',
            url: '/system',
            order: 9999,
            parent: null,
            enabled: true
        });
        const child = await svc.create({
            namespace: 'main',
            label: 'Sneaky',
            url: '/system/sneaky',
            order: 1,
            parent: MAIN_SYSTEM_CONTAINER_ID,
            enabled: true,
            requiresAdmin: false
        });
        // Walk-up wins over caller input — gate is non-bypassable.
        expect(child.requiresAdmin).toBe(true);
    });

    it('forces requiresAdmin: true when an existing node is reparented INTO the System subtree via update()', async () => {
        await svc.create({
            _id: MAIN_SYSTEM_CONTAINER_ID,
            namespace: 'main',
            label: 'System',
            url: '/system',
            order: 9999,
            parent: null,
            enabled: true
        });
        const free = await svc.create({
            namespace: 'main',
            label: 'Floater',
            url: '/floater',
            order: 100,
            parent: null,
            enabled: true
        });
        expect(free.requiresAdmin).toBeUndefined();

        const moved = await svc.update(free._id!, { parent: MAIN_SYSTEM_CONTAINER_ID });
        expect(moved.requiresAdmin).toBe(true);
    });

    it('does not strip requiresAdmin when a node is reparented OUT of the System subtree', async () => {
        await svc.create({
            _id: MAIN_SYSTEM_CONTAINER_ID,
            namespace: 'main',
            label: 'System',
            url: '/system',
            order: 9999,
            parent: null,
            enabled: true
        });
        const inside = await svc.create({
            namespace: 'main',
            label: 'Inside',
            url: '/system/inside',
            order: 1,
            parent: MAIN_SYSTEM_CONTAINER_ID,
            enabled: true
        });
        expect(inside.requiresAdmin).toBe(true);

        // Move out from under the container — the gate is preserved
        // because dropping it is an explicit operator decision, not
        // something the engine should infer from the move alone.
        const moved = await svc.update(inside._id!, { parent: null, url: '/inside' });
        expect(moved.requiresAdmin).toBe(true);
    });
});
