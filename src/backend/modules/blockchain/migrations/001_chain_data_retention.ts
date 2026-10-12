/**
 * @fileoverview Moves the existing ClickHouse chain data tables to the retention set in code.
 *
 * The block writer creates the `tron` tables with `CREATE TABLE IF NOT EXISTS`,
 * which writes `CHAIN_DATA_RETENTION_DAYS` into each table's TTL only when the
 * table is first created. Raising that constant from 7 to 14 days therefore
 * reaches a fresh deployment on its own, but a deployment that already has the
 * tables keeps expiring them at 7 days until this migration runs.
 *
 * For each expiring table it first turns on `materialize_ttl_recalculate_only`
 * and then runs `MODIFY TTL`. Without that setting the `MODIFY TTL` rewrites
 * every column of every stored part (about 60 GiB on production) and the
 * `ALTER` waits for the rewrite to finish. With it, ClickHouse keeps the
 * existing column files and only recomputes each part's expiry time.
 *
 * Days already dropped are not restored. Days still stored when it runs move
 * to the new expiry, so the window reaches 14 days a week after the run.
 *
 * Safe to repeat: both statements leave a table that already matches unchanged.
 * A table that does not exist yet is skipped, because the writer will create it
 * with the current retention. Skipped with a log line when ClickHouse is not
 * configured.
 *
 * @module backend/modules/blockchain/migrations/001_chain_data_retention
 */

import type { IMigration, IMigrationContext } from '@/types';
import {
    buildChainDataRetentionStatements,
    CHAIN_DATA_DATABASE,
    CHAIN_DATA_RETENTION_DAYS,
    chainDataExpiringTables
} from '../chain-data/buildChainDataSchema.js';

export const migration: IMigration = {
    id: '001_chain_data_retention',
    description:
        `Set the ClickHouse tron chain data tables to expire after ${CHAIN_DATA_RETENTION_DAYS} days. ` +
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
            const clickhouse = context.clickhouse;
            const rows = await clickhouse.query<{ name: string }>(
                'SELECT name FROM system.tables WHERE database = {db:String}',
                { db: CHAIN_DATA_DATABASE }
            );
            const existing = new Set(rows.map(row => row.name));

            for (const target of chainDataExpiringTables()) {
                if (existing.has(target.table)) {
                    for (const statement of buildChainDataRetentionStatements(target, CHAIN_DATA_RETENTION_DAYS)) {
                        await clickhouse.exec(statement);
                    }
                    console.log(`[Migration blockchain 001] ${CHAIN_DATA_DATABASE}.${target.table} now expires after ${CHAIN_DATA_RETENTION_DAYS} days`);
                } else {
                    console.log(`[Migration blockchain 001] ${CHAIN_DATA_DATABASE}.${target.table} does not exist yet — the writer will create it with the current retention`);
                }
            }
        }
    }
};
