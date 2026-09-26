/**
 * Unit tests for the batched transaction prune. The limits in this loop are
 * what keep pruning from starving block commits, so each one is pinned here:
 * the batch cap, the time budget, the pause between batches, and the final
 * partial batch that ends a run.
 */
import { describe, it, expect, vi } from 'vitest';
import {
    pruneTransactionsInBatches,
    type ITransactionPruneOptions,
    type ITransactionPruneStore
} from '../pruneTransactionsInBatches.js';

/**
 * Build an in-memory store holding expired transactions, one per millisecond
 * timestamp, so batch boundaries fall on predictable values.
 *
 * @param count - How many expired transactions the store starts with.
 * @returns The store, plus a function reporting how many transactions remain,
 *          so a test can check what a run actually removed.
 */
function createStore(count: number): { store: ITransactionPruneStore; remaining: () => number } {
    let timestamps = Array.from({ length: count }, (_, index) => index);

    const store: ITransactionPruneStore = {
        /**
         * Return the timestamp of the batchSize-th oldest expired transaction.
         *
         * @param cutoff - Only transactions older than this count.
         * @param batchSize - Position of the boundary.
         * @returns The boundary, or null when fewer than a full batch remain.
         */
        findBatchBoundary: async (cutoff, batchSize) => {
            const expired = timestamps.filter(value => value < cutoff.getTime());
            const boundary = expired[batchSize - 1];

            return boundary === undefined ? null : new Date(boundary);
        },
        /**
         * Remove transactions at or before the boundary.
         *
         * @param boundary - The timestamp that ends the batch.
         * @returns How many were removed.
         */
        deleteThrough: async boundary => {
            const before = timestamps.length;
            timestamps = timestamps.filter(value => value > boundary.getTime());

            return before - timestamps.length;
        },
        /**
         * Remove transactions older than the cutoff.
         *
         * @param cutoff - Transactions older than this are removed.
         * @returns How many were removed.
         */
        deleteBefore: async cutoff => {
            const before = timestamps.length;
            timestamps = timestamps.filter(value => value >= cutoff.getTime());

            return before - timestamps.length;
        }
    };

    return { store, remaining: () => timestamps.length };
}

/**
 * Options with a cutoff above every stored timestamp, a pause that returns at
 * once, and a clock that never advances, so only the option under test limits
 * the run.
 *
 * @param overrides - The limits a test wants to change.
 * @returns Options ready to pass to the loop.
 */
function options(overrides: Partial<ITransactionPruneOptions> = {}): ITransactionPruneOptions {
    return {
        cutoff: new Date(1_000_000),
        batchSize: 10,
        maxBatches: 100,
        pauseMs: 1_000,
        timeBudgetMs: 40_000,
        pause: async () => undefined,
        now: () => 0,
        ...overrides
    };
}

describe('pruneTransactionsInBatches', () => {
    it('deletes everything expired and reports the run complete', async () => {
        const { store, remaining } = createStore(25);

        const result = await pruneTransactionsInBatches(store, options());

        expect(result).toEqual({ deletedCount: 25, batches: 3, complete: true });
        expect(remaining()).toBe(0);
    });

    it('stops at the batch cap and leaves the rest for the next run', async () => {
        const { store, remaining } = createStore(100);

        const result = await pruneTransactionsInBatches(store, options({ maxBatches: 3 }));

        expect(result).toEqual({ deletedCount: 30, batches: 3, complete: false });
        expect(remaining()).toBe(70);
    });

    it('starts no new batch once the time budget is spent', async () => {
        const { store } = createStore(100);
        let clock = 0;

        const result = await pruneTransactionsInBatches(store, options({
            timeBudgetMs: 25_000,
            now: () => clock,
            pause: async () => {
                clock += 10_000;
            }
        }));

        // Batches start at 0s, 10s, and 20s; the fourth would start at 30s.
        expect(result.batches).toBe(3);
        expect(result.complete).toBe(false);
    });

    it('pauses between batches but not before the first or after the one that finishes', async () => {
        const { store } = createStore(25);
        const pause = vi.fn(async (_ms: number) => undefined);

        await pruneTransactionsInBatches(store, options({ pause }));

        expect(pause).toHaveBeenCalledTimes(2);
        expect(pause).toHaveBeenCalledWith(1_000);
    });

    it('leaves transactions newer than the cutoff alone', async () => {
        const { store, remaining } = createStore(25);

        const result = await pruneTransactionsInBatches(store, options({ cutoff: new Date(15) }));

        expect(result).toEqual({ deletedCount: 15, batches: 2, complete: true });
        expect(remaining()).toBe(10);
    });

    it('issues one delete and reports complete when nothing has expired', async () => {
        const { store } = createStore(0);

        const result = await pruneTransactionsInBatches(store, options());

        expect(result).toEqual({ deletedCount: 0, batches: 1, complete: true });
    });
});
