/**
 * @fileoverview ClickHouse DDL for the daily price series.
 *
 * Why a dedicated table rather than reusing an existing one: valuation reads join
 * a transaction's UTC day to a closing USD price, and that join must be cheap at
 * ledger scale. A narrow ReplacingMergeTree keyed `(asset, day)`, partitioned by
 * month, gives point lookups and contiguous range scans while making a re-fetch
 * of the same day idempotent (the newer `fetched_at` wins). Prices are immutable
 * and the series is the product, so there is no TTL.
 */

import type { IMigration, IMigrationContext } from '@/types';

/**
 * Creates the `price_history` table. No-op when ClickHouse is not configured —
 * the executor skips ClickHouse-targeted migrations in that case, and the guard
 * keeps a manual run safe too.
 */
export const migration: IMigration = {
    id: '001_create_price_history_table',
    description: 'Create the ClickHouse price_history table (daily USD price per asset) for portfolio valuation.',
    target: 'clickhouse',
    dependencies: [],

    /**
     * Apply the DDL.
     *
     * @param context - Migration context; `clickhouse` is undefined when the
     *   deployment has no ClickHouse, in which case the migration is a no-op.
     */
    async up(context: IMigrationContext): Promise<void> {
        if (!context.clickhouse) {
            return;
        }

        await context.clickhouse.exec(`
            CREATE TABLE IF NOT EXISTS price_history (
                asset LowCardinality(String),
                day Date,
                price_usd Float64,
                source LowCardinality(String),
                fetched_at DateTime64(3, 'UTC')
            )
            ENGINE = ReplacingMergeTree(fetched_at)
            PARTITION BY toYYYYMM(day)
            ORDER BY (asset, day)
        `);
    }
};
