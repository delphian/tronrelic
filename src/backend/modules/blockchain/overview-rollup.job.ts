/**
 * @fileoverview Network-activity rollup job.
 *
 * Pre-computes the buckets backing the `core:network-activity` widget into the
 * `core_network_activity_rollups` collection so the request path is a cheap read
 * instead of a live aggregation. This mirrors the resource-tracker /
 * dust-tracker rollup pattern: a scheduled job maintains pre-aggregated buckets;
 * the widget reads them.
 *
 * Why a job at all: the volume series sums `amountTRX` over every
 * `TransferContract` row in the window. Run live for a 7-day window over the
 * multi-million-row `transactions` collection, that scan exceeds the SSR widget
 * resolver's 5-second budget and the widget is dropped from the page. The job
 * never does that at request time and bounds its own work too — each run
 * recomputes only a small recent window (the in-progress bucket plus a little
 * lag) and backfills history one bounded chunk at a time, so it never scans the
 * full week in a single pass after the first few catch-up runs.
 *
 * Idempotent by construction: buckets are upserted on `(bucketType,
 * bucketStart)`, so recomputing a bucket overwrites it. Old buckets are pruned
 * to keep the collection bounded.
 *
 * @module backend/modules/blockchain/overview-rollup.job
 */

import type { IDatabaseService } from '@/types';
import type { BlockDoc } from '../../database/models/block-model.js';
import type { TransactionDoc } from '../../database/models/transaction-model.js';
import {
    CORE_NETWORK_ACTIVITY_ROLLUPS_COLLECTION,
    type CoreNetworkActivityRollupFields
} from '../../database/models/core-network-activity-rollup-model.js';
import { logger } from '../../lib/logger.js';

/** Core blocks collection — mirrors `BlockchainService.BLOCKS_COLLECTION`. */
const BLOCKS_COLLECTION = 'blocks';
/** Core transactions collection — mirrors `BlockchainService.TRANSACTIONS_COLLECTION`. */
const TRANSACTIONS_COLLECTION = 'transactions';

const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

/** MongoDB `$dateToString` formats per tier; both parse back to UTC ISO. */
const HOURLY_FORMAT = '%Y-%m-%d %H:00';
const MINUTE_FORMAT = '%Y-%m-%d %H:%M';

/** Hourly buckets a 7d window needs (168), so backfill targets `current − 167h`. */
const TARGET_HOURLY_BUCKETS = 168;
/** Recent hourly buckets recomputed each run: the in-progress hour plus 2 prior, to absorb late blocks. */
const RECENT_HOURLY_HOURS = 3;
/** Recent minute buckets recomputed each run — covers the 60-point 1h window plus margin. */
const RECENT_MINUTE_MINUTES = 75;
/** Older history filled per run, newest-first, until the 7d window is covered. */
const BACKFILL_CHUNK_HOURS = 48;
/** Hourly buckets kept (8d) — margin beyond the 7d read window. */
const HOURLY_RETENTION_HOURS = 8 * 24;
/** Minute buckets kept (3h) — margin beyond the 1h read window. */
const MINUTE_RETENTION_HOURS = 3;

/** One assembled bucket prior to upsert. */
interface IRollupBucket {
    bucketStart: Date;
    transactions: number;
    transfers: number;
    volume: number;
}

/**
 * Truncate a date to the start of its UTC hour. Buckets are UTC because
 * `$dateToString` defaults to UTC, so flooring must match.
 *
 * @param date - Source instant.
 * @returns A new Date at the top of the UTC hour.
 */
function floorToHour(date: Date): Date {
    const floored = new Date(date.getTime());
    floored.setUTCMinutes(0, 0, 0);
    return floored;
}

/**
 * Truncate a date to the start of its UTC minute.
 *
 * @param date - Source instant.
 * @returns A new Date at the top of the UTC minute.
 */
function floorToMinute(date: Date): Date {
    const floored = new Date(date.getTime());
    floored.setUTCSeconds(0, 0);
    return floored;
}

/**
 * Parse a `$dateToString` bucket key (UTC, no zone) into a Date. Appends
 * seconds + `Z` so both the hourly (`… HH:00`) and minute (`… HH:MM`) formats
 * resolve as UTC ISO — the same conversion the legacy timeseries used.
 *
 * @param key - Bucket key emitted by the aggregation.
 * @returns The parsed Date, or null when the key is unparseable.
 */
function parseBucketKey(key: string): Date | null {
    // Normalize the single space to `T` so the string is strict ISO 8601
    // ("2025-10-13T01:00:00Z") rather than the space form, whose parsing is
    // implementation-defined per the ECMAScript spec even though V8 accepts it.
    const parsed = new Date(`${key.replace(' ', 'T')}:00Z`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Compute the combined buckets for a time range at a given granularity.
 *
 * Runs the cheap block-count aggregation and the transactions volume
 * aggregation in parallel over the bounded `[startDate, endDate)` range, then
 * merges them by bucket key. Callers keep the range small (a recent window or a
 * single backfill chunk) so neither aggregation scans the whole collection.
 *
 * @param database - Database service for raw collection access.
 * @param format - `$dateToString` format selecting the bucket granularity.
 * @param startDate - Inclusive range start.
 * @param endDate - Exclusive range end.
 * @returns One bucket per tick across the range in ascending order, zero-filled
 *   where no blocks/transfers were observed, so callers always see a contiguous
 *   series and the backfill cursor advances even over empty ranges.
 */
async function computeBuckets(
    database: IDatabaseService,
    format: string,
    startDate: Date,
    endDate: Date
): Promise<IRollupBucket[]> {
    const blocks = database.getCollection<BlockDoc>(BLOCKS_COLLECTION);
    const transactions = database.getCollection<TransactionDoc>(TRANSACTIONS_COLLECTION);

    interface ICountRow { _id: string; transactions: number; transfers: number; }
    interface IVolumeRow { _id: string; volume: number; }

    const [countRows, volumeRows] = await Promise.all([
        blocks
            .aggregate<ICountRow>([
                { $match: { timestamp: { $gte: startDate, $lt: endDate } } },
                {
                    $group: {
                        _id: { $dateToString: { format, date: '$timestamp' } },
                        transactions: { $sum: '$transactionCount' },
                        transfers: { $sum: '$stats.transfers' }
                    }
                }
            ])
            .toArray(),
        transactions
            .aggregate<IVolumeRow>([
                { $match: { type: 'TransferContract', timestamp: { $gte: startDate, $lt: endDate } } },
                {
                    $group: {
                        _id: { $dateToString: { format, date: '$timestamp' } },
                        volume: { $sum: '$amountTRX' }
                    }
                }
            ])
            .toArray()
    ]);

    // Union by bucket key: seed from block counts, layer volume on top. A bucket
    // can have blocks but no native transfers (volume 0), and (rarely) vice
    // versa, so default the absent side rather than dropping the bucket.
    const merged = new Map<string, { transactions: number; transfers: number; volume: number }>();
    for (const row of countRows) {
        merged.set(row._id, { transactions: row.transactions, transfers: row.transfers, volume: 0 });
    }
    for (const row of volumeRows) {
        const existing = merged.get(row._id);
        if (existing) {
            existing.volume = row.volume;
        } else {
            merged.set(row._id, { transactions: 0, transfers: 0, volume: row.volume });
        }
    }

    const byTime = new Map<number, IRollupBucket>();
    for (const [key, metrics] of merged) {
        const bucketStart = parseBucketKey(key);
        if (!bucketStart) {
            continue;
        }
        byTime.set(bucketStart.getTime(), {
            bucketStart,
            transactions: metrics.transactions,
            transfers: metrics.transfers,
            volume: Number(metrics.volume.toFixed(6))
        });
    }

    // Materialize every expected bucket across [startDate, endDate), zero-filling
    // any tick the aggregation produced no row for. Without this a range with no
    // blocks returns no buckets, so the backfill cursor (the oldest stored
    // bucket) never advances past the gap and re-queries the same empty range
    // every run, while the read path returns a short/holey series. Callers pass
    // tier-aligned ranges, so every aggregated bucket key lands exactly on a step
    // tick; keying by getTime() avoids re-deriving the $dateToString UTC string.
    // Bounded by the caller's window (<=168 hourly / <=75 minute ticks).
    const stepMs = format === MINUTE_FORMAT ? MINUTE_MS : HOUR_MS;
    const buckets: IRollupBucket[] = [];
    for (let tick = startDate.getTime(); tick < endDate.getTime(); tick += stepMs) {
        buckets.push(
            byTime.get(tick) ?? { bucketStart: new Date(tick), transactions: 0, transfers: 0, volume: 0 }
        );
    }
    return buckets;
}

/**
 * Idempotently upsert a batch of buckets for one tier. Keyed on `(bucketType,
 * bucketStart)` so recomputing a bucket overwrites it; `createdAt` is stamped
 * only on first insert.
 *
 * @param database - Database service for raw collection access.
 * @param bucketType - Tier the buckets belong to.
 * @param buckets - Assembled buckets to persist; a no-op when empty.
 */
async function upsertBuckets(
    database: IDatabaseService,
    bucketType: CoreNetworkActivityRollupFields['bucketType'],
    buckets: IRollupBucket[]
): Promise<void> {
    if (buckets.length === 0) {
        return;
    }
    const collection = database.getCollection<CoreNetworkActivityRollupFields>(
        CORE_NETWORK_ACTIVITY_ROLLUPS_COLLECTION
    );
    await collection.bulkWrite(
        buckets.map((bucket) => ({
            updateOne: {
                filter: { bucketType, bucketStart: bucket.bucketStart },
                update: {
                    $set: {
                        bucketType,
                        bucketStart: bucket.bucketStart,
                        transactions: bucket.transactions,
                        transfers: bucket.transfers,
                        volume: bucket.volume
                    },
                    $setOnInsert: { createdAt: new Date() }
                },
                upsert: true
            }
        }))
    );
}

/**
 * Read the sync frontier — the timestamp of the most recently processed block.
 *
 * Anchoring rollups on the latest block (not the wall clock) keeps the buckets
 * correct even when sync lags, matching how the sibling widgets anchor on their
 * latest rollup.
 *
 * @param database - Database service for raw collection access.
 * @returns The latest block timestamp, or null when no blocks exist yet.
 */
async function getFrontier(database: IDatabaseService): Promise<Date | null> {
    const blocks = database.getCollection<BlockDoc>(BLOCKS_COLLECTION);
    const latest = await blocks.find({}, { projection: { timestamp: 1 } })
        .sort({ timestamp: -1 })
        .limit(1)
        .toArray();
    const timestamp = latest[0]?.timestamp;
    return timestamp ? new Date(timestamp) : null;
}

/**
 * Run one pass of the network-activity rollup.
 *
 * Each run does three bounded things: recompute the recent hourly window (the
 * in-progress hour plus lag), fill one chunk of older hourly history until the
 * 7-day window is covered, and recompute the recent minute window for the 1h
 * view. None of these scans the full collection: the recent windows are a few
 * hours, and the backfill is capped per run, so the heavy week-long scan never
 * happens in a single pass once history is filled. Stale buckets are pruned.
 *
 * Safe to call on an empty collection (first deploy): the recent windows seed
 * the newest buckets immediately and the backfill walks history backward over
 * subsequent runs. Failures propagate to the caller so the scheduler records
 * the run as failed (surfaced on `/system/scheduler`); the fire-and-forget boot
 * kick in core-jobs guards itself with `.catch()` to avoid an unhandledRejection.
 *
 * @param database - Database service for raw collection access.
 */
export async function runOverviewRollup(database: IDatabaseService): Promise<void> {
    const frontier = await getFrontier(database);
    if (!frontier) {
        logger.debug('network-activity rollup: no blocks indexed yet, skipping');
        return;
    }

    const currentHour = floorToHour(frontier);
    const currentMinute = floorToMinute(frontier);
    const collection = database.getCollection<CoreNetworkActivityRollupFields>(
        CORE_NETWORK_ACTIVITY_ROLLUPS_COLLECTION
    );

    // 1. Recent hourly recompute — the in-progress hour plus the prior two,
    // so late-arriving blocks are absorbed and the current hour finalizes as
    // it completes. End is the next hour boundary (exclusive).
    const recentHourStart = new Date(currentHour.getTime() - (RECENT_HOURLY_HOURS - 1) * HOUR_MS);
    const hourlyEnd = new Date(currentHour.getTime() + HOUR_MS);
    await upsertBuckets(database, 'hourly', await computeBuckets(database, HOURLY_FORMAT, recentHourStart, hourlyEnd));

    // 2. Backfill older hourly history one bounded chunk per run, newest-first,
    // until the 7-day window is covered. After the first few catch-up runs the
    // oldest present bucket reaches the target and this becomes a no-op.
    const desiredOldest = new Date(currentHour.getTime() - (TARGET_HOURLY_BUCKETS - 1) * HOUR_MS);
    const oldestDoc = await collection.find({ bucketType: 'hourly' })
        .sort({ bucketStart: 1 })
        .limit(1)
        .toArray();
    const oldestPresent = oldestDoc[0]?.bucketStart ? new Date(oldestDoc[0].bucketStart) : recentHourStart;
    if (oldestPresent.getTime() > desiredOldest.getTime()) {
        const chunkEnd = oldestPresent; // exclusive — strictly older buckets
        const chunkStart = new Date(
            Math.max(desiredOldest.getTime(), oldestPresent.getTime() - BACKFILL_CHUNK_HOURS * HOUR_MS)
        );
        await upsertBuckets(database, 'hourly', await computeBuckets(database, HOURLY_FORMAT, chunkStart, chunkEnd));
    }

    // 3. Recent minute recompute for the 1h window.
    const recentMinuteStart = new Date(currentMinute.getTime() - RECENT_MINUTE_MINUTES * MINUTE_MS);
    const minuteEnd = new Date(currentMinute.getTime() + MINUTE_MS);
    await upsertBuckets(database, 'minute', await computeBuckets(database, MINUTE_FORMAT, recentMinuteStart, minuteEnd));

    // 4. Prune stale buckets to keep the collection bounded.
    await collection.deleteMany({
        bucketType: 'minute',
        bucketStart: { $lt: new Date(frontier.getTime() - MINUTE_RETENTION_HOURS * HOUR_MS) }
    });
    await collection.deleteMany({
        bucketType: 'hourly',
        bucketStart: { $lt: new Date(frontier.getTime() - HOURLY_RETENTION_HOURS * HOUR_MS) }
    });
}
