/**
 * @fileoverview Un-park token cursors that were recorded as seeded with no
 * prices before a token price source existed.
 *
 * Why: the first price vendor served TRX only, and the service of that time
 * flipped `recentSeeded` on a token even when the vendor returned nothing. Such
 * a cursor has no day bounds, so the deep walk and the forward append both skip
 * it forever, and the token vendors added since would never be asked about it.
 * Clearing the flag lets the next backfill tick seed those tokens through the
 * new routing. TRX is left alone: its cursor has bounds and its stored history
 * is kept.
 */

import type { IMigration, IMigrationContext } from '@/types';
import { PROGRESS_COLLECTION } from '../database/index.js';

/**
 * Resets every token cursor that is marked seeded but holds no fetched day.
 */
export const migration: IMigration = {
    id: '002_unpark_empty_token_cursors',
    description: 'Clear recentSeeded on token price cursors that were seeded with no prices, so the token price sources re-seed them.',
    target: 'mongodb',
    dependencies: [],

    /**
     * Apply the reset. Idempotent: a cursor that has since seeded with prices
     * has a non-null oldest day and does not match.
     *
     * @param context - Migration context carrying the core database service.
     */
    async up(context: IMigrationContext): Promise<void> {
        await context.database.updateMany(
            PROGRESS_COLLECTION,
            { asset: { $ne: 'TRX' }, recentSeeded: true, oldestDayFetched: null },
            { $set: { recentSeeded: false, backfillComplete: false, unpricedAttempts: 0, nextAttemptAt: null, updatedAt: new Date() } }
        );
    }
};
