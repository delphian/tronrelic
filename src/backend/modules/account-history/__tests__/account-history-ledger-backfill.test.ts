/**
 * @fileoverview Tests for the Stage-3 value-transfer ledger backfill.
 *
 * The backfill populates the ledger for accounts that completed BEFORE value legs
 * were dual-written. Native legs are reconstructed by a ClickHouse migration; the
 * service tick covers the two leg families the provider must re-fetch — historical
 * internal legs and token legs (whose `log_index` key lives only on the events
 * endpoint). The discriminating behaviors exercised here: the selector targets only
 * legacy-complete accounts (and drops them once both sub-tasks finish); the token
 * sweep keysets over stored `trc20` transactions, enriches decimals from stored
 * metadata, writes legs before advancing its cursor, and marks completion on a short
 * batch; and the internal drain reuses the live walk and persists its own cursor.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { IClickHouseService, ISystemLogService, IValueTransfer } from '@/types';
import { createMockDatabaseService } from '../../../tests/vitest/mocks/database-service.js';
import { AccountHistoryService } from '../services/account-history.service.js';
import { PROGRESS_COLLECTION, TRACKED_COLLECTION, VALUE_TRANSFERS_TABLE } from '../database/index.js';
import type { IAccountHistoryProvider } from '../providers/IAccountHistoryProvider.js';

/** A real base58 TRON address (the USDT contract) for validation-passing cases. */
const LEGACY = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
/** A second valid address used as a distinct tracked account. */
const INTERNAL_DONE = 'TLa2f6VPqDgRE67v7c1pj7iGwsizZ1jGfX';
/** A third valid address for the fully-backfilled (excluded) case. */
const FULLY_DONE = 'TKzxdSv2FZKQrEqkKVgp5DcwEXBEKMg2Ax';

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
 * Build a provider whose internal and token sources are empty unless overridden,
 * so a test only wires the source it asserts on.
 *
 * @param overrides - Partial provider methods to override.
 * @returns A mock IAccountHistoryProvider.
 */
function createProvider(overrides: Partial<IAccountHistoryProvider> = {}): IAccountHistoryProvider {
    return {
        id: 'test',
        fetchPage: vi.fn(),
        fetchAccountSnapshot: vi.fn(),
        fetchInternalTransfersPage: vi.fn(async () => ({ transfers: [], nextFingerprint: undefined })),
        fetchTokenTransferLegs: vi.fn(async () => []),
        ...overrides
    } as IAccountHistoryProvider;
}

describe('AccountHistoryService ledger backfill', () => {
    beforeEach(() => {
        AccountHistoryService.resetForTests();
    });

    it('selects only legacy-complete accounts and drains internal for those that owe it', async () => {
        const now = new Date('2024-01-01T00:00:00.000Z');
        const database = createMockDatabaseService();
        database.getCollectionData(TRACKED_COLLECTION).push(
            { address: LEGACY, paused: false, addedAt: now, updatedAt: now },
            { address: INTERNAL_DONE, paused: false, addedAt: now, updatedAt: now },
            { address: FULLY_DONE, paused: false, addedAt: now, updatedAt: now }
        );
        database.getCollectionData(PROGRESS_COLLECTION).push(
            // Legacy: completed before either leg family was dual-written.
            { address: LEGACY, status: 'complete', paused: false, rowsIngested: 5 },
            // Internal exhausted, token sweep still pending.
            { address: INTERNAL_DONE, status: 'complete', paused: false, internalComplete: true, rowsIngested: 7 },
            // Both sub-tasks finished — must be excluded.
            { address: FULLY_DONE, status: 'complete', paused: false, internalComplete: true, tokenLegsBackfillComplete: true, rowsIngested: 9 }
        );

        // Token batch query returns no stored trc20 txs, so the sweep completes in one pass.
        const clickhouse = { query: vi.fn().mockResolvedValue([]), insert: vi.fn() } as unknown as IClickHouseService;
        const provider = createProvider();
        AccountHistoryService.setDependencies({ database, clickhouse, provider, emitter: undefined, logger: createSilentLogger() });

        await AccountHistoryService.getInstance().runLedgerBackfillTick();

        // Internal is re-walked only for the account that still owes it.
        expect(provider.fetchInternalTransfersPage).toHaveBeenCalledWith(LEGACY, expect.anything());
        expect(provider.fetchInternalTransfersPage).not.toHaveBeenCalledWith(INTERNAL_DONE, expect.anything());
        expect(provider.fetchInternalTransfersPage).not.toHaveBeenCalledWith(FULLY_DONE, expect.anything());

        // Exactly the two owing accounts were advanced (round-robin stamp written);
        // the fully-done account was never selected.
        const progress = database.getCollectionData(PROGRESS_COLLECTION);
        const advanced = (addr: string) => progress.find((d: any) => d.address === addr)?.lastLedgerBackfillRunAt;
        expect(advanced(LEGACY)).toBeInstanceOf(Date);
        expect(advanced(INTERNAL_DONE)).toBeInstanceOf(Date);
        expect(advanced(FULLY_DONE)).toBeUndefined();
    });

    it('sweeps stored trc20 transactions into token legs, enriching decimals, and marks completion on a short batch', async () => {
        const now = new Date('2024-01-01T00:00:00.000Z');
        const database = createMockDatabaseService();
        database.getCollectionData(TRACKED_COLLECTION).push({ address: LEGACY, paused: false, addedAt: now, updatedAt: now });
        // Internal already done so only the token sweep runs.
        database.getCollectionData(PROGRESS_COLLECTION).push({ address: LEGACY, status: 'complete', paused: false, internalComplete: true, rowsIngested: 3 });

        const insertedByTable: Record<string, any[]> = {};
        const query = vi.fn(async (sql: string) => {
            if (sql.includes('DISTINCT tx_id')) {
                return [
                    { tx_id: 'tA', ts: '2024-01-01 00:00:00.000' },
                    { tx_id: 'tB', ts: '2024-01-02 00:00:00.000' }
                ];
            }
            if (sql.includes('DISTINCT contract_address')) {
                return [{ contract_address: 'Tusdt', token_decimals: 6 }];
            }
            return [];
        });
        const clickhouse = {
            query,
            insert: vi.fn(async (table: string, rows: any[]) => { (insertedByTable[table] ??= []).push(...rows); })
        } as unknown as IClickHouseService;

        const provider = createProvider({
            fetchTokenTransferLegs: vi.fn(async (_account: string, txId: string) => [
                { txId, origin: 'token_event', legKey: '0', assetType: 'TRC20', assetId: 'Tusdt', from: 'Tx', to: 'Ty', amountRaw: '1000000', timestamp: now, blockNumber: 1 }
            ] as IValueTransfer[])
        });
        AccountHistoryService.setDependencies({ database, clickhouse, provider, emitter: undefined, logger: createSilentLogger() });

        await AccountHistoryService.getInstance().runLedgerBackfillTick();

        // One events call per distinct stored trc20 transaction.
        expect(provider.fetchTokenTransferLegs).toHaveBeenCalledWith(LEGACY, 'tA');
        expect(provider.fetchTokenTransferLegs).toHaveBeenCalledWith(LEGACY, 'tB');

        // Both token legs are written with decimals carried from the stored metadata.
        const legs = insertedByTable[VALUE_TRANSFERS_TABLE] ?? [];
        expect(legs).toContainEqual(expect.objectContaining({ origin: 'token_event', tx_id: 'tA', asset_id: 'Tusdt', asset_decimals: 6 }));
        expect(legs).toContainEqual(expect.objectContaining({ origin: 'token_event', tx_id: 'tB', asset_decimals: 6 }));

        // A batch short of the per-tick cap exhausts the account: completion flagged,
        // cursor advanced to the last (timestamp, tx_id).
        const doc = database.getCollectionData(PROGRESS_COLLECTION).find((d: any) => d.address === LEGACY);
        expect(doc.tokenLegsBackfillComplete).toBe(true);
        expect(doc.tokenLegsBackfillCursor).toBe('2024-01-02 00:00:00.000|tB');
    });

    it('on a mid-batch fetch failure persists progress through the last success and does not mark complete', async () => {
        const now = new Date('2024-01-01T00:00:00.000Z');
        const database = createMockDatabaseService();
        database.getCollectionData(TRACKED_COLLECTION).push({ address: LEGACY, paused: false, addedAt: now, updatedAt: now });
        database.getCollectionData(PROGRESS_COLLECTION).push({ address: LEGACY, status: 'complete', paused: false, internalComplete: true, rowsIngested: 3 });

        const insertedByTable: Record<string, any[]> = {};
        const query = vi.fn(async (sql: string) => {
            if (sql.includes('DISTINCT tx_id')) {
                return [
                    { tx_id: 'tA', ts: '2024-01-01 00:00:00.000' },
                    { tx_id: 'tB', ts: '2024-01-02 00:00:00.000' }
                ];
            }
            if (sql.includes('DISTINCT contract_address')) {
                return [{ contract_address: 'Tusdt', token_decimals: 6 }];
            }
            return [];
        });
        const clickhouse = {
            query,
            insert: vi.fn(async (table: string, rows: any[]) => { (insertedByTable[table] ??= []).push(...rows); })
        } as unknown as IClickHouseService;

        // tA succeeds; tB's events fetch throws (a transient rate-limit/network failure
        // the strict provider surfaces rather than masking as empty).
        const provider = createProvider({
            fetchTokenTransferLegs: vi.fn(async (_account: string, txId: string) => {
                if (txId === 'tB') {
                    throw new Error('429 rate limited');
                }
                return [
                    { txId, origin: 'token_event', legKey: '0', assetType: 'TRC20', assetId: 'Tusdt', from: 'Tx', to: 'Ty', amountRaw: '1000000', timestamp: now, blockNumber: 1 }
                ] as IValueTransfer[];
            })
        });
        AccountHistoryService.setDependencies({ database, clickhouse, provider, emitter: undefined, logger: createSilentLogger() });

        await AccountHistoryService.getInstance().runLedgerBackfillTick();

        // Only tA's leg is written; tB is left for a later tick.
        const legs = insertedByTable[VALUE_TRANSFERS_TABLE] ?? [];
        expect(legs).toHaveLength(1);
        expect(legs[0]).toMatchObject({ origin: 'token_event', tx_id: 'tA' });

        // Cursor advanced through the last success (tA); completion NOT set, so the
        // account stays selectable and resumes at tB next tick — no silent leg loss.
        const doc = database.getCollectionData(PROGRESS_COLLECTION).find((d: any) => d.address === LEGACY);
        expect(doc.tokenLegsBackfillCursor).toBe('2024-01-01 00:00:00.000|tA');
        expect(doc.tokenLegsBackfillComplete).toBeUndefined();
    });

    it('drains internal legs through the provider and persists the internal completion flag', async () => {
        const now = new Date('2024-01-01T00:00:00.000Z');
        const database = createMockDatabaseService();
        database.getCollectionData(TRACKED_COLLECTION).push({ address: LEGACY, paused: false, addedAt: now, updatedAt: now });
        // Token sweep already done so only the internal drain runs.
        database.getCollectionData(PROGRESS_COLLECTION).push({ address: LEGACY, status: 'complete', paused: false, tokenLegsBackfillComplete: true, rowsIngested: 4 });

        const insertedByTable: Record<string, any[]> = {};
        const clickhouse = {
            query: vi.fn().mockResolvedValue([]),
            insert: vi.fn(async (table: string, rows: any[]) => { (insertedByTable[table] ??= []).push(...rows); })
        } as unknown as IClickHouseService;
        const provider = createProvider({
            fetchInternalTransfersPage: vi.fn(async () => ({
                transfers: [
                    { txId: 'i1', origin: 'internal', legKey: 'h1', assetType: 'TRX', assetId: '', from: 'Tc', to: 'Tto', amountRaw: '100000', timestamp: now, blockNumber: 0 }
                ] as IValueTransfer[],
                nextFingerprint: undefined
            }))
        });
        AccountHistoryService.setDependencies({ database, clickhouse, provider, emitter: undefined, logger: createSilentLogger() });

        await AccountHistoryService.getInstance().runLedgerBackfillTick();

        const legs = insertedByTable[VALUE_TRANSFERS_TABLE] ?? [];
        expect(legs).toContainEqual(expect.objectContaining({ origin: 'internal', leg_key: 'h1', tx_id: 'i1' }));
        const doc = database.getCollectionData(PROGRESS_COLLECTION).find((d: any) => d.address === LEGACY);
        expect(doc.internalComplete).toBe(true);
    });

    it('is a no-op without ClickHouse and never calls the provider', async () => {
        const provider = createProvider();
        AccountHistoryService.setDependencies({ database: createMockDatabaseService(), clickhouse: undefined, provider, emitter: undefined, logger: createSilentLogger() });
        await AccountHistoryService.getInstance().runLedgerBackfillTick();
        expect(provider.fetchInternalTransfersPage).not.toHaveBeenCalled();
        expect(provider.fetchTokenTransferLegs).not.toHaveBeenCalled();
    });
});
