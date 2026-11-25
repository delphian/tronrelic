/**
 * Lifecycle tests for the address explorer module.
 *
 * Pin the two-phase contract every module follows: `init()` prepares without
 * mounting anything, `run()` mounts the login-gated router, a missing
 * dependency stops startup, and `run()` before `init()` fails loudly.
 */
import { describe, it, expect, vi } from 'vitest';
import type { Express } from 'express';
import type { IAddressActivityReader } from '@/types';
import { AddressExplorerModule, ADDRESS_EXPLORER_API_PATH } from '../AddressExplorerModule.js';

/**
 * Build the module's dependencies with a spy for `app.use`.
 *
 * @returns The dependencies and the spy.
 */
function buildDeps() {
    const use = vi.fn();
    const app = { use } as unknown as Express;
    const reader = { retentionDays: 21 } as unknown as IAddressActivityReader;
    return { deps: { reader, app }, use };
}

describe('AddressExplorerModule', () => {
    it('declares its metadata', () => {
        const module = new AddressExplorerModule();

        expect(module.metadata).toEqual(expect.objectContaining({ id: 'address-explorer', name: 'Address Explorer', version: '1.0.0' }));
    });

    it('mounts nothing during init()', async () => {
        const { deps, use } = buildDeps();

        await new AddressExplorerModule().init(deps);

        expect(use).not.toHaveBeenCalled();
    });

    it('refuses to start without a reader', async () => {
        const { deps } = buildDeps();

        await expect(new AddressExplorerModule().init({ ...deps, reader: undefined as unknown as IAddressActivityReader })).rejects.toThrow();
    });

    it('throws when run() is called before init()', async () => {
        await expect(new AddressExplorerModule().run()).rejects.toThrow();
    });

    it('mounts the router behind a rate limiter and the login gate during run()', async () => {
        const { deps, use } = buildDeps();
        const module = new AddressExplorerModule();

        await module.init(deps);
        await module.run();

        expect(use).toHaveBeenCalledTimes(1);
        const [path, ...handlers] = use.mock.calls[0];
        expect(path).toBe(ADDRESS_EXPLORER_API_PATH);
        // Rate limiter, requireLogin, then the router.
        expect(handlers).toHaveLength(3);
        expect(handlers[1].name).toBe('requireLogin');
    });
});
