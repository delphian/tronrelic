/**
 * @fileoverview Moves the existing ClickHouse chain data tables from 14 to 21 days of retention.
 *
 * `CHAIN_DATA_RETENTION_DAYS` is written into each `tron` table's TTL only when
 * the writer first creates the table, so raising it to 21 reaches a fresh
 * deployment on its own. A deployment that already has the tables keeps
 * dropping days at 14 until this migration runs.
 *
 * It runs the same two statements per table as `001_chain_data_retention`:
 * `materialize_ttl_recalculate_only` first, so `MODIFY TTL` only recomputes
 * each part's expiry time instead of rewriting the stored data, then the TTL.
 *
 * Days already dropped are not restored. Days still stored when it runs move to
 * the new expiry, so the window reaches 21 days a week after the run.
 *
 * It depends on 001 so that a fresh deployment running both applies 14 first
 * and ends at 21. The 21 is written here rather than read from the constant,
 * because a migration records one operation and must not change meaning when
 * the constant moves again. Safe to repeat. Skipped with a log line when
 * ClickHouse is not configured.
 *
 * @module backend/modules/blockchain/migrations/003_chain_data_retention_21_days
 */

import type { IMigration, IMigrationContext } from '@/types';
import { applyChainDataRetention } from '../chain-data/applyChainDataRetention.js';

/** The retention this migration records, in days. */
const RETENTION_DAYS = 21;

export const migration: IMigration = {
    id: '003_chain_data_retention_21_days',
    description:
        `Set the ClickHouse tron chain data tables to expire after ${RETENTION_DAYS} days instead of 14. ` +
        'Recomputes each part\'s expiry time without rewriting stored data. Days already dropped are not ' +
        'restored, so the window fills to 21 days over the week after the run.',
    target: 'clickhouse',
    dependencies: ['module:blockchain:001_chain_data_retention'],

    /**
     * Apply the 21-day retention to every expiring chain data table that exists.
     *
     * @param context - Supplies the ClickHouse connection the statements run on.
     * @returns Nothing; the change lives in ClickHouse.
     */
    async up(context: IMigrationContext): Promise<void> {
        if (!context.clickhouse) {
            console.log('[Migration blockchain 003] ClickHouse not configured — skipping chain data retention change');
        } else {
            await applyChainDataRetention(context.clickhouse, RETENTION_DAYS, '[Migration blockchain 003]');
        }
    }
};
