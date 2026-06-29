/**
 * @fileoverview Tests for the account-history module.
 *
 * Covers the two-phase module lifecycle (metadata, init/run phase separation,
 * route mounting, scheduler registration, service publication) and the service's
 * source-of-truth behaviors that don't depend on seeded collection data: pacing
 * defaults and clamping, address validation, the ClickHouse-absent no-ops, and
 * the pure ClickHouse-row projection.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { IBlockTransaction, IMenuService, ISchedulerService, ISystemLogService } from '@/types';
import { createMockDatabaseService } from '../../../tests/vitest/mocks/database-service.js';
import { createMockServiceRegistry } from '../../../tests/vitest/mocks/service-registry.js';
import { AccountHistoryModule } from '../AccountHistoryModule.js';
import { AccountHistoryService } from '../services/account-history.service.js';
import { toAccountTransactionRow } from '../providers/trongrid-account-history.provider.js';
import type { IAccountHistoryProvider } from '../providers/IAccountHistoryProvider.js';

/** A real base58 TRON address (the USDT contract) for validation-passing cases. */
const VALID_ADDRESS = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';

/**
 * A no-op logger satisfying ISystemLogService for tests that don't assert on logs.
 *
 * @returns A logger whose methods do nothing and whose `child` returns itself.
 */
function createSilentLogger(): ISystemLogService {
    const logger = {
        info() {}, warn() {}, error() {}, debug() {}, trace() {}, fatal() {},
        child() { return logger; }
    };
    return logger as unknown as ISystemLogService;
}

/**
 * Build a menu-service mock whose `create` resolves, for module-run assertions.
 *
 * @returns A mock IMenuService.
 */
function createMenuMock(): IMenuService {
    return { create: vi.fn().mockResolvedValue({ id: 'menu-node' }) } as unknown as IMenuService;
}

/**
 * Build a scheduler mock recording job registrations.
 *
 * @returns A mock ISchedulerService.
 */
function createSchedulerMock(): ISchedulerService {
    return {
        register: vi.fn(),
        disable: vi.fn().mockResolvedValue(undefined),
        unregister: vi.fn().mockResolvedValue(undefined)
    } as unknown as ISchedulerService;
}

describe('AccountHistoryModule', () => {
    beforeEach(() => {
        AccountHistoryService.resetForTests();
    });

    it('exposes correct metadata', () => {
        const module = new AccountHistoryModule();
        expect(module.metadata.id).toBe('account-history');
        expect(module.metadata.name).toBe('Account History');
        expect(module.metadata.version).toBe('1.0.0');
    });

    it('does not mount routes during init()', async () => {
        const app = { use: vi.fn() };
        const module = new AccountHistoryModule();
        await module.init({
            database: createMockDatabaseService(),
            app: app as never,
            menuService: createMenuMock(),
            scheduler: createSchedulerMock(),
            clickhouse: undefined,
            serviceRegistry: createMockServiceRegistry()
        });
        expect(app.use).not.toHaveBeenCalled();
    });

    it('throws if run() is called before init()', async () => {
        const module = new AccountHistoryModule();
        await expect(module.run()).rejects.toThrow();
    });

    it('mounts routes, registers the ingestion job, and publishes the service during run()', async () => {
        const app = { use: vi.fn() };
        const scheduler = createSchedulerMock();
        const serviceRegistry = createMockServiceRegistry();
        const module = new AccountHistoryModule();

        await module.init({
            database: createMockDatabaseService(),
            app: app as never,
            menuService: createMenuMock(),
            scheduler,
            clickhouse: undefined,
            serviceRegistry
        });
        await module.run();

        expect(app.use).toHaveBeenCalledWith(
            '/api/admin/system/account-history',
            expect.anything(),
            expect.anything(),
            expect.any(Function)
        );
        expect(scheduler.register).toHaveBeenCalledWith('account-history:ingest', expect.any(String), expect.any(Function));
        expect(serviceRegistry.has('account-history')).toBe(true);
    });
});

describe('AccountHistoryService', () => {
    /**
     * Configure a fresh service with the given provider and no ClickHouse.
     *
     * @param provider - The provider to inject, or null.
     * @returns The configured service instance.
     */
    function buildService(provider: IAccountHistoryProvider | null) {
        AccountHistoryService.resetForTests();
        AccountHistoryService.setDependencies({
            database: createMockDatabaseService(),
            clickhouse: undefined,
            provider,
            emitter: undefined,
            logger: createSilentLogger()
        });
        return AccountHistoryService.getInstance();
    }

    beforeEach(() => {
        AccountHistoryService.resetForTests();
    });

    it('returns default pacing settings when none are stored', async () => {
        const service = buildService(null);
        const settings = await service.getSettings();
        expect(settings).toEqual({ ingestionEnabled: true, pagesPerTick: 5, accountsPerTick: 3 });
    });

    it('clamps non-positive pacing dials to at least 1', async () => {
        const service = buildService(null);
        const settings = await service.updateSettings({ pagesPerTick: 0, accountsPerTick: -4 });
        expect(settings.pagesPerTick).toBe(1);
        expect(settings.accountsPerTick).toBe(1);
    });

    it('rejects a non-base58 tracked address', async () => {
        const service = buildService(null);
        await expect(service.addTrackedAccount({ address: 'not-an-address' })).rejects.toThrow();
    });

    it('returns an empty page when ClickHouse is unavailable', async () => {
        const service = buildService(null);
        const page = await service.getTransactions({ address: VALID_ADDRESS });
        expect(page).toEqual({ transactions: [], total: 0 });
    });

    it('runIngestionTick is a no-op without ClickHouse and never calls the provider', async () => {
        const provider: IAccountHistoryProvider = { id: 'test', fetchPage: vi.fn() };
        const service = buildService(provider);
        await service.runIngestionTick();
        expect(provider.fetchPage).not.toHaveBeenCalled();
    });
});

describe('toAccountTransactionRow', () => {
    it('projects a transaction into a flat ClickHouse row with null-coalesced optionals', () => {
        const tx: IBlockTransaction = {
            txId: 'abc',
            blockNumber: 100,
            timestamp: new Date('2024-01-01T00:00:00.000Z'),
            type: 'TriggerSmartContract',
            status: 'SUCCESS',
            from: { address: 'Tfrom' },
            to: { address: 'Tto' },
            contract: { address: 'Tcontract', method: '0xa9059cbb' },
            memo: null
        };
        const row = toAccountTransactionRow('Tacct', tx, '2024-01-01 00:00:00.000', '2024-06-01 00:00:00.000');

        expect(row.account).toBe('Tacct');
        expect(row.tx_id).toBe('abc');
        expect(row.type).toBe('TriggerSmartContract');
        expect(row.contract_address).toBe('Tcontract');
        expect(row.contract_method).toBe('0xa9059cbb');
        expect(row.amount_sun).toBeNull();
        expect(row.energy_consumed).toBeNull();
        expect(row.memo).toBeNull();
        expect(row.ingested_at).toBe('2024-06-01 00:00:00.000');
    });
});
