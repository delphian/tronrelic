/**
 * @fileoverview Backfill the denormalized `paused` brake onto progress docs.
 *
 * Why this migration exists: the ingest, forward-sync, and snapshot scheduler
 * ticks used to load the entire tracked set *and* the entire progress set every
 * tick, then join, filter, sort, and slice in memory — the predicate spans two
 * collections (`paused` on tracked, dueness fields on progress), so a single
 * indexed query was impossible. The selectors now push their whole predicate
 * into one indexed query on the progress collection, which requires `paused` to
 * live there too. New and re-paused accounts get the field at write time; this
 * migration backfills the documents that predate the change so the selectors do
 * not read a stale `unpaused` for an account the operator had paused.
 *
 * Idempotent: re-running sets the same values. The tick-selector indexes are
 * created by the module's `ensureIndexes()` on every boot, so this migration
 * touches data only.
 */

import type { IMigration, IMigrationContext } from '@/types';
import { TRACKED_COLLECTION, PROGRESS_COLLECTION } from '../database/index.js';
import type { ITrackedAccountDoc, IAccountProgressDoc } from '../database/index.js';

/**
 * Copy each tracked account's `paused` value onto its progress document, then
 * default every still-unset progress doc to `false`.
 */
export const migration: IMigration = {
    id: '003_denormalize_paused_to_progress',
    description: 'Backfill the denormalized paused flag onto account-history progress docs so the ingest/forward-sync/snapshot tick selectors can filter unpaused accounts in a single indexed query.',
    dependencies: [],

    /**
     * Apply the backfill. Tracked-paused addresses are set first, then any
     * remaining progress doc missing the field is defaulted to unpaused.
     *
     * @param context - Migration context; uses `database` only (MongoDB target).
     */
    async up(context: IMigrationContext): Promise<void> {
        const tracked = context.database.getCollection<ITrackedAccountDoc>(TRACKED_COLLECTION);
        const progress = context.database.getCollection<IAccountProgressDoc>(PROGRESS_COLLECTION);

        // Step 1: mirror paused=true for accounts the operator has paused.
        const pausedAddresses = (await tracked.find({ paused: true }).toArray()).map((doc) => doc.address);
        if (pausedAddresses.length > 0) {
            const result = await progress.updateMany(
                { address: { $in: pausedAddresses } },
                { $set: { paused: true } }
            );
            console.log(`[Migration] Set paused=true on ${result.modifiedCount} progress docs`);
        }

        // Step 2: default every remaining progress doc (field absent) to unpaused.
        const defaulted = await progress.updateMany(
            { paused: { $exists: false } },
            { $set: { paused: false } }
        );
        console.log(`[Migration] Defaulted paused=false on ${defaulted.modifiedCount} progress docs`);
    }
};
