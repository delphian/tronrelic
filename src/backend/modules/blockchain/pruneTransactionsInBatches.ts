/**
 * @fileoverview Deleting expired transactions in small, spaced batches.
 *
 * The `transactions` collection keeps four days of rows, and the chain adds
 * about 7,000 of them a minute (roughly 350 per block, 20 blocks a minute).
 * Pruning used to run once an hour as a single `deleteMany` covering an hour of
 * rows, about 400,000 documents. Each deletion has to update every index on the
 * collection, so that one statement kept MongoDB's disk and cache busy for up
 * to 16 minutes. Block commits write to the same indexes and fell from 20 a
 * minute to as few as 3 during it, which left production hundreds of blocks
 * behind the chain every hour.
 *
 * This file does the same work as a series of bounded deletes with a pause
 * between each, so a commit can run between two batches instead of waiting
 * behind the whole hour. The loop is kept apart from `BlockchainService` and
 * talks to storage through {@link ITransactionPruneStore}, so its limits can be
 * tested without a database.
 *
 * @module backend/modules/blockchain/pruneTransactionsInBatches
 */

import { setTimeout as sleep } from 'node:timers/promises';

/**
 * The storage operations the prune loop needs.
 *
 * Narrowed to three calls so a test can supply an in-memory fake, and so the
 * query shapes stay in `BlockchainService` beside the model they run against.
 */
export interface ITransactionPruneStore {
    /**
     * Find where the next batch ends.
     *
     * @param cutoff - Transactions strictly older than this are expired.
     * @param batchSize - How many of the oldest expired transactions one batch
     *                    should remove.
     * @returns The timestamp of the `batchSize`-th oldest expired transaction,
     *          or null when fewer than `batchSize` expired transactions remain.
     *          The caller deletes through this timestamp, so several
     *          transactions sharing it (one block's worth at most) can make a
     *          batch slightly larger than `batchSize`.
     */
    findBatchBoundary(cutoff: Date, batchSize: number): Promise<Date | null>;

    /**
     * Delete every transaction at or before a batch boundary.
     *
     * @param boundary - A timestamp returned by {@link findBatchBoundary}. It is
     *                   always older than the cutoff, so nothing unexpired is
     *                   removed.
     * @returns How many transactions were deleted, so the run can report it.
     */
    deleteThrough(boundary: Date): Promise<number>;

    /**
     * Delete every transaction older than the cutoff.
     *
     * Used for the final batch, when {@link findBatchBoundary} has reported that
     * fewer than a full batch of expired transactions remain.
     *
     * @param cutoff - Transactions strictly older than this are deleted.
     * @returns How many transactions were deleted, so the run can report it.
     */
    deleteBefore(cutoff: Date): Promise<number>;
}

/** The limits one prune run works within. */
export interface ITransactionPruneOptions {
    /** Transactions strictly older than this are deleted. */
    cutoff: Date;
    /**
     * Transactions removed per delete statement. Small enough that one batch
     * finishes in about the time between two block commits.
     */
    batchSize: number;
    /**
     * Most batches one run may delete. Bounds the work a single run does, so a
     * large backlog is cleared over several runs rather than in one long run.
     */
    maxBatches: number;
    /**
     * Wait between two batches. This is the gap in which block commits get the
     * database to themselves.
     */
    pauseMs: number;
    /**
     * No new batch starts once the run has lasted this long. Keeps a run inside
     * its schedule period when MongoDB is slow, because the scheduler skips the
     * next run while one is still going.
     */
    timeBudgetMs: number;
    /** Wait function, replaceable so a test does not have to sleep. */
    pause?: (ms: number) => Promise<unknown>;
    /** Clock, replaceable so a test can drive the time budget. */
    now?: () => number;
}

/** What one prune run did. */
export interface ITransactionPruneResult {
    /** Transactions deleted across every batch in the run. */
    deletedCount: number;
    /** Delete statements issued. */
    batches: number;
    /**
     * True when no expired transactions were left at the end of the run. False
     * means the run stopped at its batch limit or time budget, and the next run
     * continues from where this one stopped.
     */
    complete: boolean;
}

/**
 * The default limits for the `blockchain:prune-transactions` job, which runs
 * once a minute.
 *
 * Sized against the rate transactions arrive, about 7,000 a minute. One run can
 * delete up to 20,000, about three times that rate, so a backlog left by
 * downtime or by the old hourly prune shrinks by roughly 13,000 each minute. In
 * steady state a run needs about four batches. The one-second pause lets
 * commits, which arrive every three seconds, run between batches. The 40-second
 * budget keeps a slow run from reaching into the next minute's run.
 */
export const TRANSACTION_PRUNE_DEFAULTS = {
    batchSize: 2_000,
    maxBatches: 10,
    pauseMs: 1_000,
    timeBudgetMs: 40_000
} as const;

/**
 * Delete expired transactions in bounded batches until none remain or a run
 * limit is reached.
 *
 * Each batch first finds the timestamp that ends it, then deletes through that
 * timestamp. When fewer than a full batch remain, the last batch deletes
 * everything older than the cutoff and the run reports itself complete. A
 * pause follows each batch that leaves work behind, except the batch that
 * reaches the batch cap.
 *
 * @param store - Where the transactions live. Injected so the loop can be
 *                tested without MongoDB.
 * @param options - The cutoff and the limits this run works within.
 * @returns How much was deleted and whether expired transactions remain, which
 *          the caller logs so an operator can see a backlog draining.
 */
export async function pruneTransactionsInBatches(
    store: ITransactionPruneStore,
    options: ITransactionPruneOptions
): Promise<ITransactionPruneResult> {
    const pause = options.pause ?? sleep;
    const now = options.now ?? Date.now;
    const startedAt = now();
    let deletedCount = 0;
    let batches = 0;
    let complete = false;

    while (!complete && batches < options.maxBatches && now() - startedAt < options.timeBudgetMs) {
        const boundary = await store.findBatchBoundary(options.cutoff, options.batchSize);

        deletedCount += boundary
            ? await store.deleteThrough(boundary)
            : await store.deleteBefore(options.cutoff);
        batches += 1;
        complete = boundary === null;

        // Pausing here rather than at the top of the loop means the time budget
        // is checked after the pause, so no batch starts once it is spent.
        if (!complete && batches < options.maxBatches) {
            await pause(options.pauseMs);
        }
    }

    const result: ITransactionPruneResult = { deletedCount, batches, complete };

    return result;
}
