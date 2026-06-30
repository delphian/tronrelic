/**
 * @fileoverview Migration: backfill NATIVE value legs into `account_value_transfers`.
 *
 * Stage 3a of the account value-transfer ledger redesign (see
 * `docs/system/system-account-value-ledger.md`). The Stage-2 dual-write only fills
 * the ledger for accounts ingested *after* it shipped; every account that finished
 * its backfill earlier has native-TRX rows sitting in `account_transactions` that
 * were never projected into the ledger. Native legs are a pure function of those
 * stored rows, so this one ClickHouse `INSERT … SELECT` reconstructs them for the
 * whole population at once — no provider calls, no rate-limit pressure.
 *
 * Scope is deliberately native-ONLY. It mirrors `toValueTransfers`, which derives a
 * native leg only for a positive-native-value `TransferContract` / `TriggerSmartContract`
 * row. Token (`token_event`) legs are intentionally absent here: their natural key is
 * the protocol `log_index`, which `account_transactions` does not store, so a SQL
 * projection could only use an empty `leg_key` and would collide two distinct
 * same-token transfers in one transaction under the ledger's `ReplacingMergeTree`
 * key — the exact loss the live path's events-sourced `log_index` was added to
 * prevent. Token and internal legs are backfilled through the provider instead, by
 * the service's ledger-backfill tick. Internal legs never lived in
 * `account_transactions` at all, so they too are out of scope here.
 *
 * Idempotent: the native leg's natural key here is identical to the one the live
 * dual-write produces (`origin='native'`, `leg_key=''`), so re-running this
 * migration or overlapping it with live ingest collapses under `ReplacingMergeTree`.
 */

import type { IMigration, IMigrationContext } from '@/types';

export const migration: IMigration = {
    id: '005_backfill_value_transfers_from_transactions',
    description:
        'Backfill native TRX value legs into account_value_transfers from account_transactions ' +
        '(source=tx, positive native value, TransferContract/TriggerSmartContract) — Stage 3a of the ' +
        'value-transfer ledger redesign. Native-only: token legs need the events log_index (not stored ' +
        'here) and internal legs were never in account_transactions; both are backfilled via the provider. ' +
        'Idempotent via the ReplacingMergeTree natural key (origin=native, leg_key="").',
    target: 'clickhouse',
    dependencies: ['module:account-history:004_create_account_value_transfers_table'],

    /**
     * Project native legs from `account_transactions` into the ledger when
     * ClickHouse is configured; no-op otherwise (account-history is inert without
     * ClickHouse, so there is nothing to backfill).
     *
     * @param context - Migration context; `clickhouse` is undefined on deployments
     *   without ClickHouse, in which case the backfill is skipped.
     */
    async up(context: IMigrationContext): Promise<void> {
        if (!context.clickhouse) {
            console.log('[Migration account-history:005] ClickHouse not configured — skipping native value-leg backfill');
            return;
        }

        // Columns are named explicitly (matching the live dual-write's
        // column-name insert via `clickhouse.insert<IAccountValueTransferRow>`) so
        // the projection cannot silently misalign; the SELECT lists them in DDL
        // order. `FINAL` collapses any duplicate source rows before projection (the
        // target key would collapse them anyway; FINAL just keeps the insert lean).
        // The WHERE reproduces toValueTransfers exactly — a positive native amount
        // on a genuine native-TRX contract type. A USDT TriggerSmartContract twin
        // has amount_sun = 0 (its value is the token, not TRX) and so is excluded.
        await context.clickhouse.exec(`
            INSERT INTO account_value_transfers (
                account,
                tx_id,
                origin,
                leg_key,
                asset_type,
                asset_id,
                from_address,
                to_address,
                amount_raw,
                asset_decimals,
                block_number,
                timestamp,
                ingested_at
            )
            SELECT
                account,
                tx_id,
                'native' AS origin,
                '' AS leg_key,
                'TRX' AS asset_type,
                '' AS asset_id,
                from_address,
                to_address,
                toString(amount_sun) AS amount_raw,
                CAST(NULL AS Nullable(UInt8)) AS asset_decimals,
                block_number,
                timestamp,
                now64(3, 'UTC') AS ingested_at
            FROM account_transactions FINAL
            WHERE source = 'tx'
              AND amount_sun > 0
              AND type IN ('TransferContract', 'TriggerSmartContract')
        `);

        console.log('[Migration account-history:005] Backfilled native value legs from account_transactions into account_value_transfers');
    }
};
