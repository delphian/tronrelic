/// <reference types="vitest" />

/**
 * @fileoverview Lifecycle tests for the ClickHouse accounts module: metadata,
 * init/run phase separation, the inactive path without ClickHouse, and what
 * `run()` wires up.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockDatabaseService } from '../../../tests/vitest/mocks/database-service.js';
import {
    ClickHouseAccountsModule,
    CLICKHOUSE_ACCOUNTS_JOB_PREFIX,
    CLICKHOUSE_ACCOUNTS_SERVICE_NAME
} from '../index.js';
import { ClickHouseAccountService } from '../services/ClickHouseAccountService.js';

/**
 * Build the module's dependencies with spies on each integration point.
 *
 * @param withClickHouse - Whether ClickHouse is configured.
 * @returns Mock dependencies for `init()`.
 */
function createDeps(withClickHouse: boolean) {
    const clickhouse = {
        query: vi.fn().mockResolvedValue([]),
        insert: vi.fn().mockResolvedValue(undefined),
        exec: vi.fn().mockResolvedValue(undefined),
        ping: vi.fn().mockResolvedValue(true),
        rootUser: vi.fn().mockReturnValue('default'),
        hasRootPassword: vi.fn().mockReturnValue(true),
        accountPasswordHash: vi.fn().mockReturnValue('c'.repeat(64)),
        openReader: vi.fn()
    };

    return {
        database: createMockDatabaseService(),
        clickhouse: withClickHouse ? clickhouse as any : undefined,
        connector: withClickHouse ? clickhouse as any : undefined,
        scheduler: { register: vi.fn(), disable: vi.fn(), unregister: vi.fn() } as any,
        serviceRegistry: { register: vi.fn(), get: vi.fn(), watch: vi.fn() } as any,
        app: { use: vi.fn() } as any
    };
}

describe('ClickHouseAccountsModule', () => {
    beforeEach(() => {
        ClickHouseAccountService.resetForTests();
    });

    it('exposes correct metadata', () => {
        const module = new ClickHouseAccountsModule();
        expect(module.metadata.id).toBe('clickhouse-accounts');
        expect(module.metadata.name).toBe('ClickHouse Accounts');
        expect(module.metadata.version).toBe('1.0.0');
    });

    it('run() before init() throws', async () => {
        await expect(new ClickHouseAccountsModule().run()).rejects.toThrow();
    });

    it('init() creates storage without mounting routes, publishing, or applying accounts', async () => {
        const module = new ClickHouseAccountsModule();
        const deps = createDeps(true);
        await module.init(deps);
        expect(deps.app.use).not.toHaveBeenCalled();
        expect(deps.serviceRegistry.register).not.toHaveBeenCalled();
        expect(deps.clickhouse.exec).toHaveBeenCalledTimes(1);
        expect(deps.clickhouse.exec.mock.calls[0][0]).toContain('CREATE TABLE IF NOT EXISTS clickhouse_account_usage_daily');
        expect(module.getAccountService()).toBeInstanceOf(ClickHouseAccountService);
    });

    it('stays inactive when ClickHouse is not configured', async () => {
        const module = new ClickHouseAccountsModule();
        const deps = createDeps(false);
        await module.init(deps);
        await module.run();
        expect(module.getAccountService()).toBeNull();
        expect(deps.app.use).not.toHaveBeenCalled();
        expect(deps.scheduler.register).not.toHaveBeenCalled();
    });

    it('run() applies accounts, publishes the service, mounts the admin API, and registers a prefixed job', async () => {
        const module = new ClickHouseAccountsModule();
        const deps = createDeps(true);
        await module.init(deps);
        await module.run();
        expect(deps.clickhouse.exec.mock.calls.some((call: string[]) => call[0].startsWith('CREATE USER IF NOT EXISTS `tronrelic_ai_agent`'))).toBe(true);
        expect(deps.serviceRegistry.register).toHaveBeenCalledWith(CLICKHOUSE_ACCOUNTS_SERVICE_NAME, module.getAccountService());
        expect(deps.app.use).toHaveBeenCalledWith('/api/admin/system/clickhouse-accounts', expect.any(Function), expect.any(Function), expect.any(Function));
        const jobNames = deps.scheduler.register.mock.calls.map((call: unknown[]) => call[0] as string);
        expect(jobNames.length).toBeGreaterThan(0);
        expect(jobNames.every((name: string) => name.startsWith(CLICKHOUSE_ACCOUNTS_JOB_PREFIX))).toBe(true);
    });
});
