/**
 * @fileoverview Persistence shapes for the account-history module.
 *
 * Three MongoDB collections hold control state — the tracked set, per-account
 * resumable progress, and the singleton pacing settings — and one ClickHouse
 * row shape holds the ingested transactions. These are implementation
 * artifacts, not cross-component contracts, so they live in the module (in
 * core) rather than the types package; the published contract is
 * `IAccountHistoryService` in `@/types`. Collection names are manually prefixed
 * `module_account-history_*` per the module namespace convention.
 */

/** Physical MongoDB collection holding the operator-managed tracked set. */
export const TRACKED_COLLECTION = 'module_account-history_tracked';

/** Physical MongoDB collection holding per-account resumable ingestion progress. */
export const PROGRESS_COLLECTION = 'module_account-history_progress';

/** Physical MongoDB collection holding the singleton pacing settings document. */
export const SETTINGS_COLLECTION = 'module_account-history_settings';

/** ClickHouse table holding ingested per-account transactions. */
export const TRANSACTIONS_TABLE = 'account_transactions';

/** Fixed discriminator for the singleton settings document. */
export const SETTINGS_KEY = 'settings';

/**
 * Stored tracked-account record. Mirrors the public `ITrackedAccount` shape with
 * `addedAt`/`updatedAt` persisted as `Date`.
 */
export interface ITrackedAccountDoc {
    /** Base58 TRON address; unique within the collection. */
    address: string;
    /** Optional human label for the admin list. */
    label?: string;
    /** When true the ingestion tick skips this account. */
    paused: boolean;
    /** When the account was first added to the tracked set. */
    addedAt: Date;
    /** Last time this record was modified. */
    updatedAt: Date;
}

/**
 * Stored per-account ingestion progress / resumable cursor. One document per
 * tracked address, upserted as each tick advances the backfill.
 */
export interface IAccountProgressDoc {
    /** Base58 address this progress belongs to; unique within the collection. */
    address: string;
    /** Lifecycle state of the backfill. */
    status: 'queued' | 'running' | 'paused' | 'complete' | 'failed';
    /** Opaque TronGrid fingerprint for the next page; absent before first run or at completion. */
    cursorFingerprint?: string;
    /** Oldest block time reached walking history backward. */
    oldestTimestampReached?: Date;
    /** Newest block time observed on the first page. */
    newestTimestampSeen?: Date;
    /** Total rows written to ClickHouse for this account. */
    rowsIngested: number;
    /** When the ingestion tick last touched this account; drives round-robin ordering. */
    lastRunAt?: Date;
    /** Message from the most recent failed tick; cleared on the next success. */
    lastError?: string;
}

/**
 * Stored pacing settings. A single document discriminated by `key: SETTINGS_KEY`.
 */
export interface IAccountHistorySettingsDoc {
    /** Fixed discriminator so the singleton is addressable by `{ key }`. */
    key: string;
    /** Master switch; when false the ingestion tick is a no-op. */
    ingestionEnabled: boolean;
    /** TronGrid pages pulled per account per tick. */
    pagesPerTick: number;
    /** Tracked accounts advanced per tick (round-robin). */
    accountsPerTick: number;
}

/**
 * One row of the ClickHouse `account_transactions` table — a flat projection of
 * `IBlockTransaction` plus the per-account key and the ReplacingMergeTree
 * version column. Numeric fields are sun amounts and resource units; timestamps
 * are ClickHouse `DateTime64(3)` strings produced by `formatClickHouseDateTime64Utc`.
 */
export interface IAccountTransactionRow extends Record<string, unknown> {
    /** Tracked account this row was ingested for; part of the dedup key. */
    account: string;
    /** Transaction hash. */
    tx_id: string;
    /** Including block height. */
    block_number: number;
    /** Block execution time as a ClickHouse datetime string. */
    timestamp: string;
    /** Native contract type, e.g. `TransferContract`. */
    type: string;
    /** Native execution result, e.g. `SUCCESS`. */
    status: string;
    /** Base58 sender. */
    from_address: string;
    /** Base58 recipient. */
    to_address: string;
    /** Native TRX moved, in sun; null when the type carries no native value. */
    amount_sun: number | null;
    /** Total TRX burned, in sun; null when unknown. */
    fee_sun: number | null;
    /** Energy units consumed; null when unknown. */
    energy_consumed: number | null;
    /** TRX burned for energy, in sun; null when unknown. */
    energy_fee_sun: number | null;
    /** Bandwidth units consumed; null when unknown. */
    bandwidth_consumed: number | null;
    /** TRX burned for bandwidth, in sun; null when unknown. */
    bandwidth_fee_sun: number | null;
    /** Base58 contract address for contract calls (token contract for TRC20); null otherwise. */
    contract_address: string | null;
    /** Decoded method selector/name; null when not a contract call. */
    contract_method: string | null;
    /** Decoded memo (hex of `raw_data.data`); null when none. */
    memo: string | null;
    /** Ingestion time; the ReplacingMergeTree version column. */
    ingested_at: string;
}

/**
 * Minimal shape of a TronGrid account-transaction item the provider reads. The
 * v1 REST API returns the full java-tron transaction envelope; the provider
 * touches only these fields, all optional because TronGrid omits what a given
 * transaction type does not carry.
 */
export interface ITronGridAccountTx {
    /** Transaction hash. */
    txID?: string;
    /** Including block height. */
    blockNumber?: number;
    /** Block time in epoch milliseconds. */
    block_timestamp?: number;
    /** Raw transaction body: contracts and optional memo data. */
    raw_data?: {
        contract?: Array<{
            type?: string;
            parameter?: { value?: Record<string, unknown> };
        }>;
        data?: string;
    };
    /** Execution result records; `ret[0].contractRet` is the status. */
    ret?: Array<{ contractRet?: string }>;
    /** Total TRX burned, in sun. */
    fee?: number;
    /** Energy units consumed (total). */
    energy_usage_total?: number;
    /** Energy units drawn from the account's own resources. */
    energy_usage?: number;
    /** TRX burned for energy, in sun. */
    energy_fee?: number;
    /** Bandwidth units consumed. */
    net_usage?: number;
    /** TRX burned for bandwidth, in sun. */
    net_fee?: number;
}
