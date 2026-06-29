/**
 * @fileoverview Migration: create the ClickHouse `account_transactions` table.
 *
 * Account backfills append a row per (tracked account, transaction). The table
 * is a `ReplacingMergeTree` keyed by `(account, timestamp, tx_id)` so the
 * inevitable overlaps from fingerprint paging and tick retries collapse to one
 * row instead of duplicating — idempotency for free. It is ordered for the
 * dominant read (one account's history newest-first) and partitioned by month
 * so range scans touch few partitions. No TTL: account history is the product,
 * not ephemeral analytics, so rows are retained until an operator drops them.
 */

import type { IMigration, IMigrationContext } from '@/types';

export const migration: IMigration = {
    id: '001_create_account_transactions_table',
    description:
        'Create the ClickHouse account_transactions ReplacingMergeTree table that stores ' +
        'the full per-account transaction history ingested by the account-history module. ' +
        'Keyed (account, timestamp, tx_id) for idempotent re-ingest and ordered for ' +
        'per-account newest-first reads; partitioned by month, no TTL.',
    target: 'clickhouse',
    dependencies: [],

    /**
     * Create the table when ClickHouse is configured; no-op otherwise.
     *
     * @param context - Migration context; `clickhouse` is undefined when the
     *   deployment has no ClickHouse, in which case account-history is inert.
     */
    async up(context: IMigrationContext): Promise<void> {
        if (!context.clickhouse) {
            console.log('[Migration account-history:001] ClickHouse not configured — skipping account_transactions table creation');
            return;
        }

        await context.clickhouse.exec(`
            CREATE TABLE IF NOT EXISTS account_transactions (
                account String,
                tx_id String,
                block_number UInt64,
                timestamp DateTime64(3, 'UTC'),

                type LowCardinality(String),
                status LowCardinality(String),

                from_address String,
                to_address String,

                amount_sun Nullable(Int64),
                fee_sun Nullable(Int64),
                energy_consumed Nullable(Int64),
                energy_fee_sun Nullable(Int64),
                bandwidth_consumed Nullable(Int64),
                bandwidth_fee_sun Nullable(Int64),

                contract_address Nullable(String),
                contract_method Nullable(String),
                memo Nullable(String),

                ingested_at DateTime64(3, 'UTC')
            )
            ENGINE = ReplacingMergeTree(ingested_at)
            PARTITION BY toYYYYMM(timestamp)
            ORDER BY (account, timestamp, tx_id)
        `);

        console.log('[Migration account-history:001] Created ClickHouse account_transactions table');
    }
};
