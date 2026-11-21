/**
 * @fileoverview Moves every existing ClickHouse chain data table to a given retention.
 *
 * The writer bakes the retention into each table's TTL only when it creates the
 * table, so a deployment that already has the tables needs a migration to change
 * it. Every retention migration does the same work, so it lives here once and
 * each migration passes in the number of days it records.
 *
 * @module backend/modules/blockchain/chain-data/applyChainDataRetention
 */

import type { IClickHouseService } from '@/types';
import {
    buildChainDataRetentionStatements,
    CHAIN_DATA_DATABASE,
    chainDataExpiringTables
} from './buildChainDataSchema.js';

/**
 * Apply a retention to every expiring chain data table that already exists.
 *
 * A retention migration must reach every data table, and must not fail on a
 * deployment where the writer has not created some of them yet. This reads the
 * table list from `system.tables`, runs the two statements from
 * {@link buildChainDataRetentionStatements} on each table that exists, and
 * skips the rest, because the writer creates those with the retention in code.
 * Both statements leave a table that already matches unchanged, so a repeat run
 * is safe.
 *
 * @param clickhouse - The connection the `ALTER TABLE` statements run on.
 * @param retentionDays - How many days of data each table should keep.
 * @param logPrefix - Names the calling migration in each log line, so an operator reading the output can tell which run changed what.
 * @returns Nothing; the change lives in ClickHouse.
 */
export async function applyChainDataRetention(
    clickhouse: IClickHouseService,
    retentionDays: number,
    logPrefix: string
): Promise<void> {
    const rows = await clickhouse.query<{ name: string }>(
        'SELECT name FROM system.tables WHERE database = {db:String}',
        { db: CHAIN_DATA_DATABASE }
    );
    const existing = new Set(rows.map(row => row.name));

    for (const target of chainDataExpiringTables()) {
        if (existing.has(target.table)) {
            for (const statement of buildChainDataRetentionStatements(target, retentionDays)) {
                await clickhouse.exec(statement);
            }
            console.log(`${logPrefix} ${CHAIN_DATA_DATABASE}.${target.table} now expires after ${retentionDays} days`);
        } else {
            console.log(`${logPrefix} ${CHAIN_DATA_DATABASE}.${target.table} does not exist yet — the writer will create it with the current retention`);
        }
    }
}
