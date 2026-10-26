/**
 * Unit tests for finding and refetching blocks missing from the ClickHouse chain data.
 *
 * The repair job spends calls on the TronGrid queue block sync shares, so the
 * tests pin what keeps that cost bounded: a clean check makes no refetch at
 * all, repairs wait while sync is behind, a run stops at its limit and after
 * repeated TronGrid failures, and a block that keeps failing is given up on.
 * They also pin what an operator reads: the counts and status on the snapshot,
 * and the run streak the health banner reports on.
 */
import { describe, it, expect, vi, type Mock } from 'vitest';
import type { IClickHouseService } from '@/types';
import { ChainDataReconciler, type IChainDataBlockSource, type IChainDataRepairSink } from '../chain-data/ChainDataReconciler.js';
import type { IChainDataRows } from '../chain-data/buildChainDataRows.js';

/** A fixed clock, so every stamped time is predictable. */
const NOW = new Date(Date.UTC(2026, 9, 25, 23, 41, 0, 0));

/** The newest stored block in every scenario. */
const NEWEST = 1_000_000;

/** What the fake ClickHouse answers. */
interface IFakeChainData {
    /** The newest stored block, or 0 for an empty table. */
    newest?: number;
    /** Holes between stored blocks, as `[start, end, recent]`. */
    holes?: Array<[number, number, boolean]>;
    /** Blocks stored only in part. */
    partial?: number[];
    /** An error every query throws, to stand in for an unreachable ClickHouse. */
    failWith?: Error;
}

/**
 * Build a ClickHouse fake that answers each of the reconciler's three queries.
 *
 * @param data - What the newest-block, hole, and partial-block queries return.
 * @returns The fake, with a spy on `query` for assertions.
 */
function buildClickHouse(data: IFakeChainData): { clickhouse: IClickHouseService; query: ReturnType<typeof vi.fn> } {
    const query = vi.fn(async (sql: string) => {
        let rows: Record<string, unknown>[] = [];
        if (data.failWith) {
            throw data.failWith;
        }
        if (sql.includes('AS newest')) {
            rows = [{ newest: String(data.newest ?? NEWEST) }];
        } else if (sql.includes('lagInFrame')) {
            rows = (data.holes ?? []).map(([start, end, recent]) => ({ gap_start: String(start), gap_end: String(end), recent: recent ? 1 : 0 }));
        } else if (sql.includes('_ingest_gap')) {
            rows = (data.partial ?? []).map(blockNumber => ({ block_number: String(blockNumber) }));
        }
        return rows;
    });
    return { clickhouse: { query } as unknown as IClickHouseService, query };
}

/**
 * Build a block source that returns empty rows for every block, or fails for
 * the blocks listed.
 *
 * @param failing - Blocks whose refetch rejects, as TronGrid failing would.
 * @returns The source, with a spy on `fetchChainDataRows`.
 */
function buildSource(failing: number[] = []): IChainDataBlockSource & { fetchChainDataRows: ReturnType<typeof vi.fn> } {
    return {
        fetchChainDataRows: vi.fn(async (blockNumber: number): Promise<IChainDataRows> => {
            if (failing.includes(blockNumber)) {
                throw new Error(`TronGrid refused block ${blockNumber}`);
            }
            return { blockNumber, blockTimestamp: '2026-10-25 18:36:51.000', tables: {} };
        })
    };
}

/**
 * Build a writer stand-in that records what it was handed.
 *
 * @returns The sink, with spies on `submit` and `drain`.
 */
function buildSink(): IChainDataRepairSink & { submit: Mock<(rows: IChainDataRows) => void>; drain: Mock<() => Promise<void>> } {
    return {
        submit: vi.fn<(rows: IChainDataRows) => void>(),
        drain: vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
    };
}

describe('ChainDataReconciler', () => {
    it('reports never-run before its first run', () => {
        const { clickhouse } = buildClickHouse({});
        const reconciler = new ChainDataReconciler(clickhouse, buildSource(), buildSink(), { isSyncCaughtUp: () => true });

        expect(reconciler.getSnapshot()).toMatchObject({ status: 'never-run', lastRunAt: null, remaining: 0 });
    });

    it('makes no refetch when nothing is missing', async () => {
        const { clickhouse } = buildClickHouse({});
        const source = buildSource();
        const reconciler = new ChainDataReconciler(clickhouse, source, buildSink(), { isSyncCaughtUp: () => true, now: () => NOW });

        const snapshot = await reconciler.run();

        expect(snapshot).toMatchObject({ status: 'clean', missingBlocks: 0, remaining: 0, consecutiveRunsWithGaps: 0, lastRunAt: NOW.toISOString() });
        expect(source.fetchChainDataRows).not.toHaveBeenCalled();
    });

    it('checks only below the settle margin and inside the window', async () => {
        const { clickhouse, query } = buildClickHouse({});
        const reconciler = new ChainDataReconciler(clickhouse, buildSource(), buildSink(), {
            isSyncCaughtUp: () => true,
            windowDays: 7,
            settleBlocks: 50
        });

        await reconciler.run();

        expect(query).toHaveBeenCalledWith(expect.stringContaining('lagInFrame'), { windowDays: 7, ceiling: NEWEST - 50 });
        expect(query).toHaveBeenCalledWith(expect.stringContaining('_ingest_gap'), { windowDays: 7, ceiling: NEWEST - 50 });
    });

    it('skips the hole and partial queries when the block table is empty', async () => {
        const { clickhouse, query } = buildClickHouse({ newest: 0 });
        const reconciler = new ChainDataReconciler(clickhouse, buildSource(), buildSink(), { isSyncCaughtUp: () => true });

        const snapshot = await reconciler.run();

        expect(snapshot.status).toBe('clean');
        expect(query).toHaveBeenCalledTimes(1);
    });

    it('refetches missing and partly written blocks newest first and hands them to the writer', async () => {
        const { clickhouse } = buildClickHouse({ holes: [[500, 502, true]], partial: [700] });
        const source = buildSource();
        const sink = buildSink();
        const reconciler = new ChainDataReconciler(clickhouse, source, sink, { isSyncCaughtUp: () => true, repairChunkSize: 2 });

        const snapshot = await reconciler.run();

        expect(source.fetchChainDataRows.mock.calls.map(call => call[0])).toEqual([700, 502, 501, 500]);
        expect(sink.submit).toHaveBeenCalledTimes(4);
        expect(sink.drain).toHaveBeenCalledTimes(2);
        expect(snapshot).toMatchObject({
            status: 'repaired',
            missingBlocks: 3,
            partialBlocks: 1,
            missingLast24h: 3,
            oldestMissing: 500,
            newestMissing: 700,
            repaired: 4,
            repairFailures: 0,
            remaining: 0,
            consecutiveRunsWithGaps: 1
        });
    });

    it('counts but does not refetch while sync is behind', async () => {
        const { clickhouse } = buildClickHouse({ holes: [[500, 509, false]] });
        const source = buildSource();
        const reconciler = new ChainDataReconciler(clickhouse, source, buildSink(), { isSyncCaughtUp: () => false });

        const snapshot = await reconciler.run();

        expect(source.fetchChainDataRows).not.toHaveBeenCalled();
        expect(snapshot).toMatchObject({ status: 'skipped', missingBlocks: 10, missingLast24h: 0, remaining: 10 });
        expect(snapshot.message).toContain('behind');
    });

    it('stops at the per-run limit and says the next runs continue', async () => {
        const { clickhouse } = buildClickHouse({ holes: [[500, 504, true]] });
        const source = buildSource();
        const reconciler = new ChainDataReconciler(clickhouse, source, buildSink(), { isSyncCaughtUp: () => true, maxRepairsPerRun: 2 });

        const snapshot = await reconciler.run();

        expect(source.fetchChainDataRows).toHaveBeenCalledTimes(2);
        expect(snapshot).toMatchObject({ status: 'incomplete', repaired: 2, remaining: 3 });
        expect(snapshot.message).toContain('at most 2 blocks');
    });

    it('stops the run after repeated TronGrid failures', async () => {
        const { clickhouse } = buildClickHouse({ holes: [[500, 509, true]] });
        const source = buildSource([509, 508, 507]);
        const reconciler = new ChainDataReconciler(clickhouse, source, buildSink(), { isSyncCaughtUp: () => true, maxConsecutiveFailures: 3 });

        const snapshot = await reconciler.run();

        expect(source.fetchChainDataRows).toHaveBeenCalledTimes(3);
        expect(snapshot).toMatchObject({ status: 'incomplete', repaired: 0, repairFailures: 3, remaining: 10 });
        expect(snapshot.message).toContain('TronGrid failed 3 refetches in a row');
    });

    it('stops starting repairs once the time budget is spent', async () => {
        const { clickhouse } = buildClickHouse({ holes: [[500, 509, true]] });
        const source = buildSource();
        let clock = NOW.getTime();
        const reconciler = new ChainDataReconciler(clickhouse, source, buildSink(), {
            isSyncCaughtUp: () => true,
            timeBudgetMs: 1000,
            now: () => {
                clock += 400;
                return new Date(clock);
            }
        });

        const snapshot = await reconciler.run();

        expect(source.fetchChainDataRows.mock.calls.length).toBeLessThan(10);
        expect(snapshot.status).toBe('incomplete');
        expect(snapshot.message).toContain('time budget');
    });

    it('gives up on a block after it has failed the maximum number of times', async () => {
        const { clickhouse } = buildClickHouse({ holes: [[500, 500, true]] });
        const source = buildSource([500]);
        const reconciler = new ChainDataReconciler(clickhouse, source, buildSink(), {
            isSyncCaughtUp: () => true,
            maxAttemptsPerBlock: 2,
            maxConsecutiveFailures: 10
        });

        await reconciler.run();
        await reconciler.run();
        const snapshot = await reconciler.run();

        expect(source.fetchChainDataRows).toHaveBeenCalledTimes(2);
        expect(snapshot).toMatchObject({ status: 'incomplete', remaining: 1, consecutiveRunsWithGaps: 3 });
        expect(snapshot.message).toContain('no longer tried');
    });

    it('counts a block whose rows could not be built as a failure, not a repair', async () => {
        const { clickhouse } = buildClickHouse({ holes: [[500, 500, true]] });
        const source: IChainDataBlockSource = {
            fetchChainDataRows: async blockNumber => ({ blockNumber, blockTimestamp: '', tables: {}, failure: 'mapping bug' })
        };
        const sink = buildSink();
        const reconciler = new ChainDataReconciler(clickhouse, source, sink, { isSyncCaughtUp: () => true });

        const snapshot = await reconciler.run();

        expect(sink.submit).toHaveBeenCalledTimes(1);
        expect(snapshot).toMatchObject({ repaired: 0, repairFailures: 1, remaining: 1 });
    });

    it('resets the run streak once a run finds nothing missing', async () => {
        const holes: Array<[number, number, boolean]> = [[500, 500, true]];
        const { clickhouse } = buildClickHouse({ holes });
        const reconciler = new ChainDataReconciler(clickhouse, buildSource(), buildSink(), { isSyncCaughtUp: () => false });

        await reconciler.run();
        expect((await reconciler.run()).consecutiveRunsWithGaps).toBe(2);

        holes.length = 0;
        expect((await reconciler.run()).consecutiveRunsWithGaps).toBe(0);
    });

    it('records a failed check on the snapshot and rejects so the scheduler sees it', async () => {
        const { clickhouse } = buildClickHouse({ failWith: new Error('connection refused') });
        const reconciler = new ChainDataReconciler(clickhouse, buildSource(), buildSink(), { isSyncCaughtUp: () => true });

        await expect(reconciler.run()).rejects.toThrow('connection refused');
        expect(reconciler.getSnapshot()).toMatchObject({ status: 'failed', message: 'The chain data check failed: connection refused' });
    });
});
