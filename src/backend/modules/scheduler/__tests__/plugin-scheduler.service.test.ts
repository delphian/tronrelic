/// <reference types="vitest" />

/**
 * @fileoverview Tests for the per-plugin scheduler facade.
 *
 * These cover the regression the facade exists to prevent: a plugin disabled from
 * the admin UI used to leave its cron jobs registered, so they kept firing on
 * their schedule for the life of the process, and uninstalling the plugin left
 * both the job and its `scheduler_configs` document behind.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ISystemLogService } from '@/types';
import { PluginSchedulerService, type IPluginSchedulerHost } from '../services/plugin-scheduler.service.js';

/**
 * Minimal ISystemLogService stub.
 *
 * The facade logs on teardown failures and on a plugin unregistering a job it
 * does not own, so tests need a logger that records calls without pulling in the
 * real logging stack.
 */
class MockLogger implements ISystemLogService {
    public fatal = vi.fn();
    public error = vi.fn();
    public warn = vi.fn();
    public info = vi.fn();
    public debug = vi.fn();
    public trace = vi.fn();
    public child = vi.fn((_bindings: Record<string, unknown>): ISystemLogService => this);

    public level = 'info';
    public async initialize() {}
    public async saveLog() {}
    public async getLogs() { return { logs: [], total: 0, page: 1, limit: 50, totalPages: 0, hasNextPage: false, hasPrevPage: false }; }
    public async markAsResolved() {}
    public async cleanup() { return 0; }
    public async getStatistics() { return { total: 0, byLevel: {} as any, byService: {}, unresolved: 0 }; }
    public async getLogById() { return null; }
    public async markAsUnresolved() { return null; }
    public async deleteAllLogs() { return 0; }
    public async getStats() { return { total: 0, byLevel: {} as any, resolved: 0, unresolved: 0 }; }
}

/**
 * In-memory stand-in for the shared scheduler.
 *
 * Reproduces the two behaviours the facade is built around: `unregister` throws
 * for a name it does not hold, and `deleteJobConfigs` removes stored
 * configuration without caring whether the job is registered.
 */
class MockSchedulerHost implements IPluginSchedulerHost {
    /** Job names currently registered, standing in for the scheduler's job map. */
    public readonly registered = new Set<string>();

    /** Job names with a stored configuration document. */
    public readonly configs = new Set<string>();

    /** Every unregister call, so tests can assert the delete flag that was passed. */
    public readonly unregisterCalls: Array<{ name: string; deleteFromDatabase: boolean }> = [];

    /**
     * Register a job, rejecting a duplicate the way the real scheduler does.
     *
     * @param name - Job identifier.
     */
    public register(name: string): void {
        if (this.registered.has(name)) {
            throw new Error(`Job ${name} already registered`);
        }
        this.registered.add(name);
        this.configs.add(name);
    }

    /**
     * Disable a job without unregistering it.
     *
     * @param name - Job identifier.
     */
    public async disable(name: string): Promise<void> {
        if (!this.registered.has(name)) {
            throw new Error(`Job ${name} not registered`);
        }
    }

    /**
     * Unregister a job, refusing a name that is not registered.
     *
     * @param name - Job identifier.
     * @param deleteFromDatabase - Whether to also drop the stored configuration.
     */
    public async unregister(name: string, deleteFromDatabase: boolean = false): Promise<void> {
        this.unregisterCalls.push({ name, deleteFromDatabase });
        if (!this.registered.has(name)) {
            throw new Error(`Job ${name} not registered`);
        }
        this.registered.delete(name);
        if (deleteFromDatabase) {
            this.configs.delete(name);
        }
    }

    /**
     * Report whether a name is currently registered.
     *
     * The facade asks this before delegating an unregister, so it can tell a name
     * that exists nowhere from one another owner holds.
     *
     * @param name - Job name to look for.
     * @returns True when this mock currently holds the name.
     */
    public hasJob(name: string): boolean {
        return this.registered.has(name);
    }

    /**
     * Delete stored configuration by name, regardless of registration state.
     *
     * @param names - Job names to purge.
     * @returns Count of documents removed.
     */
    public async deleteJobConfigs(names: string[]): Promise<number> {
        let deleted = 0;
        for (const name of names) {
            if (this.configs.delete(name)) {
                deleted += 1;
            }
        }

        return deleted;
    }
}

describe('PluginSchedulerService', () => {
    let host: MockSchedulerHost;
    let logger: MockLogger;
    let facade: PluginSchedulerService;

    beforeEach(() => {
        host = new MockSchedulerHost();
        logger = new MockLogger();
        facade = new PluginSchedulerService('demo', host, logger);
    });

    describe('register()', () => {
        it('passes the registration through to the shared scheduler', () => {
            const handler = vi.fn();
            facade.register('demo:refresh', '*/5 * * * *', handler);

            expect(host.registered.has('demo:refresh')).toBe(true);
        });

        it('does not track a registration the shared scheduler rejected', async () => {
            host.register('demo:refresh');

            expect(() => facade.register('demo:refresh', '*/5 * * * *', vi.fn())).toThrow(/already registered/);

            // Teardown must not try to unregister a job this facade never created.
            const unregistered = await facade.unregisterAll(false);
            expect(unregistered).toBe(0);
            expect(host.unregisterCalls).toHaveLength(0);
        });
    });

    describe('unregisterAll() on disable', () => {
        it('unregisters every job the plugin registered', async () => {
            facade.register('demo:refresh', '*/5 * * * *', vi.fn());
            facade.register('demo:sweep', '0 * * * *', vi.fn());

            const unregistered = await facade.unregisterAll(false);

            expect(unregistered).toBe(2);
            expect(host.registered.size).toBe(0);
        });

        it('keeps stored configuration so an operator schedule edit survives a toggle', async () => {
            facade.register('demo:refresh', '*/5 * * * *', vi.fn());

            await facade.unregisterAll(false);

            expect(host.configs.has('demo:refresh')).toBe(true);
            expect(host.unregisterCalls).toEqual([{ name: 'demo:refresh', deleteFromDatabase: false }]);
        });

        it('keeps unregistering after one job throws', async () => {
            facade.register('demo:first', '*/5 * * * *', vi.fn());
            facade.register('demo:second', '0 * * * *', vi.fn());

            // Simulate the shared scheduler losing a job behind the facade's back,
            // which makes its unregister throw.
            host.registered.delete('demo:first');

            const unregistered = await facade.unregisterAll(false);

            // Only the job that actually stopped is counted. The caller logs this
            // number as "jobs unregistered", so counting the failure too would
            // report a job as stopped while the warning beside it says otherwise.
            expect(unregistered).toBe(1);
            expect(host.registered.has('demo:second')).toBe(false);
            expect(logger.warn).toHaveBeenCalled();
        });

        it('does not double-unregister a job the plugin already released itself', async () => {
            facade.register('demo:refresh', '*/5 * * * *', vi.fn());

            // A plugin disable hook that cleans up after itself.
            await facade.unregister('demo:refresh');
            host.unregisterCalls.length = 0;

            const unregistered = await facade.unregisterAll(false);

            expect(unregistered).toBe(0);
            expect(host.unregisterCalls).toHaveLength(0);
        });
    });

    describe('unregisterAll() on uninstall', () => {
        it('deletes stored configuration for jobs still registered', async () => {
            facade.register('demo:refresh', '*/5 * * * *', vi.fn());

            await facade.unregisterAll(true);

            expect(host.configs.has('demo:refresh')).toBe(false);
        });

        it('deletes stored configuration left behind by an earlier disable', async () => {
            facade.register('demo:refresh', '*/5 * * * *', vi.fn());

            // The uninstall path disables the plugin first, which unregisters the
            // job but deliberately keeps its configuration document.
            await facade.unregisterAll(false);
            expect(host.configs.has('demo:refresh')).toBe(true);

            await facade.unregisterAll(true);

            expect(host.configs.has('demo:refresh')).toBe(false);
        });
    });

    describe('unregister()', () => {
        it('purges configuration instead of throwing for a job already released', async () => {
            facade.register('demo:refresh', '*/5 * * * *', vi.fn());
            await facade.unregister('demo:refresh');

            // The shipped pattern: the disable hook unregisters, then the uninstall
            // hook unregisters again asking for the configuration to go too.
            await expect(facade.unregister('demo:refresh', true)).resolves.toBeUndefined();
            expect(host.configs.has('demo:refresh')).toBe(false);
        });

        it('refuses a live job registered by something other than this plugin', async () => {
            host.register('blockchain:sync');

            // A stale constant in a plugin hook must not be able to stop a core job.
            await expect(facade.unregister('blockchain:sync')).rejects.toThrow(/may only unregister its own jobs/);
            expect(host.registered.has('blockchain:sync')).toBe(true);
            expect(host.unregisterCalls).toHaveLength(0);
        });
    });

    describe('lifecycle window', () => {
        it('rejects a registration made after teardown', async () => {
            await facade.unregisterAll(false);

            expect(() => facade.register('demo:late', '*/5 * * * *', vi.fn()))
                .toThrow(/after its lifecycle window closed/);
            expect(host.registered.size).toBe(0);
        });

        it('accepts registrations again once rearmed for a re-enable', async () => {
            facade.register('demo:refresh', '*/5 * * * *', vi.fn());
            await facade.unregisterAll(false);

            facade.rearm();
            facade.register('demo:refresh', '*/5 * * * *', vi.fn());

            expect(host.registered.has('demo:refresh')).toBe(true);
        });

        it('tracks jobs registered after a rearm so the next disable still tears them down', async () => {
            facade.register('demo:refresh', '*/5 * * * *', vi.fn());
            await facade.unregisterAll(false);
            facade.rearm();
            facade.register('demo:refresh', '*/5 * * * *', vi.fn());

            const unregistered = await facade.unregisterAll(false);

            expect(unregistered).toBe(1);
            expect(host.registered.size).toBe(0);
        });
    });
});
