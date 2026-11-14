/**
 * @fileoverview ClickHouse DDL for the permanent Google Search Console archive.
 *
 * Google keeps only 16 months of Search Console data, and the MongoDB
 * collections that used to hold it (`module_user_gsc_*`) expired rows after
 * 120 days, so without a permanent copy the site's search history is lost for
 * good. These three tables keep every day ever fetched, with no TTL, and every
 * Search Console read is served from them. Each holds one kind of request:
 * keyword rows, per-day site totals, and per-day page totals.
 */

import type { IMigration, IMigrationContext } from '@/types';

/**
 * Creates `gsc_queries`, `gsc_daily_totals`, and `gsc_page_totals`.
 *
 * Every table is a `ReplacingMergeTree(fetched_at)` keyed on the dimensions
 * Google reports a row for, so a refetch of the same day replaces the earlier
 * row instead of adding a second one. `gsc_queries` is ordered keyword first,
 * because the history it exists for is read one keyword at a time, and both
 * larger tables are partitioned by month so a date-range read skips the rest.
 *
 * Idempotent through `CREATE TABLE IF NOT EXISTS`. Rollback, if ever needed:
 * `DROP TABLE IF EXISTS gsc_queries, gsc_daily_totals, gsc_page_totals`.
 */
export const migration: IMigration = {
    id: '023_create_gsc_archive_tables',
    description:
        'Create the ClickHouse gsc_queries, gsc_daily_totals, and gsc_page_totals tables, the permanent ' +
        'archive (no TTL) of Google Search Console data that the gsc:fetch job writes and the SEO tab and AI ' +
        'tool read. Until it runs, the daily job fails, the SEO tab shows errors, and the backfill cannot start.',
    target: 'clickhouse',
    dependencies: [],

    /**
     * Apply the DDL.
     *
     * @param context - Migration context; `clickhouse` is undefined when the
     *   deployment has no ClickHouse, in which case there is nothing to create.
     */
    async up(context: IMigrationContext): Promise<void> {
        if (!context.clickhouse) {
            return;
        }

        await context.clickhouse.exec(`
            CREATE TABLE IF NOT EXISTS gsc_queries (
                date Date,
                query String,
                page LowCardinality(String),
                country LowCardinality(String),
                device LowCardinality(String),
                clicks UInt32,
                impressions UInt32,
                ctr Float64,
                position Float64,
                fetched_at DateTime64(3, 'UTC')
            )
            ENGINE = ReplacingMergeTree(fetched_at)
            PARTITION BY toYYYYMM(date)
            ORDER BY (query, date, page, country, device)
        `);

        await context.clickhouse.exec(`
            CREATE TABLE IF NOT EXISTS gsc_daily_totals (
                date Date,
                clicks UInt32,
                impressions UInt32,
                fetched_at DateTime64(3, 'UTC')
            )
            ENGINE = ReplacingMergeTree(fetched_at)
            ORDER BY date
        `);

        await context.clickhouse.exec(`
            CREATE TABLE IF NOT EXISTS gsc_page_totals (
                date Date,
                page LowCardinality(String),
                clicks UInt32,
                impressions UInt32,
                ctr Float64,
                position Float64,
                fetched_at DateTime64(3, 'UTC')
            )
            ENGINE = ReplacingMergeTree(fetched_at)
            PARTITION BY toYYYYMM(date)
            ORDER BY (page, date)
        `);
    }
};
