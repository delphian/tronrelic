/**
 * @fileoverview Lifecycle tests for the address-tags module: metadata,
 * init/run phase separation, registry publication, and gated router mounting.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockDatabaseService } from '../../../tests/vitest/mocks/database-service.js';
import { AddressTagsModule } from '../index.js';
import { AddressTagService } from '../services/address-tag.service.js';

/**
 * Build the minimal collaborator set the module needs, with spies on the
 * integration points the tests assert against.
 *
 * @returns Mock dependencies for `init()`.
 */
function createDeps() {
    return {
        database: createMockDatabaseService(),
        serviceRegistry: { register: vi.fn(), get: vi.fn(), watch: vi.fn() } as any,
        menuService: { create: vi.fn(async () => ({})) } as any,
        app: { use: vi.fn() } as any,
        scheduler: null as any
    };
}

describe('AddressTagsModule', () => {
    beforeEach(() => {
        AddressTagService.resetForTests();
    });

    it('exposes correct metadata', () => {
        const module = new AddressTagsModule();
        expect(module.metadata.id).toBe('address-tags');
        expect(module.metadata.name).toBe('Address Tags');
        expect(module.metadata.version).toBe('1.0.0');
    });

    it('init() prepares the service without mounting routes', async () => {
        const module = new AddressTagsModule();
        const deps = createDeps();
        await module.init(deps);
        expect(deps.app.use).not.toHaveBeenCalled();
        expect(deps.serviceRegistry.register).not.toHaveBeenCalled();
        expect(module.getAddressTagService()).toBeInstanceOf(AddressTagService);
    });

    it('run() before init() throws', async () => {
        const module = new AddressTagsModule();
        await expect(module.run()).rejects.toThrow();
    });

    it('init() logs an error naming the backfill migration while unstamped documents exist', async () => {
        // Backstop for the two-deploy provenance rollout: if the liveness
        // filter ships before the 001 migration runs, every tag vanishes from
        // every surface. The named-migration error line is what makes that
        // state diagnosable instead of looking like an empty collection.
        const module = new AddressTagsModule();
        const deps = createDeps();
        deps.database.getCollectionData('module_address-tags_tags').push({
            address: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
            tag: 'legacy',
            createdAt: new Date(),
            updatedAt: new Date()
        });
        const errorSpy = vi.spyOn((module as any).logger, 'error');
        await module.init(deps);
        expect(errorSpy).toHaveBeenCalledWith(
            expect.objectContaining({ unstamped: 1, migration: 'module:address-tags:001_add_provenance_fields' }),
            expect.stringContaining('001_add_provenance_fields')
        );
    });

    it('init() stays quiet when every document carries provenance', async () => {
        const module = new AddressTagsModule();
        const deps = createDeps();
        const errorSpy = vi.spyOn((module as any).logger, 'error');
        await module.init(deps);
        expect(errorSpy).not.toHaveBeenCalled();
    });

    it('run() publishes the service, mounts both routers, and registers the menu item', async () => {
        const module = new AddressTagsModule();
        const deps = createDeps();
        await module.init(deps);
        await module.run();

        expect(deps.serviceRegistry.register).toHaveBeenCalledWith('address-tags', module.getAddressTagService());
        const mounts = deps.app.use.mock.calls.map((call: unknown[]) => call[0]);
        expect(mounts).toContain('/api/address-tags');
        expect(mounts).toContain('/api/admin/system/address-tags');
        expect(deps.menuService.create).toHaveBeenCalledWith(
            expect.objectContaining({ url: '/system/address-tags', namespace: 'main' })
        );
    });

    it('run() registers the submenu tab nodes with per-node admin gating', async () => {
        const module = new AddressTagsModule();
        const deps = createDeps();
        await module.init(deps);
        await module.run();

        const tabCalls = deps.menuService.create.mock.calls
            .map((call: unknown[]) => call[0] as { namespace: string; url: string; requiresAdmin?: boolean })
            .filter((node: { namespace: string }) => node.namespace === 'address-tags');
        // Schedules and Database are part of the row, not optional extras: a
        // module owning scheduler jobs or a collection has to surface both on
        // its own admin page, and dropping either node would silently send an
        // operator back to /system to find this module's rows by hand.
        //
        // The order is asserted, not just the membership. Settings must stay
        // last, after the four tabs that report what the module is doing, so
        // moving it back between them is a visible failure rather than a silent
        // reshuffle of the row.
        expect(tabCalls.map((node: { url: string }) => node.url)).toEqual([
            '/system/address-tags?tab=tags',
            '/system/address-tags?tab=sources',
            '/system/address-tags?tab=schedules',
            '/system/address-tags?tab=database',
            '/system/address-tags?tab=settings'
        ]);
        // Outside the System container the non-bypassable admin force does not
        // reach these nodes, so each must carry its own gate.
        expect(tabCalls.every((node: { requiresAdmin?: boolean }) => node.requiresAdmin === true)).toBe(true);
    });

    it('run() registers the three ingestion jobs when a scheduler is present, none otherwise', async () => {
        const withScheduler = createDeps();
        withScheduler.scheduler = { register: vi.fn(), disable: vi.fn(), unregister: vi.fn() };
        const module = new AddressTagsModule();
        await module.init(withScheduler);
        await module.run();
        const names = withScheduler.scheduler.register.mock.calls.map((call: unknown[]) => call[0]);
        expect(names).toEqual([
            'address-tags:sync-ofac',
            'address-tags:sync-usdt-blacklist',
            'address-tags:verify-frozen'
        ]);
        // The Schedules tab picks this module's jobs out of the deployment-wide
        // list by name prefix, and the frontend keeps its own copy of that
        // literal because it cannot import backend code. A job registered
        // without the prefix would simply not appear on the tab, with no error
        // anywhere, so assert the shared assumption here.
        expect(names.every((name: string) => name.startsWith('address-tags:'))).toBe(true);

        AddressTagService.resetForTests();
        const without = createDeps();
        const bare = new AddressTagsModule();
        await bare.init(without);
        // A null scheduler (tests, ENABLE_SCHEDULER=false) must not throw and
        // must register nothing — that absence is the ingestion kill switch.
        await expect(bare.run()).resolves.not.toThrow();
    });
});
