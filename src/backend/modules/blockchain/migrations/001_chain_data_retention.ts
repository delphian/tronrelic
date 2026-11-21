/**
 * @fileoverview Moves the existing ClickHouse chain data tables from 7 to 14 days of retention.
 *
 * The block writer creates the `tron` tables with `CREATE TABLE IF NOT EXISTS`,
 * which writes `CHAIN_DATA_RETENTION_DAYS` into each table's TTL only when the
 * table is first created. Raising that constant from 7 to 14 days therefore
 * reached a fresh deployment on its own, but a deployment that already had the
 * tables kept expiring them at 7 days until this migration ran.
 *
 * For each expiring table it first turns on `materialize_ttl_recalculate_only`
 * and then runs `MODIFY TTL`. Without that setting the `MODIFY TTL` rewrites
 * every column of every stored part (about 60 GiB on production) and the
 * `ALTER` waits for the rewrite to finish. With it, ClickHouse keeps the
 * existing column files and only recomputes each part's expiry time.
 *
 * The 14 is written here rather than read from `CHAIN_DATA_RETENTION_DAYS`,
 * because a migration records one operation and must not change meaning when
 * the constant is raised again. `003_chain_data_retention_21_days` moves the
 * tables on to 21 days and depends on this one, so a fresh deployment that runs
 * both ends at 21.
 *
 * Safe to repeat: both statements leave a table that already matches unchanged.
 * A table that does not exist yet is skipped, because the writer will create it
 * with the current retention. Skipped with a log line when ClickHouse is not
 * configured.
 *
 * @module backend/modules/blockchain/migrations/001_chain_data_retention
 */

import type { IMigration, IMigrationContext } from '@/types';
import { applyChainDataRetention } from '../chain-data/applyChainDataRetention.js';

/** The retention this migration records, in days. */
const RETENTION_DAYS = 14;

export const migration: IMigration = {
    id: '001_chain_data_retention',
    description:
        `Set the ClickHouse tron chain data tables to expire after ${RETENTION_DAYS} days. ` +
        'Turns on materialize_ttl_recalculate_only first so the TTL change recomputes expiry times ' +
        'instead of rewriting every stored part.',
    target: 'clickhouse',
    dependencies: [],

    /**
     * Apply the retention to every expiring chain data table that exists.
     *
     * @param context - Supplies the ClickHouse connection the statements run on.
     * @returns Nothing; the change lives in ClickHouse.
     */
    async up(context: IMigrationContext): Promise<void> {
        if (!context.clickhouse) {
            console.log('[Migration blockchain 001] ClickHouse not configured — skipping chain data retention change');
        } else {
            await applyChainDataRetention(context.clickhouse, RETENTION_DAYS, '[Migration blockchain 001]');
        }
    }
};
