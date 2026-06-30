/**
 * @fileoverview Migration: create the ClickHouse `account_value_transfers` table.
 *
 * The unifying value-movement ledger of the proposed account-history redesign (see
 * `docs/system/system-account-value-ledger.md`). Where `account_transactions` holds
 * one row per top-level transaction, this holds one row per discrete VALUE leg —
 * native transfers, TVM internal transfers, and token transfers alike — so a
 * transaction that moves value more than once (a contract paying several
 * recipients, a multi-asset internal call) is represented without collapsing legs.
 *
 * `ReplacingMergeTree` keyed `(account, timestamp, tx_id, origin, leg_key, asset_id)`
 * makes re-ingest idempotent. The leg identity is protocol-grounded: `leg_key` is
 * the internal-transaction hash for internal legs (empty for native/token legs), so
 * legs sharing a parent hash never collide and a provider swap reproduces the same
 * keys. Ordered for the dominant read (one account newest-first) and partitioned by
 * month; no TTL — account history is the product.
 *
 * Additive: this stage dual-writes the ledger alongside `account_transactions`. No
 * existing table or read path changes.
 */

import type { IMigration, IMigrationContext } from '@/types';

export const migration: IMigration = {
    id: '004_create_account_value_transfers_table',
    description:
        'Create the ClickHouse account_value_transfers ReplacingMergeTree table — the unifying ' +
        'value-movement ledger (native, internal, token legs) the account-history module dual-writes ' +
        'alongside account_transactions. Keyed (account, timestamp, tx_id, origin, leg_key, asset_id) ' +
        'for idempotent re-ingest; partitioned by month, no TTL.',
    target: 'clickhouse',
    dependencies: ['module:account-history:001_create_account_transactions_table'],

    /**
     * Create the table when ClickHouse is configured; no-op otherwise.
     *
     * @param context - Migration context; `clickhouse` is undefined when the
     *   deployment has no ClickHouse, in which case account-history is inert.
     */
    async up(context: IMigrationContext): Promise<void> {
        if (!context.clickhouse) {
            console.log('[Migration account-history:004] ClickHouse not configured — skipping account_value_transfers table creation');
            return;
        }

        await context.clickhouse.exec(`
            CREATE TABLE IF NOT EXISTS account_value_transfers (
                account String,
                tx_id String,
                origin LowCardinality(String),
                leg_key String,

                asset_type LowCardinality(String),
                asset_id String,

                from_address String,
                to_address String,

                amount_raw String,
                asset_decimals Nullable(UInt8),

                block_number UInt64,
                timestamp DateTime64(3, 'UTC'),

                ingested_at DateTime64(3, 'UTC')
            )
            ENGINE = ReplacingMergeTree(ingested_at)
            PARTITION BY toYYYYMM(timestamp)
            ORDER BY (account, timestamp, tx_id, origin, leg_key, asset_id)
        `);

        console.log('[Migration account-history:004] Created ClickHouse account_value_transfers table');
    }
};
