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
    /** Newest block time observed on the first page; the leading edge of history. */
    newestTimestampSeen?: Date;
    /** Total rows written to ClickHouse for this account so far. */
    rowsIngested: number;
    /** When the ingestion tick last touched this account. */
    lastRunAt?: Date;
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
 * A page of an account's stored transactions.
 */
export interface IAccountTransactionPage {
    /** Source-independent transaction projections, newest first. */
    transactions: IBlockTransaction[];
    /** Total rows stored for the account, for pagination math. */
    total: number;
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
     * Read a page of an account's stored history from ClickHouse.
     *
     * @param query - Address and pagination window.
     * @returns A page of source-independent transactions plus the total count.
     */
    getTransactions(query: IAccountTransactionQuery): Promise<IAccountTransactionPage>;

    /**
     * Advance ingestion by one bounded slice: pick the least-recently-advanced
     * unpaused accounts (up to `accountsPerTick`), pull up to `pagesPerTick`
     * pages each, write rows, and persist the advanced cursors. Invoked by the
     * scheduler job; also callable for a manual operator-triggered run. A no-op
     * when `ingestionEnabled` is false or no provider is available.
     */
    runIngestionTick(): Promise<void>;
}
