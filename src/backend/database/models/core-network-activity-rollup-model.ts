/**
 * @fileoverview Core network-activity rollup model.
 *
 * Pre-aggregated time buckets backing the `core:network-activity` widget, which
 * plots transactions, native transfers, and native TRX transfer volume over a
 * 1h/24h/7d window. The `network-activity:rollup` scheduler job pre-computes
 * them because a live aggregation over raw blocks and the multi-million-row
 * `transactions` collection exceeds the SSR widget resolver's 5-second budget,
 * and the resolver silently drops a widget that misses it. This follows the
 * resource-tracker and dust-tracker rollup pattern, adapted to core.
 *
 * Two granularities share the collection, discriminated by `bucketType`:
 * `minute` serves the 1h window (60 points), `hourly` serves 24h/7d (24/168
 * points). `(bucketType, bucketStart)` is the natural key, so the job upserts
 * idempotently — re-running for a bucket overwrites rather than duplicates.
 *
 * Core-owned collections take the `core_` name prefix; older core collections
 * such as `transactions` and `blocks` predate that convention and keep their names.
 *
 * @module backend/database/models/core-network-activity-rollup-model
 */

import { Schema, model, type Document } from 'mongoose';

/**
 * Physical collection name. `core_`-prefixed to mark core ownership; passed to
 * `database.registerModel`/`getCollection` as the logical key.
 */
export const CORE_NETWORK_ACTIVITY_ROLLUPS_COLLECTION = 'core_network_activity_rollups';

/**
 * Plain field interface for rollup documents. Use with `.lean()` / raw
 * collection reads to avoid Mongoose Document type friction.
 */
export interface CoreNetworkActivityRollupFields {
    /** Granularity tier — `minute` (1h window) or `hourly` (24h/7d windows). */
    bucketType: 'minute' | 'hourly';
    /** UTC start of the bucket, truncated to the tier (minute or hour). */
    bucketStart: Date;
    /** Total transactions of every contract type in the bucket. */
    transactions: number;
    /** Native `TransferContract` transfers in the bucket. */
    transfers: number;
    /** Summed native TRX moved by those transfers (TRC20/USDT excluded). */
    volume: number;
    /** Insert time; used only for debugging/auditing, not for windowing. */
    createdAt: Date;
}

/** Mongoose document interface for rollup records. */
export interface CoreNetworkActivityRollupDoc extends Document, CoreNetworkActivityRollupFields {}

const CoreNetworkActivityRollupSchema = new Schema<CoreNetworkActivityRollupDoc>(
    {
        bucketType: { type: String, enum: ['minute', 'hourly'], required: true },
        bucketStart: { type: Date, required: true },
        transactions: { type: Number, default: 0 },
        transfers: { type: Number, default: 0 },
        volume: { type: Number, default: 0 },
        createdAt: { type: Date, default: Date.now }
    },
    { versionKey: false }
);

// Natural key: one document per (tier, bucket). Unique so upserts are
// idempotent, and it also serves the request-time read — a descending
// `bucketStart` scan within a `bucketType` for the latest N points.
CoreNetworkActivityRollupSchema.index({ bucketType: 1, bucketStart: 1 }, { unique: true });

// The third argument pins the physical collection name. Without it Mongoose
// would bind the model (and build its unique index) on the pluralized default
// `corenetworkactivityrollups`, while the job and read path use the raw
// `core_network_activity_rollups` collection — leaving the (bucketType,
// bucketStart) unique key unenforced on the actual data and allowing duplicate
// buckets under concurrent upserts.
export const CoreNetworkActivityRollupModel = model<CoreNetworkActivityRollupDoc>(
    'CoreNetworkActivityRollup',
    CoreNetworkActivityRollupSchema,
    CORE_NETWORK_ACTIVITY_ROLLUPS_COLLECTION
);
