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
import type { IBlockTransaction, IClickHouseService, IHookRegistry, IMenuService, ISchedulerService, ISystemLogService, IValueTransfer } from '@/types';
import { createMockDatabaseService } from '../../../tests/vitest/mocks/database-service.js';
import { createMockServiceRegistry } from '../../../tests/vitest/mocks/service-registry.js';
import { AccountHistoryModule } from '../AccountHistoryModule.js';
import { AccountHistoryService } from '../services/account-history.service.js';
import { PROGRESS_COLLECTION, SETTINGS_COLLECTION, SETTINGS_KEY, TRACKED_COLLECTION, TRANSACTIONS_TABLE, VALUE_TRANSFERS_TABLE } from '../database/index.js';
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

/**
 * Build a hook-registry mock whose `register` returns a disposer, so the
 * module's `run()` can wire its `http.walletLinked` handler.
 *
 * @returns A mock IHookRegistry.
 */
function createHookRegistryMock(): IHookRegistry {
    return {
        register: vi.fn().mockReturnValue(() => {}),
        invoke: vi.fn().mockResolvedValue(undefined)
    } as unknown as IHookRegistry;
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
            serviceRegistry: createMockServiceRegistry(),
            hookRegistry: createHookRegistryMock()
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

        const hookRegistry = createHookRegistryMock();
        const menuService = createMenuMock();
        await module.init({
            database: createMockDatabaseService(),
            app: app as never,
            menuService,
            scheduler,
            clickhouse: undefined,
            serviceRegistry,
            hookRegistry
        });
        await module.run();

        expect(app.use).toHaveBeenCalledWith(
            '/api/admin/system/account-history',
            expect.anything(),
            expect.anything(),
            expect.any(Function)
        );
        expect(app.use).toHaveBeenCalledWith(
            '/api/account-history',
            expect.anything(),
            expect.anything(),
            expect.any(Function)
        );
        expect(scheduler.register).toHaveBeenCalledWith('account-history:ingest', expect.any(String), expect.any(Function));
        expect(scheduler.register).toHaveBeenCalledWith('account-history:forward-sync', expect.any(String), expect.any(Function));
        expect(serviceRegistry.has('account-history')).toBe(true);

        // The System-container entry plus the three in-page tab nodes (the
        // Submenu Pattern): tabs live in their own namespace, outside the System
        // container, so the module sets `requiresAdmin` on them explicitly.
        expect(menuService.create).toHaveBeenCalledWith(expect.objectContaining({ namespace: 'main', label: 'Account History' }));
        expect(menuService.create).toHaveBeenCalledWith(expect.objectContaining({
            namespace: 'account-history',
            url: '/system/account-history?tab=accounts',
            requiresAdmin: true
        }));
        expect(menuService.create).toHaveBeenCalledTimes(4);
        expect(hookRegistry.register).toHaveBeenCalledWith(
            'core',
            expect.objectContaining({ id: 'http.walletLinked' }),
            expect.any(Function),
            expect.anything()
        );
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

    it('getValueTransfers returns [] without ClickHouse and maps ledger rows otherwise', async () => {
        // Absent ClickHouse yields an empty read, mirroring getTransactions.
        expect(await buildService(null).getValueTransfers({ address: VALID_ADDRESS })).toEqual([]);

        // With a stored value-leg row, the read reads account_value_transfers (never
        // the transaction table) and projects the row back to IValueTransfer: a null
        // asset_decimals collapses to undefined, amount_raw stays a string.
        AccountHistoryService.resetForTests();
        const row = {
            account: VALID_ADDRESS,
            tx_id: 'h1',
            origin: 'internal',
            leg_key: 'ik1',
            asset_type: 'TRX',
            asset_id: '',
            from_address: 'Tcontract',
            to_address: VALID_ADDRESS,
            amount_raw: '700000000',
            asset_decimals: null,
            block_number: 42,
            timestamp: '2024-01-01 00:00:00.000',
            ingested_at: '2024-06-01 00:00:00.000'
        };
        const clickhouse = { query: vi.fn().mockResolvedValue([row]), insert: vi.fn() } as unknown as IClickHouseService;
        AccountHistoryService.setDependencies({ database: createMockDatabaseService(), clickhouse, provider: null, emitter: undefined, logger: createSilentLogger() });

        const legs: IValueTransfer[] = await AccountHistoryService.getInstance().getValueTransfers({ address: VALID_ADDRESS });

        expect(legs).toHaveLength(1);
        expect(legs[0]).toMatchObject({ txId: 'h1', origin: 'internal', assetType: 'TRX', amountRaw: '700000000', blockNumber: 42 });
        expect(legs[0].assetDecimals).toBeUndefined();
        expect(clickhouse.query).toHaveBeenCalledWith(
            expect.stringContaining(VALUE_TRANSFERS_TABLE),
            expect.objectContaining({ address: VALID_ADDRESS })
        );
        // The value ledger has no tx/trc20 twin, so the read carries no dedupe filter.
        expect(clickhouse.query).not.toHaveBeenCalledWith(expect.stringContaining("source = 'trc20'"), expect.anything());
    });

    it('getValueTransfers pages by a keyset cursor, not offset', async () => {
        // A plain offset cannot page account_value_transfers safely: forward-sync
        // inserts newer legs concurrently, and timestamp alone is not a unique sort
        // key (one transaction can emit several legs sharing it). The keyset
        // predicate compares the full physical sort tuple instead, so a page
        // boundary is a stable watermark regardless of concurrent inserts.
        AccountHistoryService.resetForTests();
        const clickhouse = { query: vi.fn().mockResolvedValue([]), insert: vi.fn() } as unknown as IClickHouseService;
        AccountHistoryService.setDependencies({ database: createMockDatabaseService(), clickhouse, provider: null, emitter: undefined, logger: createSilentLogger() });

        await AccountHistoryService.getInstance().getValueTransfers({
            address: VALID_ADDRESS,
            limit: 500,
            cursor: {
                timestamp: new Date('2024-01-05T00:00:00.000Z'),
                txId: 'h5',
                origin: 'native',
                legKey: '',
                assetId: ''
            }
        });

        expect(clickhouse.query).toHaveBeenCalledWith(
            expect.stringContaining('(timestamp, tx_id, origin, leg_key, asset_id) <'),
            expect.objectContaining({
                address: VALID_ADDRESS,
                limit: 500,
                cursorTs: '2024-01-05 00:00:00.000',
                cursorTxId: 'h5',
                cursorOrigin: 'native',
                cursorLegKey: '',
                cursorAssetId: ''
            })
        );

        // Without a cursor, the first page carries no keyset predicate.
        await AccountHistoryService.getInstance().getValueTransfers({ address: VALID_ADDRESS });
        expect(clickhouse.query).toHaveBeenLastCalledWith(
            expect.not.stringContaining('<'),
            expect.objectContaining({ address: VALID_ADDRESS })
        );
    });

    it('getValueTransfersByTxIds short-circuits an empty set and queries by hash otherwise', async () => {
        // No ClickHouse or an all-blank hash set returns [] before any query.
        expect(await buildService(null).getValueTransfersByTxIds(VALID_ADDRESS, ['h1'])).toEqual([]);

        AccountHistoryService.resetForTests();
        const clickhouse = { query: vi.fn().mockResolvedValue([]), insert: vi.fn() } as unknown as IClickHouseService;
        AccountHistoryService.setDependencies({ database: createMockDatabaseService(), clickhouse, provider: null, emitter: undefined, logger: createSilentLogger() });
        const service = AccountHistoryService.getInstance();

        expect(await service.getValueTransfersByTxIds(VALID_ADDRESS, ['', ''])).toEqual([]);
        expect(clickhouse.query).not.toHaveBeenCalled();

        // A real (deduped) hash set queries account_value_transfers by hash.
        await service.getValueTransfersByTxIds(VALID_ADDRESS, ['h1', 'h1']);
        expect(clickhouse.query).toHaveBeenCalledWith(
            expect.stringContaining('tx_id IN ({txIds:Array(String)})'),
            expect.objectContaining({ address: VALID_ADDRESS, txIds: ['h1'] })
        );
    });

    it('getWalletSummary reads the value ledger for monthly flow, not the transaction table', async () => {
        // queryMonthlyFlow switched to account_value_transfers and filters USDT by
        // contract address (asset_id), not by token_symbol. Assert the flow read so a
        // silent revert to the old table or symbol filter is caught. All summary reads
        // resolve to [] here; only the flow leg touches the value ledger and binds a
        // `usdt` param, so this pairing uniquely identifies it within the fan-out.
        AccountHistoryService.resetForTests();
        const clickhouse = { query: vi.fn().mockResolvedValue([]), insert: vi.fn() } as unknown as IClickHouseService;
        AccountHistoryService.setDependencies({ database: createMockDatabaseService(), clickhouse, provider: null, emitter: undefined, logger: createSilentLogger() });

        await AccountHistoryService.getInstance().getWalletSummary(VALID_ADDRESS);

        expect(clickhouse.query).toHaveBeenCalledWith(
            expect.stringContaining(VALUE_TRANSFERS_TABLE),
            expect.objectContaining({ address: VALID_ADDRESS, usdt: expect.any(String) })
        );
        // Guard against reintroducing the pre-ledger symbol filter.
        expect(clickhouse.query).not.toHaveBeenCalledWith(
            expect.stringContaining("token_symbol = 'USDT'"),
            expect.anything()
        );
    });

    it('runIngestionTick is a no-op without ClickHouse and never calls the provider', async () => {
        const provider: IAccountHistoryProvider = { id: 'test', fetchPage: vi.fn(), fetchAccountSnapshot: vi.fn(), fetchInternalTransfersPage: vi.fn(async () => ({ transfers: [], nextFingerprint: undefined })), fetchTokenTransferLegs: vi.fn(async () => []) };
        const service = buildService(provider);
        await service.runIngestionTick();
        expect(provider.fetchPage).not.toHaveBeenCalled();
    });

    it('runIngestionTick selects only unpaused, not-complete accounts', async () => {
        // The backfill selector pushes its predicate into one query: a queued
        // account advances; a complete one and a paused one are both skipped.
        AccountHistoryService.resetForTests();
        const queued = VALID_ADDRESS;
        const complete = 'TLa2f6VPqDgRE67v7c1pj7iGwsizZ1jGfX';
        const paused = 'TKzxdSv2FZKQrEqkKVgp5DcwEXBEKMg2Ax';
        const now = new Date('2024-01-01T00:00:00.000Z');
        const database = createMockDatabaseService();
        database.getCollectionData(TRACKED_COLLECTION).push(
            { address: queued, paused: false, addedAt: now, updatedAt: now },
            { address: complete, paused: false, addedAt: now, updatedAt: now },
            { address: paused, paused: true, addedAt: now, updatedAt: now }
        );
        database.getCollectionData(PROGRESS_COLLECTION).push(
            { address: queued, status: 'queued', rowsIngested: 0, paused: false },
            { address: complete, status: 'complete', paused: false, nativeComplete: true, trc20Complete: true, rowsIngested: 9 },
            { address: paused, status: 'paused', paused: true, rowsIngested: 0 }
        );

        const clickhouse = { query: vi.fn().mockResolvedValue([]), insert: vi.fn() } as unknown as IClickHouseService;
        // Empty pages so the selected account's walk finishes immediately.
        const provider: IAccountHistoryProvider = {
            id: 'test',
            fetchAccountSnapshot: vi.fn(), fetchInternalTransfersPage: vi.fn(async () => ({ transfers: [], nextFingerprint: undefined })), fetchTokenTransferLegs: vi.fn(async () => []),
            fetchPage: vi.fn(async () => ({ transactions: [], nextFingerprint: undefined }))
        };
        AccountHistoryService.setDependencies({ database, clickhouse, provider, emitter: undefined, logger: createSilentLogger() });
        const service = AccountHistoryService.getInstance();

        await service.runIngestionTick();

        expect(provider.fetchPage).toHaveBeenCalledWith(queued, expect.anything());
        expect(provider.fetchPage).not.toHaveBeenCalledWith(complete, expect.anything());
        expect(provider.fetchPage).not.toHaveBeenCalledWith(paused, expect.anything());
    });

    it('dual-writes value-transfer legs: native legs from transactions and internal legs from the internal endpoint', async () => {
        AccountHistoryService.resetForTests();
        const now = new Date('2024-01-01T00:00:00.000Z');
        const database = createMockDatabaseService();
        database.getCollectionData(TRACKED_COLLECTION).push({ address: VALID_ADDRESS, paused: false, addedAt: now, updatedAt: now });
        database.getCollectionData(PROGRESS_COLLECTION).push({ address: VALID_ADDRESS, status: 'queued', rowsIngested: 0, paused: false });

        const insertedByTable: Record<string, any[]> = {};
        const clickhouse = {
            query: vi.fn().mockResolvedValue([]),
            insert: vi.fn(async (table: string, rows: any[]) => { (insertedByTable[table] ??= []).push(...rows); })
        } as unknown as IClickHouseService;

        const nativeTx: IBlockTransaction = {
            txId: 'n1', blockNumber: 1, timestamp: now, type: 'TransferContract', status: 'SUCCESS',
            from: { address: 'Tfrom' }, to: { address: 'Tto' }, amountSun: 5_000_000
        };
        const provider: IAccountHistoryProvider = {
            id: 'test',
            fetchAccountSnapshot: vi.fn(),
            fetchPage: vi.fn(async (_address: string, opts: any) =>
                opts.source === 'tx'
                    ? { transactions: [nativeTx], nextFingerprint: undefined }
                    : { transactions: [], nextFingerprint: undefined }
            ),
            fetchInternalTransfersPage: vi.fn(async () => ({
                transfers: [
                    { txId: 'i1', origin: 'internal', legKey: 'h1', assetType: 'TRX', assetId: '', from: 'Tc', to: 'Tto', amountRaw: '100000', timestamp: now, blockNumber: 0 }
                ] as IValueTransfer[],
                nextFingerprint: undefined
            })),
            fetchTokenTransferLegs: vi.fn(async () => [])
        };

        AccountHistoryService.setDependencies({ database, clickhouse, provider, emitter: undefined, logger: createSilentLogger() });
        await AccountHistoryService.getInstance().runIngestionTick();

        // The top-level transaction still lands in account_transactions.
        expect(insertedByTable[TRANSACTIONS_TABLE]).toHaveLength(1);
        expect(insertedByTable[TRANSACTIONS_TABLE][0].tx_id).toBe('n1');

        // The value ledger holds the derived native leg plus the internal leg.
        const legs = insertedByTable[VALUE_TRANSFERS_TABLE] ?? [];
        expect(legs).toContainEqual(expect.objectContaining({ origin: 'native', asset_type: 'TRX', amount_raw: '5000000', tx_id: 'n1' }));
        expect(legs).toContainEqual(expect.objectContaining({ origin: 'internal', leg_key: 'h1', amount_raw: '100000', tx_id: 'i1' }));
    });

    it('getProgressFor returns progress only for tracked addresses, ignoring untracked and malformed', async () => {
        AccountHistoryService.resetForTests();
        const database = createMockDatabaseService();
        // Seed a progress record directly so the read is exercised without the
        // raw-collection upsert the mock does not implement.
        database.getCollectionData(PROGRESS_COLLECTION).push({ address: VALID_ADDRESS, status: 'running', rowsIngested: 5 });
        AccountHistoryService.setDependencies({
            database,
            clickhouse: undefined,
            provider: null,
            emitter: undefined,
            logger: createSilentLogger()
        });
        const service = AccountHistoryService.getInstance();

        const untracked = 'TLa2f6VPqDgRE67v7c1pj7iGwsizZ1jGfX';
        const progress = await service.getProgressFor([VALID_ADDRESS, untracked, 'not-an-address', VALID_ADDRESS]);

        expect(progress).toHaveLength(1);
        expect(progress[0]).toMatchObject({ address: VALID_ADDRESS, status: 'running', rowsIngested: 5 });
    });

    it('getProgressFor returns an empty array when no requested address is valid', async () => {
        const service = buildService(null);
        const progress = await service.getProgressFor(['not-an-address', '']);
        expect(progress).toEqual([]);
    });

    /**
     * Build a minimal IBlockTransaction for forward-sync write assertions.
     *
     * @param txId - Transaction id (also the ClickHouse dedup key fragment under test).
     * @param timestamp - Block time used to compare against the forward-sync watermark.
     * @returns A normalized transaction the provider mock can return.
     */
    function makeTx(txId: string, timestamp: Date): IBlockTransaction {
        return {
            txId,
            blockNumber: 1,
            timestamp,
            type: 'TransferContract',
            status: 'SUCCESS',
            from: { address: 'Tfrom' },
            to: { address: 'Tto' },
            contract: { address: 'Tc', method: '' },
            memo: null
        };
    }

    it('runForwardSyncTick is a no-op without ClickHouse and never calls the provider', async () => {
        const provider: IAccountHistoryProvider = { id: 'test', fetchPage: vi.fn(), fetchAccountSnapshot: vi.fn(), fetchInternalTransfersPage: vi.fn(async () => ({ transfers: [], nextFingerprint: undefined })), fetchTokenTransferLegs: vi.fn(async () => []) };
        const service = buildService(provider);
        await service.runForwardSyncTick();
        expect(provider.fetchPage).not.toHaveBeenCalled();
    });

    it('runForwardSyncTick appends only post-watermark transactions to a completed account and keeps it complete', async () => {
        AccountHistoryService.resetForTests();
        const database = createMockDatabaseService();
        const watermark = new Date('2024-01-01T00:00:00.000Z');
        const newer = new Date('2024-02-01T00:00:00.000Z');
        database.getCollectionData(TRACKED_COLLECTION).push({ address: VALID_ADDRESS, paused: false, addedAt: watermark, updatedAt: watermark });
        database.getCollectionData(PROGRESS_COLLECTION).push({
            address: VALID_ADDRESS,
            status: 'complete',
            newestTimestampSeen: watermark,
            nativeComplete: true,
            trc20Complete: true,
            rowsIngested: 100
        });

        const inserted: any[] = [];
        const clickhouse = {
            query: vi.fn().mockResolvedValue([]),
            insert: vi.fn(async (_table: string, rows: any[]) => { inserted.push(...rows); })
        } as unknown as IClickHouseService;

        // The 'tx' endpoint returns one new row and one already-known row (at the
        // watermark); 'trc20' returns nothing. The poll must write only the new one.
        const provider: IAccountHistoryProvider = {
            id: 'test',
            fetchAccountSnapshot: vi.fn(), fetchInternalTransfersPage: vi.fn(async () => ({ transfers: [], nextFingerprint: undefined })), fetchTokenTransferLegs: vi.fn(async () => []),
            fetchPage: vi.fn(async (_address: string, opts: any) => {
                if (opts.source === 'tx') {
                    return { transactions: [makeTx('new1', newer), makeTx('old1', watermark)], nextFingerprint: undefined };
                }
                return { transactions: [], nextFingerprint: undefined };
            })
        };

        AccountHistoryService.setDependencies({ database, clickhouse, provider, emitter: undefined, logger: createSilentLogger() });
        const service = AccountHistoryService.getInstance();

        await service.runForwardSyncTick();

        expect(inserted).toHaveLength(1);
        expect(inserted[0].tx_id).toBe('new1');

        const progress = database.getCollectionData(PROGRESS_COLLECTION).find((d: any) => d.address === VALID_ADDRESS);
        expect(progress.status).toBe('complete');
        expect(progress.rowsIngested).toBe(101);
        expect(new Date(progress.newestTimestampSeen).getTime()).toBe(newer.getTime());
        // Forward sync records its own refresh timestamp, distinct from the frozen
        // backfill `lastRunAt`, so the admin can read a "last refresh" fact.
        expect(progress.lastForwardRunAt).toBeDefined();
    });

    it('runForwardSyncTick resumes a capped drain across ticks and advances the watermark only once known territory is reached', async () => {
        AccountHistoryService.resetForTests();
        const database = createMockDatabaseService();
        const watermark = new Date('2024-01-01T00:00:00.000Z');
        const jan10 = new Date('2024-01-10T00:00:00.000Z');
        const jan09 = new Date('2024-01-09T00:00:00.000Z');
        const jan05 = new Date('2024-01-05T00:00:00.000Z');
        database.getCollectionData(TRACKED_COLLECTION).push({ address: VALID_ADDRESS, paused: false, addedAt: watermark, updatedAt: watermark });
        database.getCollectionData(PROGRESS_COLLECTION).push({
            address: VALID_ADDRESS,
            status: 'complete',
            newestTimestampSeen: watermark,
            nativeComplete: true,
            trc20Complete: true,
            rowsIngested: 100
        });
        // pagesPerTick = 1 so one full page carrying a continuation cursor trips the
        // page cap and forces the 'tx' drain to span two ticks.
        database.getCollectionData(SETTINGS_COLLECTION).push({ key: SETTINGS_KEY, ingestionEnabled: true, pagesPerTick: 1, accountsPerTick: 3 });

        const inserted: any[] = [];
        const clickhouse = {
            query: vi.fn().mockResolvedValue([]),
            insert: vi.fn(async (_table: string, rows: any[]) => { inserted.push(...rows); })
        } as unknown as IClickHouseService;

        // 'tx' leading page is all-fresh with a continuation cursor (cap hit on tick
        // 1); the continuation page reaches the watermark (drain done on tick 2).
        // 'trc20' has nothing new.
        const provider: IAccountHistoryProvider = {
            id: 'test',
            fetchAccountSnapshot: vi.fn(), fetchInternalTransfersPage: vi.fn(async () => ({ transfers: [], nextFingerprint: undefined })), fetchTokenTransferLegs: vi.fn(async () => []),
            fetchPage: vi.fn(async (_address: string, opts: any) => {
                if (opts.source === 'trc20') {
                    return { transactions: [], nextFingerprint: undefined };
                }
                if (!opts.fingerprint) {
                    return { transactions: [makeTx('a', jan10), makeTx('b', jan09)], nextFingerprint: 'fp-tx-1' };
                }
                if (opts.fingerprint === 'fp-tx-1') {
                    return { transactions: [makeTx('c', jan05), makeTx('known', watermark)], nextFingerprint: 'fp-tx-2' };
                }
                return { transactions: [], nextFingerprint: undefined };
            })
        };

        AccountHistoryService.setDependencies({ database, clickhouse, provider, emitter: undefined, logger: createSilentLogger() });
        const service = AccountHistoryService.getInstance();

        // Tick 1: page cap hit before the watermark — watermark frozen, drain cursor
        // persisted, nothing promoted.
        await service.runForwardSyncTick();
        let progress = database.getCollectionData(PROGRESS_COLLECTION).find((d: any) => d.address === VALID_ADDRESS);
        expect(new Date(progress.newestTimestampSeen).getTime()).toBe(watermark.getTime());
        expect(progress.forwardTxCursor).toBe('fp-tx-1');
        expect(progress.rowsIngested).toBe(102);
        expect(progress.status).toBe('complete');

        // Tick 2: continuation reaches the watermark — drain completes, watermark
        // promoted to the newest seen across the whole drain, cursor cleared.
        await service.runForwardSyncTick();
        progress = database.getCollectionData(PROGRESS_COLLECTION).find((d: any) => d.address === VALID_ADDRESS);
        expect(new Date(progress.newestTimestampSeen).getTime()).toBe(jan10.getTime());
        expect(progress.forwardTxCursor).toBeUndefined();
        expect(progress.rowsIngested).toBe(103);
        expect(progress.status).toBe('complete');
        // 'a' and 'b' on tick 1, 'c' on tick 2; the at-watermark 'known' row is filtered out.
        expect(inserted.map((r) => r.tx_id).sort()).toEqual(['a', 'b', 'c']);
    });

    it('runForwardSyncTick treats an empty page on a resumed cursor as an expired fingerprint and restarts from the leading edge', async () => {
        AccountHistoryService.resetForTests();
        const database = createMockDatabaseService();
        const watermark = new Date('2024-01-01T00:00:00.000Z');
        const held = new Date('2024-01-09T00:00:00.000Z');
        const jan10 = new Date('2024-01-10T00:00:00.000Z');
        database.getCollectionData(TRACKED_COLLECTION).push({ address: VALID_ADDRESS, paused: false, addedAt: watermark, updatedAt: watermark });
        // Mid-drain on 'tx' with a persisted continuation that TronGrid has since
        // expired, plus a held pending watermark from the capped prior tick.
        database.getCollectionData(PROGRESS_COLLECTION).push({
            address: VALID_ADDRESS,
            status: 'complete',
            newestTimestampSeen: watermark,
            forwardTxCursor: 'fp-dead',
            forwardPendingNewest: held,
            nativeComplete: true,
            trc20Complete: true,
            rowsIngested: 100
        });
        // Two pages so the expired-cursor probe and the leading-edge restart both
        // fit inside one tick's budget.
        database.getCollectionData(SETTINGS_COLLECTION).push({ key: SETTINGS_KEY, ingestionEnabled: true, pagesPerTick: 2, accountsPerTick: 3 });

        const inserted: any[] = [];
        const clickhouse = {
            query: vi.fn().mockResolvedValue([]),
            insert: vi.fn(async (_table: string, rows: any[]) => { inserted.push(...rows); })
        } as unknown as IClickHouseService;

        // The dead cursor yields an empty page (TronGrid's expired-fingerprint
        // shape); the leading edge yields one fresh row then known territory.
        const provider: IAccountHistoryProvider = {
            id: 'test',
            fetchAccountSnapshot: vi.fn(), fetchInternalTransfersPage: vi.fn(async () => ({ transfers: [], nextFingerprint: undefined })), fetchTokenTransferLegs: vi.fn(async () => []),
            fetchPage: vi.fn(async (_address: string, opts: any) => {
                if (opts.fingerprint === 'fp-dead') {
                    return { transactions: [], nextFingerprint: undefined };
                }
                return { transactions: [makeTx('fresh', jan10), makeTx('known', watermark)], nextFingerprint: undefined };
            })
        };

        AccountHistoryService.setDependencies({ database, clickhouse, provider, emitter: undefined, logger: createSilentLogger() });
        const service = AccountHistoryService.getInstance();

        await service.runForwardSyncTick();

        // The restart re-walked the leading edge instead of trusting the empty
        // page: the fresh row landed and the watermark advanced through the drain's
        // full span rather than being promoted past un-fetched rows.
        expect(inserted.map((r) => r.tx_id)).toEqual(['fresh']);
        const progress = database.getCollectionData(PROGRESS_COLLECTION).find((d: any) => d.address === VALID_ADDRESS);
        expect(new Date(progress.newestTimestampSeen).getTime()).toBe(jan10.getTime());
        expect(progress.forwardTxCursor).toBeUndefined();
        expect(progress.forwardPendingNewest).toBeUndefined();
        expect(progress.status).toBe('complete');
    });

    it('runForwardSyncTick marks the account snapshot-due when new activity lands, and leaves it alone otherwise', async () => {
        AccountHistoryService.resetForTests();
        const database = createMockDatabaseService();
        const watermark = new Date('2024-01-01T00:00:00.000Z');
        const newer = new Date('2024-02-01T00:00:00.000Z');
        const today = new Date().toISOString().slice(0, 10);
        database.getCollectionData(TRACKED_COLLECTION).push({ address: VALID_ADDRESS, paused: false, addedAt: watermark, updatedAt: watermark });
        // Already snapshotted today; only fresh activity may re-arm the sampler.
        database.getCollectionData(PROGRESS_COLLECTION).push({
            address: VALID_ADDRESS, status: 'complete', newestTimestampSeen: watermark,
            nativeComplete: true, trc20Complete: true, lastSnapshotDay: today, rowsIngested: 100
        });

        const clickhouse = { query: vi.fn().mockResolvedValue([]), insert: vi.fn() } as unknown as IClickHouseService;
        let fresh = true;
        const provider: IAccountHistoryProvider = {
            id: 'test',
            fetchAccountSnapshot: vi.fn(), fetchInternalTransfersPage: vi.fn(async () => ({ transfers: [], nextFingerprint: undefined })), fetchTokenTransferLegs: vi.fn(async () => []),
            fetchPage: vi.fn(async (_address: string, opts: any) => {
                if (opts.source === 'tx' && fresh) {
                    return { transactions: [makeTx('new1', newer), makeTx('old1', watermark)], nextFingerprint: undefined };
                }
                return { transactions: [makeTx('old1', watermark)], nextFingerprint: undefined };
            })
        };

        AccountHistoryService.setDependencies({ database, clickhouse, provider, emitter: undefined, logger: createSilentLogger() });
        const service = AccountHistoryService.getInstance();

        // Tick with new activity: lastSnapshotDay cleared so the next snapshot
        // tick re-samples — valuation's holdings read only the latest snapshot.
        await service.runForwardSyncTick();
        let progress = database.getCollectionData(PROGRESS_COLLECTION).find((d: any) => d.address === VALID_ADDRESS);
        expect(progress.lastSnapshotDay).toBeUndefined();

        // Re-snapshot, then an empty tick: dueness must not be re-armed.
        database.getCollectionData(PROGRESS_COLLECTION).find((d: any) => d.address === VALID_ADDRESS).lastSnapshotDay = today;
        fresh = false;
        await service.runForwardSyncTick();
        progress = database.getCollectionData(PROGRESS_COLLECTION).find((d: any) => d.address === VALID_ADDRESS);
        expect(progress.lastSnapshotDay).toBe(today);
    });

    it('runForwardSyncTick clears the continuation cursors on error so a dead fingerprint is never replayed', async () => {
        AccountHistoryService.resetForTests();
        const database = createMockDatabaseService();
        const watermark = new Date('2024-01-01T00:00:00.000Z');
        database.getCollectionData(TRACKED_COLLECTION).push({ address: VALID_ADDRESS, paused: false, addedAt: watermark, updatedAt: watermark });
        database.getCollectionData(PROGRESS_COLLECTION).push({
            address: VALID_ADDRESS,
            status: 'complete',
            newestTimestampSeen: watermark,
            forwardTxCursor: 'fp-dead',
            nativeComplete: true,
            trc20Complete: true,
            rowsIngested: 100
        });

        const clickhouse = { query: vi.fn().mockResolvedValue([]), insert: vi.fn() } as unknown as IClickHouseService;
        const provider: IAccountHistoryProvider = {
            id: 'test',
            fetchAccountSnapshot: vi.fn(), fetchInternalTransfersPage: vi.fn(async () => ({ transfers: [], nextFingerprint: undefined })), fetchTokenTransferLegs: vi.fn(async () => []),
            fetchPage: vi.fn(async () => { throw new Error('boom'); })
        };

        AccountHistoryService.setDependencies({ database, clickhouse, provider, emitter: undefined, logger: createSilentLogger() });
        const service = AccountHistoryService.getInstance();

        await service.runForwardSyncTick();

        // The errored drain must not persist the (possibly dead) cursor — the next
        // tick restarts from the leading edge. Watermark frozen, account stays
        // complete, the failure is legible via lastError.
        const progress = database.getCollectionData(PROGRESS_COLLECTION).find((d: any) => d.address === VALID_ADDRESS);
        expect(progress.forwardTxCursor).toBeUndefined();
        expect(progress.status).toBe('complete');
        expect(progress.lastError).toBe('boom');
        expect(new Date(progress.newestTimestampSeen).getTime()).toBe(watermark.getTime());
    });

    it('getStats reports catchingUp for a drain parked on the internal endpoint', async () => {
        AccountHistoryService.resetForTests();
        const database = createMockDatabaseService();
        const jan = new Date('2024-01-01T00:00:00.000Z');
        database.getCollectionData(TRACKED_COLLECTION).push({ address: VALID_ADDRESS, paused: false, addedAt: jan, updatedAt: jan });
        // Only the internal-transfers cursor is parked — the derivation must not
        // ignore it (an internal-only stall was previously invisible as healthy).
        database.getCollectionData(PROGRESS_COLLECTION).push({
            address: VALID_ADDRESS, status: 'complete', newestTimestampSeen: jan,
            nativeComplete: true, trc20Complete: true, forwardInternalCursor: 'fp-internal', rowsIngested: 10
        });

        AccountHistoryService.setDependencies({
            database, clickhouse: undefined, provider: null, emitter: undefined, logger: createSilentLogger()
        });
        const service = AccountHistoryService.getInstance();

        const stats = await service.getStats();
        expect(stats.accounts[0].progress.catchingUp).toBe(true);
        expect(stats.totals.catchingUpAccounts).toBe(1);
    });

    it('runForwardSyncTick skips accounts that are not complete', async () => {
        AccountHistoryService.resetForTests();
        const database = createMockDatabaseService();
        const now = new Date('2024-01-01T00:00:00.000Z');
        database.getCollectionData(TRACKED_COLLECTION).push({ address: VALID_ADDRESS, paused: false, addedAt: now, updatedAt: now });
        database.getCollectionData(PROGRESS_COLLECTION).push({ address: VALID_ADDRESS, status: 'queued', rowsIngested: 0 });

        const clickhouse = { query: vi.fn().mockResolvedValue([]), insert: vi.fn() } as unknown as IClickHouseService;
        const provider: IAccountHistoryProvider = { id: 'test', fetchPage: vi.fn(), fetchAccountSnapshot: vi.fn(), fetchInternalTransfersPage: vi.fn(async () => ({ transfers: [], nextFingerprint: undefined })), fetchTokenTransferLegs: vi.fn(async () => []) };

        AccountHistoryService.setDependencies({ database, clickhouse, provider, emitter: undefined, logger: createSilentLogger() });
        const service = AccountHistoryService.getInstance();

        await service.runForwardSyncTick();
        expect(provider.fetchPage).not.toHaveBeenCalled();
    });

    it('runForwardSyncTick skips a paused completed account via the denormalized brake', async () => {
        // A paused account keeps status `complete` (setAccountPaused leaves status
        // untouched on completed accounts), so the forward selector must exclude it on
        // the denormalized `paused` flag, not on status. Without that flag this account
        // would be wrongly refreshed.
        AccountHistoryService.resetForTests();
        const database = createMockDatabaseService();
        const now = new Date('2024-01-01T00:00:00.000Z');
        database.getCollectionData(TRACKED_COLLECTION).push({ address: VALID_ADDRESS, paused: true, addedAt: now, updatedAt: now });
        database.getCollectionData(PROGRESS_COLLECTION).push({
            address: VALID_ADDRESS, status: 'complete', paused: true,
            nativeComplete: true, trc20Complete: true, newestTimestampSeen: now, rowsIngested: 10
        });

        const clickhouse = { query: vi.fn().mockResolvedValue([]), insert: vi.fn() } as unknown as IClickHouseService;
        const provider: IAccountHistoryProvider = { id: 'test', fetchPage: vi.fn(), fetchAccountSnapshot: vi.fn(), fetchInternalTransfersPage: vi.fn(async () => ({ transfers: [], nextFingerprint: undefined })), fetchTokenTransferLegs: vi.fn(async () => []) };
        AccountHistoryService.setDependencies({ database, clickhouse, provider, emitter: undefined, logger: createSilentLogger() });
        const service = AccountHistoryService.getInstance();

        await service.runForwardSyncTick();
        expect(provider.fetchPage).not.toHaveBeenCalled();
    });

    it('getStats rolls up catching-up accounts, the freshness floor, and per-account catchingUp', async () => {
        AccountHistoryService.resetForTests();
        const database = createMockDatabaseService();
        const draining = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
        const current = 'TLa2f6VPqDgRE67v7c1pj7iGwsizZ1jGfX';
        const jan = new Date('2024-01-01T00:00:00.000Z');
        const feb = new Date('2024-02-01T00:00:00.000Z');
        database.getCollectionData(TRACKED_COLLECTION).push({ address: draining, paused: false, addedAt: jan, updatedAt: jan });
        database.getCollectionData(TRACKED_COLLECTION).push({ address: current, paused: false, addedAt: jan, updatedAt: jan });
        // `draining` is mid-drain (a forward cursor is parked) and its leading edge
        // sits at `feb`; `current` is fully caught up at `jan`. The freshness floor
        // is the older of the two watermarks (`jan`).
        database.getCollectionData(PROGRESS_COLLECTION).push({
            address: draining, status: 'complete', newestTimestampSeen: feb,
            nativeComplete: true, trc20Complete: true, forwardTxCursor: 'fp-resume', rowsIngested: 200
        });
        database.getCollectionData(PROGRESS_COLLECTION).push({
            address: current, status: 'complete', newestTimestampSeen: jan,
            nativeComplete: true, trc20Complete: true, rowsIngested: 50
        });

        AccountHistoryService.setDependencies({
            database, clickhouse: undefined, provider: null, emitter: undefined, logger: createSilentLogger()
        });
        const service = AccountHistoryService.getInstance();

        const stats = await service.getStats();

        expect(stats.totals.completeAccounts).toBe(2);
        expect(stats.totals.catchingUpAccounts).toBe(1);
        expect(new Date(stats.totals.oldestNewestTimestamp!).getTime()).toBe(jan.getTime());

        const drainingStats = stats.accounts.find((a) => a.account.address === draining);
        const currentStats = stats.accounts.find((a) => a.account.address === current);
        expect(drainingStats?.progress.catchingUp).toBe(true);
        expect(currentStats?.progress.catchingUp).toBe(false);
    });

    it('getStats omits the freshness floor when no account is complete', async () => {
        AccountHistoryService.resetForTests();
        const database = createMockDatabaseService();
        const now = new Date('2024-01-01T00:00:00.000Z');
        database.getCollectionData(TRACKED_COLLECTION).push({ address: VALID_ADDRESS, paused: false, addedAt: now, updatedAt: now });
        database.getCollectionData(PROGRESS_COLLECTION).push({ address: VALID_ADDRESS, status: 'queued', rowsIngested: 0 });
        AccountHistoryService.setDependencies({
            database, clickhouse: undefined, provider: null, emitter: undefined, logger: createSilentLogger()
        });
        const service = AccountHistoryService.getInstance();

        const stats = await service.getStats();

        expect(stats.totals.completeAccounts).toBe(0);
        expect(stats.totals.catchingUpAccounts).toBe(0);
        expect(stats.totals.oldestNewestTimestamp).toBeUndefined();
    });

});

describe('toAccountTransactionRow', () => {
    it('projects a native transaction into a flat ClickHouse row with null token columns', () => {
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
        const row = toAccountTransactionRow('Tacct', tx, 'tx', '2024-01-01 00:00:00.000', '2024-06-01 00:00:00.000');

        expect(row.account).toBe('Tacct');
        expect(row.tx_id).toBe('abc');
        expect(row.source).toBe('tx');
        expect(row.type).toBe('TriggerSmartContract');
        expect(row.contract_address).toBe('Tcontract');
        expect(row.contract_method).toBe('0xa9059cbb');
        expect(row.amount_sun).toBeNull();
        expect(row.energy_consumed).toBeNull();
        expect(row.token_amount).toBeNull();
        expect(row.token_symbol).toBeNull();
        expect(row.memo).toBeNull();
        expect(row.ingested_at).toBe('2024-06-01 00:00:00.000');
    });

    it('lifts TRC20 token detail from contract.parameters into dedicated columns', () => {
        const tx: IBlockTransaction = {
            txId: 'def',
            blockNumber: 0,
            timestamp: new Date('2024-01-02T00:00:00.000Z'),
            type: 'TriggerSmartContract',
            status: 'SUCCESS',
            from: { address: 'Tsender' },
            to: { address: 'Trecipient' },
            contract: { address: 'Ttoken', method: 'transfer', parameters: { value: '1000000', symbol: 'USDT', decimals: 6 } },
            memo: null
        };
        const row = toAccountTransactionRow('Tacct', tx, 'trc20', '2024-01-02 00:00:00.000', '2024-06-01 00:00:00.000');

        expect(row.source).toBe('trc20');
        expect(row.token_amount).toBe('1000000');
        expect(row.token_symbol).toBe('USDT');
        expect(row.token_decimals).toBe(6);
        expect(row.contract_address).toBe('Ttoken');
    });
});
