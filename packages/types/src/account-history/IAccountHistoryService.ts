/**
 * @fileoverview Published contract for the account-history module.
 *
 * The account-history module ingests the full transaction history of explicitly
 * tracked TRON accounts into ClickHouse, pull-based and independent of the
 * forward block-sync pipeline. This file is the single cross-component surface:
 * the module publishes `IAccountHistoryService` on the service registry under
 * `'account-history'`, so other modules (constructor DI) and plugins (registry
 * `get`/`watch`) reach tracked accounts, ingestion control, and history reads
 * without touching the module's collections or ClickHouse table directly.
 *
 * Reads return `IBlockTransaction` — the source-independent domain contract —
 * so consumers never couple to the persistence row shape or to TronGrid.
 */

import type { IBlockTransaction } from '../blockchain/IBlockTransaction.js';
import type { IValueTransfer, ValueTransferOrigin } from '../blockchain/IValueTransfer.js';

/**
 * Lifecycle state of one account's backfill.
 *
 * Typed as a closed union because these are the states the admin surface and
 * the scheduler tick branch on; a new state would be a deliberate contract
 * change, not silent drift.
 */
export type AccountIngestionStatus = 'queued' | 'running' | 'paused' | 'complete' | 'failed';

/**
 * An account the operator has asked the platform to track.
 *
 * Identity is the base58 address; `paused` is the per-account operational brake
 * that stops this account's backfill without affecting the others. Tracking is
 * admin-managed because the module is always-on (a core module cannot be
 * toggled off), so the tracked set is the real control surface.
 */
export interface ITrackedAccount {
    /** Base58 TRON address. Stable identity across restarts and the cursor key. */
    address: string;
    /** Optional human label for the admin list; has no effect on ingestion. */
    label?: string;
    /** When true the ingestion tick skips this account, leaving its cursor intact. */
    paused: boolean;
    /** When the account was first added to the tracked set. */
    addedAt: Date;
    /** Last time the tracked-account record itself was modified. */
    updatedAt: Date;
}

/**
 * Resumable backfill progress for one account.
 *
 * The cursor is TronGrid's opaque `fingerprint`; the timestamps describe how far
 * back the walk has reached. There is no percentage — fingerprint paging never
 * reveals an account's total transaction count up front, so progress is
 * expressed as absolute counts plus the oldest point reached, never a fraction.
 */
export interface IAccountIngestionProgress {
    /** Base58 address this progress record belongs to. */
    address: string;
    /** Current lifecycle state of the backfill. */
    status: AccountIngestionStatus;
    /**
     * Opaque TronGrid fingerprint for the next page to fetch. Absent before the
     * first tick and once the walk is complete (no more pages).
     */
    cursorFingerprint?: string;
    /** Oldest block time reached walking history backward; advances each tick. */
    oldestTimestampReached?: Date;
    /**
     * Freshness watermark: the newest block time the account is known current to.
     * Seeded by the backfill's first page and advanced by forward sync as new
     * transactions land, so it answers "how up to date is this account?" — the
     * single most useful signal for a `complete` account.
     */
    newestTimestampSeen?: Date;
    /** Total rows written to ClickHouse for this account so far. */
    rowsIngested: number;
    /** When the ingestion tick (backfill or forward sync) last touched this account. */
    lastRunAt?: Date;
    /**
     * When forward sync last refreshed this `complete` account, distinct from
     * {@link lastRunAt} so the admin can tell a forward refresh from the original
     * backfill advance. Absent until the first forward sync runs.
     */
    lastForwardRunAt?: Date;
    /**
     * True when a `complete` account is mid-drain — forward sync hit the per-tick
     * page cap on a backlog larger than one tick and is catching up across ticks.
     * Derived from the presence of a forward continuation cursor; the raw cursor
     * fingerprints are never exposed. Lets the admin distinguish "complete and
     * current" from "complete but still catching up".
     */
    catchingUp?: boolean;
    /**
     * UTC `YYYY-MM-DD` of the most recent balance snapshot captured for this
     * account, or absent when never snapshotted. Surfaces the otherwise-invisible
     * `account-history:snapshot` sampler so a stalled snapshot job is legible per
     * account on the admin page.
     */
    lastSnapshotDay?: string;
    /** Message from the most recent failed tick, cleared on the next success. */
    lastError?: string;
}

/**
 * Operator-tunable pacing for the ingestion job.
 *
 * These dials throttle ingestion *down* — they cannot exceed the shared TronGrid
 * rate limiter that protects live block sync. `ingestionEnabled` is the
 * module-level brake that makes the scheduler tick a no-op without unregistering
 * the job; the cron cadence itself is owned by the scheduler, not these settings.
 */
export interface IAccountHistorySettings {
    /** Master switch; when false the ingestion tick returns immediately. */
    ingestionEnabled: boolean;
    /** TronGrid pages pulled per account per tick — the primary speed/load dial. */
    pagesPerTick: number;
    /** How many tracked accounts advance per tick (round-robin, least-recent first). */
    accountsPerTick: number;
}

/**
 * One row of the admin stats table: a tracked account paired with its progress.
 */
export interface IAccountHistoryAccountStats {
    /** The tracked-account record. */
    account: ITrackedAccount;
    /** Its current backfill progress, or a zeroed record if ingestion never ran. */
    progress: IAccountIngestionProgress;
}

/**
 * Full snapshot powering the admin page and the live-stats WebSocket payload.
 */
export interface IAccountHistoryStats {
    /** Current pacing settings. */
    settings: IAccountHistorySettings;
    /** Per-account progress rows. */
    accounts: IAccountHistoryAccountStats[];
    /** Module-level rollups for the dashboard header. */
    totals: {
        /** Number of accounts in the tracked set. */
        trackedAccounts: number;
        /** Total rows ingested across all accounts. */
        rowsIngested: number;
        /** Accounts whose backfill has reached the end of available history. */
        completeAccounts: number;
        /** Accounts whose last tick failed. */
        failedAccounts: number;
        /**
         * Completed accounts currently mid-drain in forward sync (catching up on a
         * backlog larger than one tick). A non-zero value tells the operator the
         * forward pass is behind and may warrant a higher page cap or cadence.
         */
        catchingUpAccounts: number;
        /**
         * The stalest freshness watermark across completed accounts — the minimum
         * {@link IAccountIngestionProgress.newestTimestampSeen}. Every completed
         * account is current at least to this point, so it is the fleet-wide
         * freshness floor for the header. Absent when no account is complete.
         */
        oldestNewestTimestamp?: Date;
        /**
         * Tracked accounts whose {@link IAccountIngestionProgress.lastSnapshotDay}
         * is the current UTC day — the "accounts snapshotted today" rollup that
         * makes a stalled balance-snapshot sampler visible at a glance.
         */
        snapshottedTodayAccounts: number;
    };
}

/**
 * Input for adding an account to the tracked set.
 */
export interface IAddTrackedAccountInput {
    /** Base58 TRON address to begin tracking. */
    address: string;
    /** Optional human label for the admin list. */
    label?: string;
}

/**
 * Parameters for a paged read of an account's stored history.
 */
export interface IAccountTransactionQuery {
    /** Base58 address whose history to read. */
    address: string;
    /** Page size; the service clamps to a sane maximum. */
    limit?: number;
    /** Row offset for pagination. */
    offset?: number;
}

/**
 * A watermark identifying one value leg's position in `account_value_transfers`'
 * physical sort order (`timestamp, tx_id, origin, leg_key, asset_id`, all
 * descending). Every field is a leg-identity fact `IValueTransfer` already
 * exposes, so a caller builds the next cursor directly from the last leg of the
 * previous page — no opaque token round-trips through the service.
 *
 * A plain `offset` cannot page this table safely: forward-sync inserts new legs
 * concurrently, and a coarse `timestamp` alone is not unique (one transaction can
 * emit several legs sharing it), so an offset window shifts and reshuffles
 * mid-scan — silently duplicating or skipping legs. Comparing the full tuple
 * against a keyset watermark is stable regardless of concurrent inserts.
 */
export interface IValueTransferCursor {
    /** Block execution time of the last-seen leg. */
    timestamp: Date;
    /** Parent transaction hash of the last-seen leg. */
    txId: string;
    /** Leg origin of the last-seen leg. */
    origin: ValueTransferOrigin;
    /** Leg-identity key of the last-seen leg (see {@link IValueTransfer.legKey}). */
    legKey: string;
    /** Asset identity of the last-seen leg. */
    assetId: string;
}

/**
 * Parameters for a paged, keyset-stable read of an account's value-transfer
 * ledger. Distinct from {@link IAccountTransactionQuery} because
 * `account_value_transfers` and `account_transactions` sort on different tuples —
 * an `offset` valid for one table means nothing for the other.
 */
export interface IValueTransferQuery {
    /** Base58 address whose ledger to read. */
    address: string;
    /** Page size; the service clamps to a sane maximum. */
    limit?: number;
    /**
     * Watermark from the last leg of the previous page, or omitted to start from
     * the newest leg.
     */
    cursor?: IValueTransferCursor;
}

/**
 * A page of an account's stored transactions.
 */
export interface IAccountTransactionPage {
    /** Source-independent transaction projections, newest first. */
    transactions: IBlockTransaction[];
    /** Total rows stored for the account, for pagination math. */
    total: number;
}

/**
 * One UTC day's transaction count, the unit a calendar/contributions heatmap
 * renders one cell per. The day is a bare `YYYY-MM-DD` (UTC) so the frontend
 * grids it without re-deriving a timezone-dependent boundary; the count drives
 * the cell's colour intensity.
 */
export interface IActivityCalendarBucket {
    /** UTC calendar day, `YYYY-MM-DD`. */
    day: string;
    /** Deduped transaction count on that day. */
    count: number;
}

/**
 * "Wallet story" rollups — the timestamp-only summary that gives a wallet a
 * personality at a glance (how old, how busy, how consistently used). Cheap to
 * compute and the most engaging payoff to reveal the moment a backfill completes.
 */
export interface IWalletActivityStats {
    /** Total deduped transactions across all stored history. */
    totalTransactions: number;
    /** Block time of the oldest stored transaction; null when the wallet has none. */
    firstActivityAt: Date | null;
    /** Block time of the newest stored transaction; null when the wallet has none. */
    lastActivityAt: Date | null;
    /** Distinct UTC days with at least one transaction, across all history. */
    activeDays: number;
    /** Longest run of consecutive active UTC days, across all history. */
    longestStreakDays: number;
}

/**
 * TRON resource totals — the chain-native angle no EVM portfolio tracker can
 * show, because only TRON meters energy and bandwidth per transaction. Sums
 * across all stored history; resource units are counts, the `*Sun` fields are
 * burned TRX in sun.
 */
export interface IWalletResourceTotals {
    /** Total energy units consumed across all transactions. */
    energyConsumed: number;
    /** Total bandwidth units consumed across all transactions. */
    bandwidthConsumed: number;
    /** Total TRX burned across all fees, in sun. */
    feeSun: number;
    /** TRX burned specifically for energy, in sun. */
    energyFeeSun: number;
    /** TRX burned specifically for bandwidth, in sun. */
    bandwidthFeeSun: number;
}

/**
 * One month's inflow vs outflow for a single wallet, split by denomination.
 *
 * Denominations stay on separate fields rather than summed into one number
 * because the module stores no USD valuation — TRX (`amount_sun`) and a token's
 * raw amount have no common axis, so the frontend renders/totals each
 * independently. Values are smallest-unit integers carried as numbers: sun for
 * TRX, the raw 6-dp integer for USDT (the frontend divides by 1e6 for display).
 * Large whale totals can exceed Float64's exact-integer range; this is a display
 * aggregate, not an accounting ledger, so minor rounding at the extreme is
 * acceptable.
 */
export interface IWalletFlowBucket {
    /** Month start as `YYYY-MM-DD` (first of the month, UTC). */
    period: string;
    /** TRX received this month (to_address = wallet), in sun. */
    trxInSun: number;
    /** TRX sent this month (from_address = wallet), in sun. */
    trxOutSun: number;
    /** USDT received this month (to_address = wallet), raw 6-dp integer. */
    usdtInRaw: number;
    /** USDT sent this month (from_address = wallet), raw 6-dp integer. */
    usdtOutRaw: number;
}

/**
 * One counterparty the wallet transacted with, aggregated across all history.
 *
 * The consumer-friendly alternative to a force-directed address graph: a ranked
 * table answers "who does this wallet deal with most" at a fraction of the build
 * and render cost. The counterparty is the other side of each row — `to_address`
 * when the wallet sent, `from_address` when it received.
 */
export interface IWalletCounterparty {
    /** Base58 address of the counterparty. */
    address: string;
    /** Total deduped transactions exchanged with this counterparty. */
    txCount: number;
    /** Transactions where the wallet sent to this counterparty. */
    sentToCount: number;
    /** Transactions where this counterparty sent to the wallet. */
    receivedFromCount: number;
    /** TRX sent to this counterparty, in sun. */
    trxSentSun: number;
    /** TRX received from this counterparty, in sun. */
    trxReceivedSun: number;
}

/**
 * The batched activity/behaviour summary for one wallet — every panel of the
 * user-facing wallet-detail view in a single read, so expanding a wallet costs
 * one round-trip instead of one per panel. Every field is derived purely from
 * the stored transaction ledger (no balances, no USD); the valuation surface is
 * a separate, additive concern (see {@link IWalletValuationSummary}).
 */
export interface IWalletActivitySummary {
    /** The wallet this summary describes. */
    address: string;
    /** Per-day transaction counts for the activity heatmap (recent window). */
    calendar: IActivityCalendarBucket[];
    /** All-time "wallet story" rollups. */
    stats: IWalletActivityStats;
    /** All-time TRON energy/bandwidth/fee totals. */
    resources: IWalletResourceTotals;
    /** Per-month inflow/outflow, split by denomination, oldest first. */
    flow: IWalletFlowBucket[];
    /** Top counterparties by transaction count, most-frequent first. */
    counterparties: IWalletCounterparty[];
}

/**
 * Reserved seam for the valuation/portfolio surface — **not implemented**.
 *
 * The activity surface ({@link IWalletActivitySummary}) is buildable from the
 * stored ledger alone. A portfolio value, PnL, and balance-over-time chart are
 * deliberately deferred because they need a data layer the module does not have:
 * live per-token balances, historical balance snapshots, a USD price source
 * (current and historical), and FIFO cost-basis tracking. This interface sketches
 * the eventual contract so the frontend can reserve its hero slot; populating it
 * is a separate project, gated on standing up that data layer.
 */
export interface IWalletValuationSummary {
    /** The wallet this valuation describes. */
    address: string;
    /** Total current portfolio value in USD. Requires balances + a price source. */
    totalValueUsd?: number;
    /** Realized + unrealized PnL in USD. Requires cost-basis tracking. */
    pnlUsd?: number;
    /** Balance-over-time series in USD, one point per period. Requires snapshots. */
    balanceSeries?: Array<{ at: Date; valueUsd: number }>;
}

/**
 * One token balance in a point-in-time account snapshot.
 */
export interface IAccountTokenBalance {
    /** TRC20 contract base58 address — the {@link PriceAsset} key for valuation. */
    asset: string;
    /** Raw on-chain balance as an integer string (decimals unapplied). */
    rawBalance: string;
}

/**
 * A scheduled point-in-time snapshot of an account's on-chain holdings and TRON
 * resource state.
 *
 * Why it exists: the transaction ledger alone cannot reconstruct a correct
 * absolute balance — TronGrid fingerprint paging cannot always reach an account's
 * genesis, so a cumulative inflow−outflow walk would be offset by an unknown
 * prefix, and staking/unstaking move TRX out of the liquid balance in ways a
 * naive sum misreads. A snapshot is the absolute-truth anchor the valuation
 * engine pins its ledger-derived series to, and the only source of the
 * staked/unstaking/resource figures net worth needs. Captured on a schedule,
 * never on a page load. All `*Sun` fields are TRX in sun.
 */
export interface IAccountBalanceSnapshot {
    /** Base58 account the snapshot describes. */
    address: string;
    /** When the snapshot was captured. */
    capturedAt: Date;
    /** Liquid (spendable) TRX balance, in sun. */
    trxBalanceSun: number;
    /** TRX staked for energy (FreezeBalanceV2), in sun. */
    stakedEnergySun: number;
    /** TRX staked for bandwidth (FreezeBalanceV2), in sun. */
    stakedBandwidthSun: number;
    /** TRX in the unstaking queue (pending unfreeze), in sun. */
    unstakingSun: number;
    /** Account's energy limit from staking. */
    energyLimit: number;
    /** Energy used in the current window. */
    energyUsed: number;
    /** Account's bandwidth (net) limit from staking. */
    netLimit: number;
    /** Bandwidth used in the current window. */
    netUsed: number;
    /**
     * Unclaimed (withdrawable) staking/vote rewards, in sun. Part of the
     * account's real net worth even before a `WithdrawBalanceContract` claim
     * moves it into the liquid balance; sampled via the provider's reward probe.
     * Zero for accounts that never voted and on snapshots captured before the
     * probe shipped.
     */
    withdrawableRewardSun: number;
    /** Per-token raw balances at capture; empty on series reads (latest-only). */
    tokenBalances: IAccountTokenBalance[];
}

/**
 * Real symbol/decimals for one TRC20 contract, learned from the decoded token
 * transfers the ingest walk stored (`token_info` on the trc20 endpoint). The
 * authoritative alternative to a hard-coded decimals default: unusual-decimal
 * tokens value correctly only when consumers key on these observed values.
 */
export interface ITokenMetadata {
    /** TRC20 contract base58 address. */
    asset: string;
    /** Token symbol as the chain metadata reported it, or null when never seen. */
    symbol: string | null;
    /** Token decimals as the chain metadata reported them, or null when never seen. */
    decimals: number | null;
}

/**
 * The central service every account-history surface routes through.
 *
 * All access — admin controllers, the scheduler tick, and external consumers —
 * goes through this interface; the ClickHouse table and the Mongo tracked-account
 * and progress collections are reached only here. Published on the service
 * registry as `'account-history'`.
 */
export interface IAccountHistoryService {
    /**
     * Begin tracking an account. Idempotent on address: re-adding an existing
     * account updates its label rather than duplicating it.
     *
     * @param input - Address (and optional label) to track.
     * @returns The tracked-account record, new or updated.
     */
    addTrackedAccount(input: IAddTrackedAccountInput): Promise<ITrackedAccount>;

    /**
     * Stop tracking an account and discard its progress cursor. Stored
     * transactions in ClickHouse are retained — removal stops future ingestion,
     * it does not purge history.
     *
     * @param address - Base58 address to stop tracking.
     */
    removeTrackedAccount(address: string): Promise<void>;

    /**
     * Pause or resume a single account's backfill without removing it. A paused
     * account keeps its cursor so it resumes exactly where it left off.
     *
     * @param address - Base58 address to toggle.
     * @param paused - True to pause, false to resume.
     * @returns The updated tracked-account record.
     */
    setAccountPaused(address: string, paused: boolean): Promise<ITrackedAccount>;

    /**
     * List the tracked set for the admin surface.
     *
     * @returns All tracked accounts, oldest first.
     */
    listTrackedAccounts(): Promise<ITrackedAccount[]>;

    /**
     * Read current pacing settings.
     *
     * @returns The effective settings, seeded with defaults on first read.
     */
    getSettings(): Promise<IAccountHistorySettings>;

    /**
     * Update pacing settings. Only supplied fields change.
     *
     * @param patch - Partial settings to merge.
     * @returns The settings after the merge.
     */
    updateSettings(patch: Partial<IAccountHistorySettings>): Promise<IAccountHistorySettings>;

    /**
     * Build the full stats snapshot for the admin page and live broadcasts.
     *
     * @returns Settings, per-account progress, and rollups.
     */
    getStats(): Promise<IAccountHistoryStats>;

    /**
     * Read backfill progress for a specific set of addresses. Powers ownership-
     * scoped surfaces — e.g. a user's profile showing the download status of
     * only the wallets they verified — without exposing the whole tracked set
     * behind the admin stats endpoint. Only addresses with a progress record
     * (i.e. currently tracked) are returned; untracked addresses are omitted
     * rather than reported as a zeroed record, so a caller can distinguish
     * "enrolled and queued" from "not enrolled".
     *
     * @param addresses - Base58 addresses to look up; malformed entries are ignored.
     * @returns Progress for the tracked subset of the requested addresses.
     */
    getProgressFor(addresses: string[]): Promise<IAccountIngestionProgress[]>;

    /**
     * Read a page of an account's stored history from ClickHouse.
     *
     * @param query - Address and pagination window.
     * @returns A page of source-independent transactions plus the total count.
     */
    getTransactions(query: IAccountTransactionQuery): Promise<IAccountTransactionPage>;

    /**
     * Read a page of an account's value-transfer ledger from ClickHouse, newest
     * first. Unlike {@link getTransactions} — which returns top-level transactions
     * from `account_transactions` — this returns the discrete on-chain value legs
     * (native TRX, TVM-internal, and TRC20/721 token) recorded in
     * `account_value_transfers`, one per movement. This is the read valuation and
     * the money-in/out chart consume: a contract's TRX deposit is a first-class
     * `internal` leg here, invisible in the transaction view, so summing value no
     * longer pattern-matches contract types.
     *
     * Authorization is the caller's responsibility — the service trusts the
     * address it is given. Returns an empty array when ClickHouse is not
     * configured.
     *
     * Paged by a keyset {@link IValueTransferQuery.cursor}, not `offset` — see
     * {@link IValueTransferCursor} for why an offset cannot page this table safely
     * under concurrent forward-sync inserts.
     *
     * @param query - Address, page size, and the previous page's cursor.
     * @returns A page of source-independent value legs, newest first.
     */
    getValueTransfers(query: IValueTransferQuery): Promise<IValueTransfer[]>;

    /**
     * Read specific value legs for one account by parent transaction hash, newest
     * first — the by-hash companion to {@link getValueTransfers}. Keyed by an
     * explicit `txIds` set rather than a pagination window so the valuation engine
     * can refetch the legs of an internal transfer whose two sides straddle a
     * per-wallet window boundary and complete the pair. Authorization is the
     * caller's responsibility.
     *
     * @param address - Base58 address whose legs to read.
     * @param txIds - Parent transaction hashes to fetch; the service clamps the count.
     * @returns The matching value legs, newest first.
     */
    getValueTransfersByTxIds(address: string, txIds: string[]): Promise<IValueTransfer[]>;

    /**
     * Build the batched activity/behaviour summary for one account — the calendar
     * heatmap buckets, the "wallet story" stats, the TRON resource totals, the
     * per-month inflow/outflow, and the top counterparties — in a single call so
     * the user-facing wallet-detail view costs one round-trip. Derived entirely
     * from the stored ledger; returns an empty/zeroed summary when ClickHouse is
     * not configured. Authorization is the caller's responsibility — the service
     * trusts the address it is given, so a user-facing caller must confirm the
     * caller owns the wallet first.
     *
     * @param address - Base58 address to summarize.
     * @returns The activity summary for the address.
     */
    getWalletSummary(address: string): Promise<IWalletActivitySummary>;

    /**
     * Read the most recent on-chain balance/resource snapshot for an account,
     * including per-token balances. Returns null when none has been captured yet.
     * Backs current-holdings valuation and anchors the balance-over-time series.
     *
     * @param address - Base58 address.
     * @returns The latest snapshot, or null.
     */
    getLatestSnapshot(address: string): Promise<IAccountBalanceSnapshot | null>;

    /**
     * Read the snapshot series for an account over a UTC day range, oldest first.
     * Token balances are omitted here (use {@link getLatestSnapshot} for the
     * current breakdown); the series carries the scalar TRX/resource anchors that
     * calibrate balance-over-time.
     *
     * @param address - Base58 address.
     * @param fromDay - Inclusive start UTC `YYYY-MM-DD`.
     * @param toDay - Inclusive end UTC `YYYY-MM-DD`.
     * @returns Snapshots in range, oldest first.
     */
    getSnapshotSeries(address: string, fromDay: string, toDay: string): Promise<IAccountBalanceSnapshot[]>;

    /**
     * Capture one bounded slice of balance snapshots: pick tracked, unpaused
     * accounts not yet snapshotted today (up to `accountsPerTick`), fetch each
     * account's on-chain state through the provider, and write a snapshot row.
     * Scheduler-driven; never runs on a page load.
     */
    runSnapshotTick(): Promise<void>;

    /**
     * Resolve real symbol/decimals for a set of TRC20 contracts from the stored
     * decoded transfers (`token_symbol` / `token_decimals` on trc20-source rows).
     * Local-only — never a network call. Contracts the ingest never saw a decoded
     * transfer for are omitted, so a caller falls back to its own default only
     * for genuinely unknown tokens.
     *
     * @param assets - TRC20 contract addresses to resolve; malformed entries ignored.
     * @returns Metadata for the known subset of the requested contracts.
     */
    getTokenMetadata(assets: string[]): Promise<ITokenMetadata[]>;

    /**
     * List the distinct TRC20 contract addresses held in any stored balance
     * snapshot. Powers cross-module diagnostics — joining held tokens against the
     * price series surfaces which holdings lack a price source. Returns [] when
     * ClickHouse is absent.
     *
     * @returns Distinct held token contract addresses.
     */
    getHeldTokenAssets(): Promise<string[]>;

    /**
     * Advance ingestion by one bounded slice: pick the least-recently-advanced
     * unpaused accounts (up to `accountsPerTick`), pull up to `pagesPerTick`
     * pages each, write rows, and persist the advanced cursors. Invoked by the
     * scheduler job; also callable for a manual operator-triggered run. A no-op
     * when `ingestionEnabled` is false or no provider is available.
     */
    runIngestionTick(): Promise<void>;

    /**
     * Refresh already-`complete` accounts with transactions that arrived after
     * their backfill finished. The backward backfill excludes `complete` accounts
     * forever, so this is the only path that keeps a finished account current: it
     * re-polls each completed account's leading edge (newest pages, both
     * endpoints) for rows newer than the recorded watermark and appends them,
     * leaving the account `complete`. Invoked by its own scheduler job; also
     * callable for a manual run. A no-op when `ingestionEnabled` is false or no
     * provider is available.
     */
    runForwardSyncTick(): Promise<void>;
}
