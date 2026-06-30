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

/** ClickHouse table holding the per-account value-transfer ledger (native/internal/token legs). */
export const VALUE_TRANSFERS_TABLE = 'account_value_transfers';

/** ClickHouse table holding scheduled scalar balance/resource snapshots. */
export const BALANCE_SNAPSHOTS_TABLE = 'account_balance_snapshots';

/** ClickHouse table holding per-token raw balances captured alongside each snapshot. */
export const TOKEN_BALANCES_TABLE = 'account_token_balances';

/** Fixed discriminator for the singleton settings document. */
export const SETTINGS_KEY = 'settings';

/**
 * Which TronGrid account endpoint a stored row came from. `'tx'` is the general
 * `/transactions` endpoint (native TRX, TRC10, staking, raw contract calls);
 * `'trc20'` is `/transactions/trc20` (decoded token transfers, including inbound
 * ones the general endpoint omits). Part of the ClickHouse dedup key.
 */
export type AccountTxSource = 'tx' | 'trc20';

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
    /** Lifecycle state of the backfill; `complete` only once BOTH endpoints exhaust. */
    status: 'queued' | 'running' | 'paused' | 'complete' | 'failed';
    /**
     * Denormalized copy of the tracked-account `paused` brake, kept here so the
     * ingest, forward-sync, and snapshot tick selectors push their whole
     * predicate (unpaused + dueness) into one indexed query on this collection
     * instead of loading the entire tracked + progress sets and joining in
     * memory. Authoritative value still lives on the tracked doc; this mirror is
     * written by `setAccountPaused` and seeded `false` on insert. Absent on
     * pre-migration documents — selectors use `{$ne: true}` so a missing value
     * reads as unpaused until migration 003 backfills it.
     */
    paused?: boolean;
    /** Opaque fingerprint for the next general `/transactions` page; absent before first run or when that endpoint is exhausted. */
    cursorFingerprint?: string;
    /** Opaque fingerprint for the next `/transactions/trc20` page; absent before first run or when that endpoint is exhausted. */
    trc20CursorFingerprint?: string;
    /** Opaque fingerprint for the next `/internal-transactions` page; absent before first run or when that endpoint is exhausted. */
    internalCursorFingerprint?: string;
    /** True once the general `/transactions` walk has reached the end of available history. */
    nativeComplete?: boolean;
    /** True once the `/transactions/trc20` walk has reached the end of available history. */
    trc20Complete?: boolean;
    /** True once the `/internal-transactions` walk has reached the end of available history. */
    internalComplete?: boolean;
    /** Oldest block time reached walking history backward. */
    oldestTimestampReached?: Date;
    /** Newest block time observed on the first page. */
    newestTimestampSeen?: Date;
    /**
     * Forward-sync continuation cursor for the general `/transactions` endpoint.
     * Set only while a forward drain spans ticks — when one tick's newest-first
     * walk hits the page cap before reaching the watermark, this holds the
     * fingerprint to resume from on the next tick. Absent means the endpoint is
     * not mid-drain, so the next forward poll starts fresh from the leading edge.
     */
    forwardTxCursor?: string;
    /**
     * Forward-sync continuation cursor for the `/transactions/trc20` endpoint —
     * the token-transfer counterpart of {@link forwardTxCursor}, same contract.
     */
    forwardTrc20Cursor?: string;
    /**
     * Forward-sync continuation cursor for the `/internal-transactions` endpoint —
     * the internal-value-transfer counterpart of {@link forwardTxCursor}, same contract.
     */
    forwardInternalCursor?: string;
    /**
     * Newest timestamp captured during an in-progress (multi-tick) forward drain,
     * held back from `newestTimestampSeen` until the drain reaches known territory.
     * Promoting the watermark only on drain completion is what closes the page-cap
     * gap: the watermark never advances past rows a capped tick left un-fetched, so
     * future ticks cannot filter them out as already-known and lose them.
     */
    forwardPendingNewest?: Date;
    /** Total rows written to ClickHouse for this account. */
    rowsIngested: number;
    /** When any tick (backfill or forward sync) last touched this account; drives backfill round-robin ordering. */
    lastRunAt?: Date;
    /**
     * When forward sync last refreshed this completed account. Set alongside
     * `lastRunAt` by the forward pass and drives the forward round-robin (stalest
     * first), so a never-refreshed completed account — `lastForwardRunAt` absent —
     * sorts ahead of one refreshed recently. Surfaced to the admin as a distinct
     * "last refresh" fact separate from the original backfill advance.
     */
    lastForwardRunAt?: Date;
    /** Message from the most recent failed tick; cleared on the next success. */
    lastError?: string;
    /**
     * UTC `YYYY-MM-DD` of the most recent balance snapshot captured for this
     * account. Drives the snapshot tick's "not yet snapshotted today" selection so
     * the bounded sampler advances round-robin without re-snapshotting an account
     * twice in a day. Absent until the first snapshot.
     */
    lastSnapshotDay?: string;
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
    /** Which TronGrid endpoint produced this row (`'tx'` or `'trc20'`); part of the dedup key. */
    source: AccountTxSource;
    /** Including block height (0 when the source endpoint omits it, e.g. trc20). */
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
    /** Raw TRC20 token amount as an integer string (decimals unapplied); null for non-token rows. */
    token_amount: string | null;
    /** TRC20 token symbol from the transfer's token_info; null for non-token rows. */
    token_symbol: string | null;
    /** TRC20 token decimals from the transfer's token_info; null for non-token rows. */
    token_decimals: number | null;
    /** Decoded UTF-8 memo from `raw_data.data`; null when none. */
    memo: string | null;
    /** Ingestion time; the ReplacingMergeTree version column. */
    ingested_at: string;
}

/**
 * One row of the ClickHouse `account_value_transfers` table — a flat projection of
 * a source-independent `IValueTransfer` plus the per-account key and the
 * ReplacingMergeTree version column. One row per discrete value leg; the natural
 * key `(account, timestamp, tx_id, origin, leg_key, asset_id)` keeps legs that
 * share a parent transaction distinct. `amount_raw` is an integer string (sun for
 * TRX, base units for tokens) because token amounts exceed 64-bit range.
 */
export interface IAccountValueTransferRow extends Record<string, unknown> {
    /** Tracked account this leg was ingested for; part of the dedup key. */
    account: string;
    /** Parent transaction hash. */
    tx_id: string;
    /** Where the leg originated: `native`, `internal`, or `token_event`. */
    origin: string;
    /** Leg identity within its parent: internal-transaction hash, or empty for native/token legs. */
    leg_key: string;
    /** Asset class: `TRX`, `TRC10`, `TRC20`, or `TRC721`. */
    asset_type: string;
    /** Asset identity: empty for TRX, the TRC10 tokenId, or the TRC20/721 contract address. */
    asset_id: string;
    /** Base58 sender. */
    from_address: string;
    /** Base58 recipient. */
    to_address: string;
    /** Raw amount as an integer string — sun for TRX, base units for tokens. */
    amount_raw: string;
    /** Token decimals when known; null otherwise. */
    asset_decimals: number | null;
    /** Including block height; 0 when the source omits it. */
    block_number: number;
    /** Block execution time as a ClickHouse datetime string. */
    timestamp: string;
    /** Ingestion time; the ReplacingMergeTree version column. */
    ingested_at: string;
}

/**
 * One row of the ClickHouse `account_balance_snapshots` table — the scalar TRX,
 * staking, and resource state captured per account per day. One row per
 * `(account, day)`; the ReplacingMergeTree version column lets a re-sample on the
 * same day overwrite in place.
 */
export interface IBalanceSnapshotRow extends Record<string, unknown> {
    /** Tracked account; part of the dedup key. */
    account: string;
    /** UTC calendar day, `YYYY-MM-DD`; part of the dedup key and partition. */
    day: string;
    /** Capture instant as a ClickHouse datetime string. */
    captured_at: string;
    /** Liquid TRX balance, in sun. */
    trx_balance_sun: number;
    /** TRX staked for energy, in sun. */
    staked_energy_sun: number;
    /** TRX staked for bandwidth, in sun. */
    staked_bandwidth_sun: number;
    /** TRX in the unstaking queue, in sun. */
    unstaking_sun: number;
    /** Energy limit from staking. */
    energy_limit: number;
    /** Energy used in the current window. */
    energy_used: number;
    /** Bandwidth (net) limit from staking. */
    net_limit: number;
    /** Bandwidth used in the current window. */
    net_used: number;
    /** Ingestion time; the ReplacingMergeTree version column. */
    ingested_at: string;
}

/**
 * One row of the ClickHouse `account_token_balances` table — a single token's raw
 * balance for one account on one snapshot day. Split from the scalar snapshot so
 * token holdings join cleanly to the price series without a Map column.
 */
export interface ITokenBalanceRow extends Record<string, unknown> {
    /** Tracked account; part of the dedup key. */
    account: string;
    /** UTC calendar day, `YYYY-MM-DD`; part of the dedup key and partition. */
    day: string;
    /** TRC20 contract base58 address; part of the dedup key. */
    asset: string;
    /** Raw token balance as an integer string (decimals unapplied). */
    raw_balance: string;
    /** Ingestion time; the ReplacingMergeTree version column. */
    ingested_at: string;
}

/**
 * Normalized account state the provider returns from a single on-chain probe —
 * the source-independent shape the service projects into snapshot rows, so the
 * service never parses raw TronGrid envelopes. Sun fields are TRX in sun.
 */
export interface IAccountSnapshotSample {
    /** Liquid TRX balance, in sun. */
    trxBalanceSun: number;
    /** TRX staked for energy, in sun. */
    stakedEnergySun: number;
    /** TRX staked for bandwidth, in sun. */
    stakedBandwidthSun: number;
    /** TRX in the unstaking queue, in sun. */
    unstakingSun: number;
    /** Energy limit from staking. */
    energyLimit: number;
    /** Energy used in the current window. */
    energyUsed: number;
    /** Bandwidth (net) limit from staking. */
    netLimit: number;
    /** Bandwidth used in the current window. */
    netUsed: number;
    /** Per-token raw balances `{ contractAddress: rawBalanceString }`. */
    tokenBalances: Array<{ asset: string; rawBalance: string }>;
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

/**
 * Minimal shape of a TronGrid TRC20 transfer item the provider reads from the
 * `/v1/accounts/{addr}/transactions/trc20` endpoint. This endpoint indexes by
 * token-transfer participant, so it returns transfers the account *received*
 * (which the native `/transactions` endpoint omits, since the recipient is only
 * inside the contract call data). Fields are optional because TronGrid omits
 * unknowns; the decoded `value` carries the raw token amount.
 */
export interface ITronGridTrc20Tx {
    /** Hash of the transaction carrying the transfer. */
    transaction_id?: string;
    /** Block time in epoch milliseconds. */
    block_timestamp?: number;
    /** Base58 sender of the token transfer. */
    from?: string;
    /** Base58 recipient of the token transfer. */
    to?: string;
    /** Raw token amount as an integer string (decimals unapplied). */
    value?: string;
    /** Event type, e.g. `'Transfer'` / `'Approval'`. */
    type?: string;
    /** Token contract metadata. */
    token_info?: {
        /** Base58 token contract address. */
        address?: string;
        /** Token symbol, e.g. `USDT`. */
        symbol?: string;
        /** Token decimals. */
        decimals?: number;
    };
}

/**
 * Minimal shape of a TronGrid internal-transaction item from the
 * `/v1/accounts/{addr}/internal-transactions` endpoint. Internal transfers are the
 * TRX/TRC10 moves a contract performs mid-execution, invisible to the two
 * transaction endpoints. Addresses arrive hex-encoded (not base58). `call_value`
 * is an asset map: the key `'_'` is TRX, any other key is a TRC10 tokenId; the
 * value is the raw amount (sun for TRX). Fields are optional because TronGrid omits
 * unknowns.
 */
export interface ITronGridInternalTx {
    /** Protocol internal-transaction hash — identical to the node's `TransactionInfo` hash. */
    internal_tx_id?: string;
    /** Parent transaction hash. */
    tx_id?: string;
    /** Block time in epoch milliseconds. */
    block_timestamp?: number;
    /** Hex-encoded sender (the contract or account that sent value). */
    from_address?: string;
    /** Hex-encoded recipient. */
    to_address?: string;
    /** Execution detail: `note` (call/create/suicide), `rejected`, and the `call_value` asset map. */
    data?: {
        /** Opcode note: `call`, `create`, or `suicide`. */
        note?: string;
        /** True when the internal transfer failed and moved no value. */
        rejected?: boolean;
        /** Asset → raw amount map; key `'_'` is TRX (sun), other keys are TRC10 tokenIds. */
        call_value?: Record<string, number | string>;
    };
}
