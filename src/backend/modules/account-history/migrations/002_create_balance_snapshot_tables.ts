/**
 * @fileoverview ClickHouse DDL for the scheduled balance/resource snapshots.
 *
 * Why two tables: the scalar TRX/staking/resource state is one row per account
 * per day, while token holdings are a variable-length set — splitting them keeps
 * the scalar table narrow for fast latest-snapshot lookups and lets token rows
 * join directly to the price series on `(asset, day)` without a Map column. Both
 * are ReplacingMergeTree so a same-day re-sample overwrites in place; snapshots
 * are the valuation anchor and the product, so there is no TTL.
 */

import type { IMigration, IMigrationContext } from '@/types';

/**
 * Creates `account_balance_snapshots` and `account_token_balances`. No-op when
 * ClickHouse is not configured.
 */
export const migration: IMigration = {
    id: '002_create_balance_snapshot_tables',
    description: 'Create ClickHouse account_balance_snapshots and account_token_balances tables for portfolio valuation anchors.',
    target: 'clickhouse',
    dependencies: ['module:account-history:001_create_account_transactions_table'],

    /**
     * Apply both table DDLs.
     *
     * @param context - Migration context; `clickhouse` undefined skips the work.
     */
    async up(context: IMigrationContext): Promise<void> {
        if (!context.clickhouse) {
            return;
        }

        await context.clickhouse.exec(`
            CREATE TABLE IF NOT EXISTS account_balance_snapshots (
                account String,
                day Date,
                captured_at DateTime64(3, 'UTC'),
                trx_balance_sun Int64,
                staked_energy_sun Int64,
                staked_bandwidth_sun Int64,
                unstaking_sun Int64,
                energy_limit Int64,
                energy_used Int64,
                net_limit Int64,
                net_used Int64,
                ingested_at DateTime64(3, 'UTC')
            )
            ENGINE = ReplacingMergeTree(ingested_at)
            PARTITION BY toYYYYMM(day)
            ORDER BY (account, day)
        `);

        await context.clickhouse.exec(`
            CREATE TABLE IF NOT EXISTS account_token_balances (
                account String,
                day Date,
                asset String,
                raw_balance String,
                ingested_at DateTime64(3, 'UTC')
            )
            ENGINE = ReplacingMergeTree(ingested_at)
            PARTITION BY toYYYYMM(day)
            ORDER BY (account, day, asset)
        `);
    }
};
