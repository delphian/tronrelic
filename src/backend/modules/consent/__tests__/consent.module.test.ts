/**
 * @fileoverview Lifecycle tests for the consent module: metadata, the init/run
 * split, registry publication, and the admin gate on the management router.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockDatabaseService } from '../../../tests/vitest/mocks/database-service.js';
import { ConsentModule, CONSENT_SERVICE_NAME } from '../index.js';
import { ConsentService } from '../services/consent.service.js';
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
        app: { use: vi.fn() } as any
    };
}

describe('ConsentModule', () => {
    beforeEach(() => {
        ConsentService.resetForTests();
    });

    it('exposes correct metadata', () => {
        const module = new ConsentModule();
        expect(module.metadata.id).toBe('consent');
        expect(module.metadata.name).toBe('Consent');
        expect(module.metadata.version).toBe('1.0.0');
    });

    it('init() builds the service and indexes without mounting routes', async () => {
        const module = new ConsentModule();
        const deps = createDeps();
        const createIndex = vi.spyOn(deps.database, 'createIndex');
        await module.init(deps);
        expect(deps.app.use).not.toHaveBeenCalled();
        expect(deps.serviceRegistry.register).not.toHaveBeenCalled();
        expect(createIndex).toHaveBeenCalledWith('module_consent_settings', { key: 1 }, { unique: true });
        expect(createIndex).toHaveBeenCalledWith('module_consent_pageview_daily', { day: 1 }, { unique: true });
        expect(module.getConsentService()).toBeInstanceOf(ConsentService);
    });

    it('run() before init() throws', async () => {
        const module = new ConsentModule();
        await expect(module.run()).rejects.toThrow('before init');
    });

    it('getConsentService() before init() throws, so bootstrap cannot hand traffic an unwired service', () => {
        const module = new ConsentModule();
        expect(() => module.getConsentService()).toThrow('before init');
    });

    it('run() publishes the service, mounts both routers, and registers the admin page and its tabs', async () => {
        const module = new ConsentModule();
        const deps = createDeps();
        await module.init(deps);
        await module.run();

        expect(deps.serviceRegistry.register).toHaveBeenCalledWith(CONSENT_SERVICE_NAME, module.getConsentService());
        const mounts = deps.app.use.mock.calls.map((call: unknown[]) => call[0]);
        expect(mounts).toContain('/api/consent');
        expect(mounts).toContain('/api/admin/system/consent');
        expect(deps.menuService.create).toHaveBeenCalledWith(
            expect.objectContaining({ url: '/system/consent', namespace: 'main' })
        );
        const tabs = deps.menuService.create.mock.calls
            .map((call: unknown[]) => call[0] as { namespace: string; url: string; requiresAdmin?: boolean })
            .filter((node: { namespace: string }) => node.namespace === 'consent');
        expect(tabs.map((node: { url: string }) => node.url)).toEqual([
            '/system/consent?tab=settings',
            '/system/consent?tab=database',
            '/system/consent?tab=logs'
        ]);
        expect(tabs.every((node: { requiresAdmin?: boolean }) => node.requiresAdmin === true)).toBe(true);
    });

    it('run() puts requireAdmin in front of the management router only', async () => {
        // The public router serves the config every page request needs, so
        // gating it would break the site; the management router must be gated
        // because its handlers trust the mount-time check.
        const module = new ConsentModule();
        const deps = createDeps();
        await module.init(deps);
        await module.run();

        const mountFor = (path: string): unknown[] =>
            deps.app.use.mock.calls.find((call: unknown[]) => call[0] === path) ?? [];
        const adminMount = mountFor('/api/admin/system/consent');
        expect(adminMount.indexOf(requireAdmin)).toBeGreaterThan(0);
        expect(adminMount.indexOf(requireAdmin)).toBeLessThan(adminMount.length - 1);
        expect(mountFor('/api/consent')).not.toContain(requireAdmin);
    });
});
