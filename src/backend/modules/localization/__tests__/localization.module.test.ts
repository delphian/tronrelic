/**
 * @fileoverview Lifecycle tests for the localization module: metadata, the
 * init/run split, registry publication, and the admin gate on the management
 * router.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockDatabaseService } from '../../../tests/vitest/mocks/database-service.js';
import { LocalizationModule, LOCALIZATION_SERVICE_NAME } from '../index.js';
import { LocalizationService } from '../services/localization.service.js';
import { requireAdmin } from '../../../api/middleware/admin-auth.js';

/**
 * Build the collaborators the module needs, with spies on the integration
 * points the tests assert against.
 *
 * @returns Mock dependencies for `init()`.
 */
function createDeps() {
    return {
        database: createMockDatabaseService(),
        serviceRegistry: { register: vi.fn(), get: vi.fn(), watch: vi.fn() } as any,
        menuService: { create: vi.fn(async () => ({})) } as any,
        app: { use: vi.fn() } as any,
        listKnownPaths: vi.fn(async () => [] as string[]),
        listKnownNamespaces: vi.fn(() => ['core'])
    };
}

describe('LocalizationModule', () => {
    beforeEach(() => {
        LocalizationService.resetForTests();
    });

    it('exposes correct metadata', () => {
        const module = new LocalizationModule();
        expect(module.metadata.id).toBe('localization');
        expect(module.metadata.name).toBe('Localization');
        expect(module.metadata.version).toBe('1.0.0');
    });

    it('init() builds the services and indexes without mounting routes', async () => {
        const module = new LocalizationModule();
        const deps = createDeps();
        const createIndex = vi.spyOn(deps.database, 'createIndex');
        await module.init(deps);
        expect(deps.app.use).not.toHaveBeenCalled();
        expect(deps.serviceRegistry.register).not.toHaveBeenCalled();
        expect(createIndex).toHaveBeenCalledWith('module_localization_languages', { code: 1 }, { unique: true });
        expect(module.getLocalizationService()).toBeInstanceOf(LocalizationService);
    });

    it('run() before init() throws', async () => {
        const module = new LocalizationModule();
        await expect(module.run()).rejects.toThrow('before init');
    });

    it('run() publishes the service, mounts both routers, and registers the admin page and its tabs', async () => {
        const module = new LocalizationModule();
        const deps = createDeps();
        await module.init(deps);
        await module.run();

        expect(deps.serviceRegistry.register).toHaveBeenCalledWith(LOCALIZATION_SERVICE_NAME, module.getLocalizationService());
        const mounts = deps.app.use.mock.calls.map((call: unknown[]) => call[0]);
        expect(mounts).toContain('/api/localization');
        expect(mounts).toContain('/api/admin/system/localization');
        expect(deps.menuService.create).toHaveBeenCalledWith(
            expect.objectContaining({ url: '/system/localization', namespace: 'main' })
        );
        const tabUrls = deps.menuService.create.mock.calls
            .map((call: unknown[]) => call[0] as { namespace: string; url: string; requiresAdmin?: boolean })
            .filter((node: { namespace: string }) => node.namespace === 'localization');
        expect(tabUrls.map((node: { url: string }) => node.url)).toEqual([
            '/system/localization?tab=languages',
            '/system/localization?tab=routes',
            '/system/localization?tab=translations',
            '/system/localization?tab=switches',
            '/system/localization?tab=settings',
            '/system/localization?tab=database',
            '/system/localization?tab=logs'
        ]);
        expect(tabUrls.every((node: { requiresAdmin?: boolean }) => node.requiresAdmin === true)).toBe(true);
    });

    it('run() puts requireAdmin in front of the management router only', async () => {
        // The public router carries the reads every page render needs, so
        // gating it would break the site; the management router must be gated
        // because its handlers trust the mount-time check.
        const module = new LocalizationModule();
        const deps = createDeps();
        await module.init(deps);
        await module.run();

        const mountFor = (path: string): unknown[] =>
            deps.app.use.mock.calls.find((call: unknown[]) => call[0] === path) ?? [];
        const adminMount = mountFor('/api/admin/system/localization');
        expect(adminMount.indexOf(requireAdmin)).toBeGreaterThan(0);
        expect(adminMount.indexOf(requireAdmin)).toBeLessThan(adminMount.length - 1);
        expect(mountFor('/api/localization')).not.toContain(requireAdmin);
    });
});
