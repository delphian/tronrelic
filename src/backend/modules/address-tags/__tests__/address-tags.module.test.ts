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
        app: { use: vi.fn() } as any
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
});
