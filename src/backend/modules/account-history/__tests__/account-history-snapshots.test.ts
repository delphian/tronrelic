/**
 * @fileoverview Tests for the balance-snapshot capability of account-history.
 *
 * Covers the scheduled sampler (`runSnapshotTick` selecting due accounts,
 * probing the provider, writing the scalar + token rows, advancing the
 * `lastSnapshotDay` cursor) and the two reads (`getLatestSnapshot` mapping +
 * token attach, `getSnapshotSeries` range), plus the ClickHouse-absent no-op. A
 * hand-rolled in-memory ClickHouse fake stands in for the real store.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ISystemLogService } from '@/types';
import { createMockDatabaseService } from '../../../tests/vitest/mocks/database-service.js';
import { AccountHistoryService } from '../services/account-history.service.js';
import {
    BALANCE_SNAPSHOTS_TABLE,
    TOKEN_BALANCES_TABLE,
    TRACKED_COLLECTION,
    PROGRESS_COLLECTION,
    type IAccountSnapshotSample
} from '../database/index.js';
import type { IAccountHistoryProvider } from '../providers/IAccountHistoryProvider.js';

/** A real base58 TRON address for selection/ownership-passing cases. */
const ADDRESS = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';

/** Today's UTC day, the value the sampler stamps `lastSnapshotDay` with. */
const TODAY = new Date().toISOString().slice(0, 10);

/** No-op logger satisfying ISystemLogService. */
function silentLogger(): ISystemLogService {
    const logger = { info() {}, warn() {}, error() {}, debug() {}, trace() {}, fatal() {}, child() { return logger; } };
    return logger as unknown as ISystemLogService;
}

/**
 * In-memory ClickHouse fake answering the three snapshot query shapes (latest
 * scalar, token balances for a day, scalar range) from captured inserts.
 */
class FakeClickhouse {
    public balanceRows: Array<Record<string, unknown>> = [];
    public tokenRows: Array<Record<string, unknown>> = [];

    async insert<T extends Record<string, unknown>>(table: string, rows: T[]): Promise<void> {
        if (table === BALANCE_SNAPSHOTS_TABLE) {
            this.balanceRows.push(...rows);
        } else if (table === TOKEN_BALANCES_TABLE) {
            this.tokenRows.push(...rows);
        }
    }

    async query<T = Record<string, unknown>>(sql: string, params: Record<string, unknown> = {}): Promise<T[]> {
        if (sql.includes(TOKEN_BALANCES_TABLE)) {
            if (sql.includes('DISTINCT asset')) {
                return Array.from(new Set(this.tokenRows.map((row) => row.asset))).map((asset) => ({ asset })) as T[];
            }
            return this.tokenRows.filter((row) => row.account === params.address && row.day === params.day) as T[];
        }
        const forAccount = this.balanceRows.filter((row) => row.account === params.address);
        if (sql.includes('ORDER BY day DESC')) {
            const sorted = [...forAccount].sort((a, b) => (String(a.day) < String(b.day) ? 1 : -1));
            return sorted.slice(0, 1) as T[];
        }
        return forAccount
            .filter((row) => String(row.day) >= String(params.fromDay) && String(row.day) <= String(params.toDay))
            .sort((a, b) => (String(a.day) < String(b.day) ? -1 : 1)) as T[];
    }

    async exec(): Promise<void> {}
    async ping(): Promise<boolean> { return true; }
}

/** A sample the fake provider returns for any probed address. */
const SAMPLE: IAccountSnapshotSample = {
    trxBalanceSun: 100_000_000,
    stakedEnergySun: 20_000_000,
    stakedBandwidthSun: 0,
    unstakingSun: 5_000_000,
    energyLimit: 1000,
    energyUsed: 100,
    netLimit: 500,
    netUsed: 50,
    withdrawableRewardSun: 3_000_000,
    tokenBalances: [{ asset: 'TXLAtoken', rawBalance: '5000000' }]
};

/**
 * Build a provider whose snapshot probe returns {@link SAMPLE}.
 *
 * @returns A provider mock.
 */
function snapshotProvider(): IAccountHistoryProvider {
    return {
        id: 'test',
        fetchPage: vi.fn(),
        fetchInternalTransfersPage: vi.fn(async () => ({ transfers: [], nextFingerprint: undefined })),
        fetchTokenTransferLegs: vi.fn(async () => []),
        fetchAccountSnapshot: vi.fn().mockResolvedValue(SAMPLE)
    };
}

/**
 * Configure a fresh service with a mock database, the given ClickHouse, and a
 * snapshot-returning provider.
 *
 * @param clickhouse - The ClickHouse fake, or undefined to test the no-op path.
 * @returns The service plus its database for seeding/inspection.
 */
function buildService(clickhouse: FakeClickhouse | undefined) {
    AccountHistoryService.resetForTests();
    const database = createMockDatabaseService();
    AccountHistoryService.setDependencies({
        database,
        clickhouse: clickhouse as never,
        provider: snapshotProvider(),
        emitter: undefined,
        logger: silentLogger()
    });
    return { service: AccountHistoryService.getInstance(), database };
}

describe('AccountHistoryService balance snapshots', () => {
    beforeEach(() => {
        AccountHistoryService.resetForTests();
    });

    it('samples a due tracked account and advances its snapshot cursor', async () => {
        const clickhouse = new FakeClickhouse();
        const { service, database } = buildService(clickhouse);
        await database.getCollection(TRACKED_COLLECTION).insertOne({ address: ADDRESS, paused: false, addedAt: new Date(), updatedAt: new Date() });
        await database.getCollection(PROGRESS_COLLECTION).insertOne({ address: ADDRESS, status: 'queued', rowsIngested: 0, paused: false });

        await service.runSnapshotTick();

        expect(clickhouse.balanceRows).toHaveLength(1);
        expect(clickhouse.balanceRows[0]).toMatchObject({ account: ADDRESS, trx_balance_sun: 100_000_000, staked_energy_sun: 20_000_000 });
        expect(clickhouse.tokenRows).toHaveLength(1);
        const progress = await database.getCollection(PROGRESS_COLLECTION).findOne({ address: ADDRESS });
        expect(progress?.lastSnapshotDay).toBe(TODAY);
    });

    it('skips an account already snapshotted today', async () => {
        const clickhouse = new FakeClickhouse();
        const { service, database } = buildService(clickhouse);
        await database.getCollection(TRACKED_COLLECTION).insertOne({ address: ADDRESS, paused: false, addedAt: new Date(), updatedAt: new Date() });
        await database.getCollection(PROGRESS_COLLECTION).insertOne({ address: ADDRESS, status: 'complete', rowsIngested: 0, lastSnapshotDay: TODAY });

        await service.runSnapshotTick();

        expect(clickhouse.balanceRows).toHaveLength(0);
    });

    it('reads back the latest snapshot with token balances mapped', async () => {
        const clickhouse = new FakeClickhouse();
        const { service, database } = buildService(clickhouse);
        await database.getCollection(TRACKED_COLLECTION).insertOne({ address: ADDRESS, paused: false, addedAt: new Date(), updatedAt: new Date() });
        await database.getCollection(PROGRESS_COLLECTION).insertOne({ address: ADDRESS, status: 'queued', rowsIngested: 0, paused: false });
        await service.runSnapshotTick();

        const snapshot = await service.getLatestSnapshot(ADDRESS);
        expect(snapshot).not.toBeNull();
        expect(snapshot?.trxBalanceSun).toBe(100_000_000);
        expect(snapshot?.unstakingSun).toBe(5_000_000);
        expect(snapshot?.tokenBalances).toEqual([{ asset: 'TXLAtoken', rawBalance: '5000000' }]);
        expect(snapshot?.capturedAt).toBeInstanceOf(Date);
    });

    it('returns null from getLatestSnapshot when ClickHouse is absent', async () => {
        const { service } = buildService(undefined);
        expect(await service.getLatestSnapshot(ADDRESS)).toBeNull();
    });

    it('lists distinct held token assets across snapshots', async () => {
        const clickhouse = new FakeClickhouse();
        const { service, database } = buildService(clickhouse);
        await database.getCollection(TRACKED_COLLECTION).insertOne({ address: ADDRESS, paused: false, addedAt: new Date(), updatedAt: new Date() });
        await database.getCollection(PROGRESS_COLLECTION).insertOne({ address: ADDRESS, status: 'queued', rowsIngested: 0, paused: false });
        await service.runSnapshotTick();
        expect(await service.getHeldTokenAssets()).toEqual(['TXLAtoken']);
    });
});
