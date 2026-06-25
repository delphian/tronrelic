/**
 * @file syndication-module.test.ts
 *
 * Lifecycle contract for the syndication module: metadata, the two-phase split
 * (init prepares, run activates), fail-fast when the content router is missing,
 * the relay-job registration and its graceful skip when the scheduler is absent,
 * and the `'syndication'` service publication.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Express } from 'express';
import type { IContentRouter, ISchedulerService } from '@/types';
import { createMockDatabaseService } from '../../../tests/vitest/mocks/database-service.js';
import { createMockServiceRegistry } from '../../../tests/vitest/mocks/service-registry.js';
import { CONTENT_ROUTER_SERVICE } from '../../../services/content-router.js';
import { SyndicationModule, SYNDICATION_RELAY_JOB } from '../index.js';

/**
 * Assemble module dependencies with a seeded content router, a spied scheduler,
 * and a spied Express app, so a test can assert exactly what `run()` wired.
 *
 * @param withScheduler - Whether to provide a scheduler (false exercises the disabled path).
 * @returns The dependency bundle plus the spies for assertions.
 */
function makeDeps(withScheduler = true) {
    const router = { getSinks: () => [] } as unknown as IContentRouter;
    const serviceRegistry = createMockServiceRegistry({ [CONTENT_ROUTER_SERVICE]: router });
    const scheduler = { register: vi.fn(), disable: vi.fn(), unregister: vi.fn() } as unknown as ISchedulerService;
    const app = { use: vi.fn() } as unknown as Express;
    return {
        deps: { database: createMockDatabaseService(), serviceRegistry, scheduler: withScheduler ? scheduler : null, app },
        scheduler,
        app,
        serviceRegistry
    };
}

describe('SyndicationModule', () => {
    let mod: SyndicationModule;

    beforeEach(() => {
        mod = new SyndicationModule();
    });

    it('declares correct metadata', () => {
        expect(mod.metadata.id).toBe('syndication');
        expect(mod.metadata.name).toBe('Syndication');
        expect(mod.metadata.version).toBe('1.0.0');
    });

    it('does not mount routes or register the job during init()', async () => {
        const { deps, scheduler, app } = makeDeps();
        await mod.init(deps);
        expect(scheduler.register).not.toHaveBeenCalled();
        expect(app.use).not.toHaveBeenCalled();
    });

    it('throws during init() when the content router is not published', async () => {
        const { deps } = makeDeps();
        const serviceRegistry = createMockServiceRegistry({}); // no content-router
        await expect(mod.init({ ...deps, serviceRegistry })).rejects.toThrow(/content-router/);
    });

    it('registers the relay job, mounts the operator router, and publishes the service in run()', async () => {
        const { deps, scheduler, app, serviceRegistry } = makeDeps();
        await mod.init(deps);
        await mod.run();

        expect(scheduler.register).toHaveBeenCalledWith(SYNDICATION_RELAY_JOB, expect.any(String), expect.any(Function));
        expect(app.use).toHaveBeenCalledWith('/api/admin/system/syndication', expect.any(Function), expect.any(Function));
        expect(serviceRegistry.get('syndication')).toBe(mod.getSyndication());
    });

    it('skips relay registration but still publishes the service when the scheduler is absent', async () => {
        const { deps, scheduler, serviceRegistry } = makeDeps(false);
        await mod.init(deps);
        await mod.run();

        expect(scheduler.register).not.toHaveBeenCalled();
        expect(serviceRegistry.get('syndication')).toBe(mod.getSyndication());
    });
});
