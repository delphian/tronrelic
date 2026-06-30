/**
 * @fileoverview AccountHistoryService — the single authority for account history.
 *
 * Every surface (admin controllers, the scheduler tick, registry consumers)
 * routes through this singleton; the ClickHouse table and the Mongo control
 * collections are reached only here. It owns the tracked set, the resumable
 * per-account cursors, the pacing settings, the ingestion loop, and the
 * ClickHouse reads — and it degrades to a no-op when ClickHouse or a provider
 * is absent, so an always-on core module never crashes a ClickHouse-less deploy.
 *
 * Ingestion is deliberately bounded per tick (pages-per-tick × accounts-per-tick)
 * and advances the least-recently-touched accounts first, so a million-row
 * backfill spreads over many ticks without a long-lived process and resumes
 * exactly where it left off after a restart.
 */

import type {
    IAccountHistoryService,
    IAccountHistorySettings,
    IAccountHistoryStats,
    IAccountHistoryAccountStats,
    IAccountIngestionProgress,
    IAccountTransactionPage,
    IAccountTransactionQuery,
    IActivityCalendarBucket,
    IWalletActivityStats,
    IWalletActivitySummary,
    IWalletCounterparty,
    IWalletFlowBucket,
    IWalletResourceTotals,
    IAddTrackedAccountInput,
    ITrackedAccount,
    IBlockTransaction,
    IValueTransfer,
    IAccountBalanceSnapshot,
    IClickHouseService,
    IDatabaseService,
    ISystemLogService,
    IWebSocketService
} from '@/types';
import {
    PROGRESS_COLLECTION,
    SETTINGS_COLLECTION,
    SETTINGS_KEY,
    TRACKED_COLLECTION,
    TRANSACTIONS_TABLE,
    VALUE_TRANSFERS_TABLE,
    BALANCE_SNAPSHOTS_TABLE,
    TOKEN_BALANCES_TABLE,
    type AccountTxSource,
    type IAccountHistorySettingsDoc,
    type IAccountProgressDoc,
    type IAccountTransactionRow,
    type IAccountValueTransferRow,
    type IBalanceSnapshotRow,
    type ITokenBalanceRow,
    type IAccountSnapshotSample,
    type ITrackedAccountDoc
} from '../database/index.js';
import type { IAccountHistoryProvider } from '../providers/IAccountHistoryProvider.js';
import { toAccountTransactionRow, toValueTransfers, toValueTransferRow } from '../providers/trongrid-account-history.provider.js';
import { formatClickHouseDateTime64Utc, parseClickHouseDateTime64Utc } from '../lib/clickhouse-datetime.js';

/** Default pacing applied on first read; gentle enough to share the TronGrid budget. */
const DEFAULT_SETTINGS: IAccountHistorySettings = {
    ingestionEnabled: true,
    pagesPerTick: 5,
    accountsPerTick: 3
};

/** Page size requested from the provider; TronGrid's per-call maximum. */
const PROVIDER_PAGE_LIMIT = 200;

/** Maximum rows a single history read returns, to protect the caller. */
const MAX_READ_LIMIT = 500;

/**
 * How many recent days the activity-calendar (heatmap) covers. One year matches
 * the GitHub-contributions convention users expect and bounds the row count the
 * grouped read scans for the heatmap; the all-time stats are computed separately.
 */
const CALENDAR_WINDOW_DAYS = 366;

/** How many counterparties the summary ranks — a leaderboard, not an exhaustive list. */
const TOP_COUNTERPARTIES = 10;

/** Milliseconds in a day, for the consecutive-day streak calculation. */
const MS_PER_DAY = 86_400_000;

/** Base58 TRON mainnet address shape: leading `T`, 34 chars total. */
const TRON_ADDRESS_PATTERN = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;

/** WebSocket event name for live ingestion stats; must have a case in WebSocketService.emit(). */
const STATS_EVENT = 'account-history:stats';

/** Upper bound on a single by-`txId` read, so a caller cannot build an unbounded `IN (...)` list. */
const MAX_TXID_READ = 2_000;

/**
 * Stored `trc20` transactions the ledger-backfill token sweep visits per account
 * per tick. Each visited transaction costs one provider events call (through the
 * shared TronGrid rate limiter), so this caps the per-account backfill burst while
 * the keyset cursor resumes the remainder on the next tick. One-time work that
 * self-quiesces once the legacy population is swept.
 */
const LEDGER_BACKFILL_TOKEN_TX_PER_TICK = 50;

/**
 * The `account_transactions` columns every source-independent read projects.
 * Shared by {@link AccountHistoryService.getTransactions} and
 * {@link AccountHistoryService.getTransactionsByTxIds} so the projection stays in
 * lockstep — a column added to one read is added to both.
 */
const TRANSACTION_SELECT_COLUMNS = `account, tx_id, source, block_number, timestamp, type, status, from_address, to_address,
            amount_sun, fee_sun, energy_consumed, energy_fee_sun, bandwidth_consumed, bandwidth_fee_sun,
            contract_address, contract_method, token_amount, token_symbol, token_decimals, memo`;

/**
 * ClickHouse predicate suppressing the native `'tx'` twin of an outbound TRC20
 * transfer when its richer decoded `'trc20'` row exists for the same `tx_id`.
 * Parameterized on `{address:String}`; shared by every read that must not
 * double-count outbound token transfers.
 */
const OUTBOUND_TRC20_DEDUPE_FILTER = `NOT (source = 'tx' AND tx_id IN (
                 SELECT tx_id FROM ${TRANSACTIONS_TABLE} WHERE account = {address:String} AND source = 'trc20'
             ))`;

/**
 * Mutable per-tick state threaded through the two endpoint walks for one account,
 * so both `'tx'` and `'trc20'` advance into a single combined progress record
 * (two cursors, two completion flags, shared counts and timestamp bounds).
 */
interface IIngestWalkState {
    /** Cursor for the native `/transactions` endpoint. */
    nativeCursor?: string;
    /** Cursor for the `/transactions/trc20` endpoint. */
    trc20Cursor?: string;
    /** Cursor for the `/internal-transactions` endpoint. */
    internalCursor?: string;
    /** Whether the native endpoint has reached the end of history. */
    nativeComplete: boolean;
    /** Whether the trc20 endpoint has reached the end of history. */
    trc20Complete: boolean;
    /** Whether the internal-transactions endpoint has reached the end of history. */
    internalComplete: boolean;
    /** Running total rows written across both endpoints. */
    rowsIngested: number;
    /** Oldest block time reached so far. */
    oldest?: Date;
    /** Newest block time seen so far. */
    newest?: Date;
}

/**
 * Dependencies injected once at bootstrap. ClickHouse and the provider are
 * nullable because a deployment may lack ClickHouse, and the provider seam may
 * be unconfigured — either way ingestion no-ops rather than throwing.
 */
export interface IAccountHistoryServiceDependencies {
    /** Core database for the control collections. */
    database: IDatabaseService;
    /** ClickHouse store for transactions; undefined disables ingestion and reads. */
    clickhouse: IClickHouseService | undefined;
    /** History data source behind the provider seam; null disables ingestion. */
    provider: IAccountHistoryProvider | null;
    /** Optional emitter for live stats; undefined silently skips broadcasts. */
    emitter: IWebSocketService | undefined;
    /** Scoped logger. */
    logger: ISystemLogService;
}

/**
 * Singleton implementation of the published `'account-history'` service.
 */
export class AccountHistoryService implements IAccountHistoryService {
    private static instance: AccountHistoryService | undefined;

    private readonly database: IDatabaseService;
    private readonly clickhouse: IClickHouseService | undefined;
    private readonly provider: IAccountHistoryProvider | null;
    private readonly emitter: IWebSocketService | undefined;
    private readonly logger: ISystemLogService;

    /** Guards against overlapping ingestion ticks (cron + manual trigger racing). */
    private ticking = false;

    /** Guards against overlapping forward-sync ticks (independent of backfill). */
    private forwardTicking = false;

    /** Guards against overlapping ledger-backfill ticks (Stage-3 ledger population). */
    private ledgerBackfillTicking = false;

    /**
     * @param deps - Injected collaborators; stored for the singleton's lifetime.
     */
    private constructor(deps: IAccountHistoryServiceDependencies) {
        this.database = deps.database;
        this.clickhouse = deps.clickhouse;
        this.provider = deps.provider;
        this.emitter = deps.emitter;
        this.logger = deps.logger;
    }

    /**
     * Configure the singleton once at bootstrap. Subsequent calls are ignored so
     * every caller shares one instance and one set of collaborators.
     *
     * @param deps - The injected dependencies.
     */
    public static setDependencies(deps: IAccountHistoryServiceDependencies): void {
        if (!AccountHistoryService.instance) {
            AccountHistoryService.instance = new AccountHistoryService(deps);
        }
    }

    /**
     * Retrieve the configured singleton.
     *
     * @returns The shared instance.
     * @throws If accessed before {@link setDependencies}.
     */
    public static getInstance(): AccountHistoryService {
        if (!AccountHistoryService.instance) {
            throw new Error('AccountHistoryService.setDependencies() must be called before getInstance()');
        }
        return AccountHistoryService.instance;
    }

    /**
     * Reset the singleton. Test-only seam so suites can reconfigure dependencies.
     */
    public static resetForTests(): void {
        AccountHistoryService.instance = undefined;
    }

    /**
     * Create the unique indexes the control collections rely on for upsert-by-
     * address. Called from module `init()`; safe to run repeatedly.
     */
    public async ensureIndexes(): Promise<void> {
        await this.database.createIndex(TRACKED_COLLECTION, { address: 1 }, { unique: true });
        await this.database.createIndex(PROGRESS_COLLECTION, { address: 1 }, { unique: true });
        await this.database.createIndex(SETTINGS_COLLECTION, { key: 1 }, { unique: true });
        // Tick-selector indexes: each scheduler tick pushes its (unpaused + dueness)
        // predicate and sort into one query on PROGRESS, so coverage rotation no
        // longer loads the whole tracked + progress set. Composite order follows the
        // ESR rule (Equality → Sort → Range) so the sort is served by an index walk,
        // never a blocking in-memory sort: `paused` is a `$ne` range and so trails the
        // sort key, while `status` (an equality for forward sync) leads it.
        // Ingest: sort lastRunAt; ranges paused ($ne) + status ($nin).
        await this.database.createIndex(PROGRESS_COLLECTION, { lastRunAt: 1, paused: 1, status: 1 });
        // Forward sync: equality status='complete'; sort lastForwardRunAt; range paused.
        await this.database.createIndex(PROGRESS_COLLECTION, { status: 1, lastForwardRunAt: 1, paused: 1 });
        // Snapshot: sort lastSnapshotDay (also the dueness range); range paused.
        await this.database.createIndex(PROGRESS_COLLECTION, { lastSnapshotDay: 1, paused: 1 });
        // Ledger backfill: equality status='complete'; sort lastLedgerBackfillRunAt;
        // range paused. The selector's `$or` over the two completion flags cannot be
        // index-served, but this prefix serves the equality + sort so the stalest
        // legacy-complete account is found without a blocking sort.
        await this.database.createIndex(PROGRESS_COLLECTION, { status: 1, lastLedgerBackfillRunAt: 1, paused: 1 });
    }

    /**
     * Begin tracking an account (idempotent on address). Re-adding updates the
     * label and ensures a queued progress record exists so the next tick picks
     * it up.
     *
     * @param input - Address and optional label.
     * @returns The tracked-account record.
     */
    public async addTrackedAccount(input: IAddTrackedAccountInput): Promise<ITrackedAccount> {
        const address = String(input.address ?? '').trim();
        if (!TRON_ADDRESS_PATTERN.test(address)) {
            throw new Error('address must be a base58 TRON address (T...)');
        }

        const now = new Date();
        const collection = this.database.getCollection<ITrackedAccountDoc>(TRACKED_COLLECTION);
        await collection.updateOne(
            { address },
            {
                $set: { label: input.label, updatedAt: now },
                $setOnInsert: { address, paused: false, addedAt: now }
            },
            { upsert: true }
        );

        await this.ensureProgress(address);
        const doc = await collection.findOne({ address });
        const tracked = AccountHistoryService.toTrackedAccount(doc!);
        return tracked;
    }

    /**
     * Stop tracking an account and discard its cursor. Stored ClickHouse rows are
     * retained — this stops future ingestion, it does not purge history.
     *
     * @param address - Base58 address to stop tracking.
     */
    public async removeTrackedAccount(address: string): Promise<void> {
        await this.database.getCollection<ITrackedAccountDoc>(TRACKED_COLLECTION).deleteOne({ address });
        await this.database.getCollection<IAccountProgressDoc>(PROGRESS_COLLECTION).deleteOne({ address });
    }

    /**
     * Pause or resume one account without removing it; the cursor is preserved so
     * a resumed account continues from where it stopped.
     *
     * @param address - Base58 address to toggle.
     * @param paused - True to pause, false to resume.
     * @returns The updated tracked-account record.
     */
    public async setAccountPaused(address: string, paused: boolean): Promise<ITrackedAccount> {
        const collection = this.database.getCollection<ITrackedAccountDoc>(TRACKED_COLLECTION);
        const result = await collection.findOneAndUpdate(
            { address },
            { $set: { paused, updatedAt: new Date() } },
            { returnDocument: 'after' }
        );
        const doc = (result && 'value' in result ? result.value : result) as ITrackedAccountDoc | null;
        if (!doc) {
            throw new Error(`account ${address} is not tracked`);
        }
        // Mirror the brake onto progress so the tick selectors filter on it directly.
        // `paused` is written unconditionally — even when the account is `complete` —
        // so a paused completed account is excluded from forward sync. `status` is
        // left untouched when `complete`: a completed backfill is never reopened (a
        // `queued` overwrite would re-walk the whole history and double-count
        // `rowsIngested`). Consolidated into one ensureProgress + one patchProgress to
        // drop the redundant status roundtrip.
        const progress = await this.ensureProgress(address);
        const update: Partial<IAccountProgressDoc> = { paused };
        if (progress.status !== 'complete') {
            update.status = paused ? 'paused' : 'queued';
        }
        await this.patchProgress(address, update);
        const tracked = AccountHistoryService.toTrackedAccount(doc);
        return tracked;
    }

    /**
     * List the tracked set for the admin surface, oldest first.
     *
     * @returns All tracked accounts.
     */
    public async listTrackedAccounts(): Promise<ITrackedAccount[]> {
        const docs = await this.database
            .getCollection<ITrackedAccountDoc>(TRACKED_COLLECTION)
            .find({})
            .sort({ addedAt: 1 })
            .toArray();
        const accounts = docs.map(AccountHistoryService.toTrackedAccount);
        return accounts;
    }

    /**
     * Read pacing settings, seeding defaults on first access.
     *
     * @returns The effective settings.
     */
    public async getSettings(): Promise<IAccountHistorySettings> {
        const doc = await this.database
            .getCollection<IAccountHistorySettingsDoc>(SETTINGS_COLLECTION)
            .findOne({ key: SETTINGS_KEY });
        const settings: IAccountHistorySettings = doc
            ? { ingestionEnabled: doc.ingestionEnabled, pagesPerTick: doc.pagesPerTick, accountsPerTick: doc.accountsPerTick }
            : { ...DEFAULT_SETTINGS };
        return settings;
    }

    /**
     * Merge a partial settings update, clamping the numeric dials to sane floors
     * so an operator cannot stall ingestion with a zero or negative value.
     *
     * @param patch - Fields to change.
     * @returns The settings after the merge.
     */
    public async updateSettings(patch: Partial<IAccountHistorySettings>): Promise<IAccountHistorySettings> {
        const current = await this.getSettings();
        const next: IAccountHistorySettings = {
            ingestionEnabled: patch.ingestionEnabled ?? current.ingestionEnabled,
            pagesPerTick: Math.max(1, Math.floor(patch.pagesPerTick ?? current.pagesPerTick)),
            accountsPerTick: Math.max(1, Math.floor(patch.accountsPerTick ?? current.accountsPerTick))
        };
        await this.database.getCollection<IAccountHistorySettingsDoc>(SETTINGS_COLLECTION).updateOne(
            { key: SETTINGS_KEY },
            { $set: { ...next, key: SETTINGS_KEY } },
            { upsert: true }
        );
        return next;
    }

    /**
     * Assemble the full stats snapshot powering the admin page and live broadcasts.
     *
     * @returns Settings, per-account progress rows, and rollups.
     */
    public async getStats(): Promise<IAccountHistoryStats> {
        const [settings, accounts, progressDocs] = await Promise.all([
            this.getSettings(),
            this.listTrackedAccounts(),
            this.database.getCollection<IAccountProgressDoc>(PROGRESS_COLLECTION).find({}).toArray()
        ]);

        const progressByAddress = new Map<string, IAccountProgressDoc>();
        for (const doc of progressDocs) {
            progressByAddress.set(doc.address, doc);
        }

        const accountStats: IAccountHistoryAccountStats[] = accounts.map((account) => ({
            account,
            progress: AccountHistoryService.toProgress(account.address, progressByAddress.get(account.address))
        }));

        // The freshness floor: the stalest leading edge among completed accounts.
        // Computed over completed accounts only — forward sync (which advances the
        // watermark) applies only to them, so an in-progress account's partial
        // watermark would understate the fleet's caught-up freshness. Undefined
        // when nothing is complete yet, so the header omits the rollup.
        const completeWatermarks = accountStats
            .filter((a) => a.progress.status === 'complete' && a.progress.newestTimestampSeen)
            .map((a) => a.progress.newestTimestampSeen!.getTime());
        const oldestNewestTimestamp = completeWatermarks.length > 0
            ? new Date(completeWatermarks.reduce((min, t) => Math.min(min, t), Infinity))
            : undefined;

        const stats: IAccountHistoryStats = {
            settings,
            accounts: accountStats,
            totals: {
                trackedAccounts: accounts.length,
                rowsIngested: accountStats.reduce((sum, a) => sum + a.progress.rowsIngested, 0),
                completeAccounts: accountStats.filter((a) => a.progress.status === 'complete').length,
                failedAccounts: accountStats.filter((a) => a.progress.status === 'failed').length,
                catchingUpAccounts: accountStats.filter((a) => a.progress.catchingUp).length,
                oldestNewestTimestamp
            }
        };
        return stats;
    }

    /**
     * Read backfill progress for a specific set of addresses. Backs ownership-
     * scoped surfaces (a user's own verified wallets) so they never reach the
     * admin-only full stats snapshot. Only addresses with a stored progress
     * record are returned — an untracked address is omitted rather than reported
     * as a zeroed record, letting the caller tell "enrolled" from "not enrolled".
     * The single `$in` query keeps the read to one round-trip regardless of how
     * many wallets the caller owns.
     *
     * @param addresses - Base58 addresses to look up; malformed/duplicate entries are dropped.
     * @returns Progress for the tracked subset of the requested addresses.
     */
    public async getProgressFor(addresses: string[]): Promise<IAccountIngestionProgress[]> {
        const normalized = Array.from(new Set(
            (addresses ?? [])
                .map((address) => String(address ?? '').trim())
                .filter((address) => TRON_ADDRESS_PATTERN.test(address))
        ));
        if (normalized.length === 0) {
            return [];
        }

        const docs = await this.database
            .getCollection<IAccountProgressDoc>(PROGRESS_COLLECTION)
            .find({ address: { $in: normalized } })
            .toArray();
        const progress = docs.map((doc) => AccountHistoryService.toProgress(doc.address, doc));
        return progress;
    }

    /**
     * Read a page of an account's stored history from ClickHouse, newest first.
     * Returns an empty page when ClickHouse is not configured.
     *
     * @param query - Address and pagination window.
     * @returns A page of source-independent transactions and the total count.
     */
    public async getTransactions(query: IAccountTransactionQuery): Promise<IAccountTransactionPage> {
        const address = String(query.address ?? '').trim();
        if (!TRON_ADDRESS_PATTERN.test(address)) {
            throw new Error('address must be a base58 TRON address (T...)');
        }
        if (!this.clickhouse) {
            return { transactions: [], total: 0 };
        }

        const limit = Math.min(Math.max(1, Math.floor(query.limit ?? 50)), MAX_READ_LIMIT);
        const offset = Math.max(0, Math.floor(query.offset ?? 0));

        // An outbound TRC20 transfer lands as both a native call row ('tx') and a
        // decoded transfer row ('trc20') with the same tx_id; the trc20 row is the
        // richer view, so suppress the native twin on read (OUTBOUND_TRC20_DEDUPE_FILTER).
        const rows = await this.clickhouse.query<IAccountTransactionRow>(
            `SELECT ${TRANSACTION_SELECT_COLUMNS}
             FROM ${TRANSACTIONS_TABLE} FINAL
             WHERE account = {address:String} AND ${OUTBOUND_TRC20_DEDUPE_FILTER}
             ORDER BY timestamp DESC
             LIMIT {limit:UInt32} OFFSET {offset:UInt32}`,
            { address, limit, offset }
        );

        const countRows = await this.clickhouse.query<{ total: string | number }>(
            `SELECT count() AS total FROM ${TRANSACTIONS_TABLE} FINAL
             WHERE account = {address:String} AND ${OUTBOUND_TRC20_DEDUPE_FILTER}`,
            { address }
        );

        const page: IAccountTransactionPage = {
            transactions: rows.map(AccountHistoryService.rowToBlockTransaction),
            total: Number(countRows[0]?.total ?? 0)
        };
        return page;
    }

    /**
     * Read specific stored transactions for one account by transaction hash.
     *
     * Why it exists: the valuation engine refetches the missing leg of an
     * internal transfer whose two rows straddle a per-wallet window boundary (see
     * {@link IAccountHistoryService.getTransactionsByTxIds}). The read is keyed by
     * an explicit hash set, clamped to {@link MAX_TXID_READ} so a caller cannot
     * build an unbounded `IN (...)` list, and carries the same outbound-TRC20
     * dedupe as {@link getTransactions}. Returns an empty array when ClickHouse is
     * not configured or no hashes are requested.
     *
     * @param address - Base58 address whose rows to read.
     * @param txIds - Transaction hashes to fetch.
     * @returns The matching transactions, newest first.
     */
    public async getTransactionsByTxIds(address: string, txIds: string[]): Promise<IBlockTransaction[]> {
        const normalized = String(address ?? '').trim();
        if (!TRON_ADDRESS_PATTERN.test(normalized)) {
            throw new Error('address must be a base58 TRON address (T...)');
        }
        const unique = Array.from(new Set((txIds ?? []).filter((id) => typeof id === 'string' && id.length > 0))).slice(0, MAX_TXID_READ);
        if (!this.clickhouse || unique.length === 0) {
            return [];
        }

        const rows = await this.clickhouse.query<IAccountTransactionRow>(
            `SELECT ${TRANSACTION_SELECT_COLUMNS}
             FROM ${TRANSACTIONS_TABLE} FINAL
             WHERE account = {address:String} AND tx_id IN ({txIds:Array(String)}) AND ${OUTBOUND_TRC20_DEDUPE_FILTER}
             ORDER BY timestamp DESC`,
            { address: normalized, txIds: unique }
        );
        return rows.map(AccountHistoryService.rowToBlockTransaction);
    }

    /**
     * Build the batched activity/behaviour summary for one account.
     *
     * Powers the user-facing wallet-detail view: every panel (calendar heatmap,
     * "wallet story" stats, TRON resource totals, monthly inflow/outflow, top
     * counterparties) in one call, so expanding a wallet costs a single
     * round-trip. The five aggregate reads are independent, so they run in
     * parallel. Each read carries the same outbound-TRC20 dedup filter as
     * {@link getTransactions} so a token transfer's native twin is never double-
     * counted. Authorization is the caller's responsibility — the service trusts
     * the address, so a user-facing caller must confirm ownership first. Returns a
     * zeroed summary when ClickHouse is absent rather than throwing, so the
     * surface still renders on a ClickHouse-less deploy.
     *
     * @param address - Base58 account to summarize.
     * @returns The activity summary for the address.
     */
    public async getWalletSummary(address: string): Promise<IWalletActivitySummary> {
        const normalized = String(address ?? '').trim();
        if (!TRON_ADDRESS_PATTERN.test(normalized)) {
            throw new Error('address must be a base58 TRON address (T...)');
        }
        if (!this.clickhouse) {
            return AccountHistoryService.emptyWalletSummary(normalized);
        }

        const [calendar, stats, resources, flow, counterparties] = await Promise.all([
            this.queryActivityCalendar(normalized),
            this.queryActivityStats(normalized),
            this.queryResourceTotals(normalized),
            this.queryMonthlyFlow(normalized),
            this.queryTopCounterparties(normalized)
        ]);

        const summary: IWalletActivitySummary = { address: normalized, calendar, stats, resources, flow, counterparties };
        return summary;
    }

    /**
     * The shared outbound-TRC20 dedup predicate. An outbound TRC20 transfer is
     * stored twice (a native `'tx'` row and a decoded `'trc20'` row with the same
     * `tx_id`); every summary aggregate must suppress the native twin exactly as
     * {@link getTransactions} does, or counts and sums double the token activity.
     * The fragment references the `{address:String}` bind param, so every query
     * using it must pass `address`.
     *
     * @returns A SQL boolean fragment, true for rows to keep.
     */
    private static dedupeFilter(): string {
        return `NOT (source = 'tx' AND tx_id IN (
                    SELECT tx_id FROM ${TRANSACTIONS_TABLE} WHERE account = {address:String} AND source = 'trc20'
                ))`;
    }

    /**
     * Per-day deduped transaction counts over the recent window, feeding the
     * heatmap. `toDate` buckets in UTC so the day labels match the all-time stats
     * and never drift with the server timezone.
     *
     * @param address - Base58 account to summarize.
     * @returns Day buckets ordered oldest first.
     */
    private async queryActivityCalendar(address: string): Promise<IActivityCalendarBucket[]> {
        const rows = await this.clickhouse!.query<{ day: string; count: string | number }>(
            `SELECT toString(toDate(timestamp)) AS day, count() AS count
             FROM ${TRANSACTIONS_TABLE} FINAL
             WHERE account = {address:String} AND ${AccountHistoryService.dedupeFilter()}
                   AND timestamp >= now() - toIntervalDay({windowDays:UInt32})
             GROUP BY day
             ORDER BY day ASC`,
            { address, windowDays: CALENDAR_WINDOW_DAYS }
        );
        const calendar = rows.map((row) => ({ day: String(row.day), count: Number(row.count ?? 0) }));
        return calendar;
    }

    /**
     * The all-time "wallet story" stats. Two reads: an aggregate for the totals
     * and timestamp bounds, and a distinct-active-days list used to derive the
     * active-day count and the longest consecutive-day streak in application code
     * (a streak is awkward to express in SQL and the day list is small — at most
     * one row per active day). Timestamp bounds are null when the wallet has no
     * stored history, so the surface shows an honest empty state rather than the
     * epoch.
     *
     * @param address - Base58 account to summarize.
     * @returns The all-time activity stats.
     */
    private async queryActivityStats(address: string): Promise<IWalletActivityStats> {
        const dedupe = AccountHistoryService.dedupeFilter();
        const [aggregateRows, dayRows] = await Promise.all([
            this.clickhouse!.query<{ total: string | number; first_at: string; last_at: string }>(
                `SELECT count() AS total, toString(min(timestamp)) AS first_at, toString(max(timestamp)) AS last_at
                 FROM ${TRANSACTIONS_TABLE} FINAL
                 WHERE account = {address:String} AND ${dedupe}`,
                { address }
            ),
            this.clickhouse!.query<{ day: string }>(
                `SELECT toString(toDate(timestamp)) AS day
                 FROM ${TRANSACTIONS_TABLE} FINAL
                 WHERE account = {address:String} AND ${dedupe}
                 GROUP BY day
                 ORDER BY day ASC`,
                { address }
            )
        ]);

        const total = Number(aggregateRows[0]?.total ?? 0);
        const days = dayRows.map((row) => String(row.day));
        const stats: IWalletActivityStats = {
            totalTransactions: total,
            firstActivityAt: total > 0 && aggregateRows[0]?.first_at ? parseClickHouseDateTime64Utc(aggregateRows[0].first_at) : null,
            lastActivityAt: total > 0 && aggregateRows[0]?.last_at ? parseClickHouseDateTime64Utc(aggregateRows[0].last_at) : null,
            activeDays: days.length,
            longestStreakDays: AccountHistoryService.longestStreak(days)
        };
        return stats;
    }

    /**
     * All-time TRON resource totals — the chain-native panel. `sum` over a
     * nullable column ignores nulls and yields 0 for an empty set, so the zeroed
     * shape falls out naturally for an inactive wallet.
     *
     * This is the one exception to {@link dedupeFilter} and deliberately does NOT
     * suppress the native `'tx'` twin: fee, energy, and bandwidth are populated
     * only on that native row — the decoded `'trc20'` row leaves them null — so
     * dropping it would zero the burned TRX and energy of every outbound USDT send.
     * Summing across both rows is correct precisely because the `'trc20'` twin
     * contributes null (0) to these columns and so cannot double-count.
     *
     * @param address - Base58 account to summarize.
     * @returns Energy, bandwidth, and fee totals.
     */
    private async queryResourceTotals(address: string): Promise<IWalletResourceTotals> {
        const rows = await this.clickhouse!.query<Record<string, string | number>>(
            `SELECT sum(energy_consumed) AS energy_consumed,
                    sum(bandwidth_consumed) AS bandwidth_consumed,
                    sum(fee_sun) AS fee_sun,
                    sum(energy_fee_sun) AS energy_fee_sun,
                    sum(bandwidth_fee_sun) AS bandwidth_fee_sun
             FROM ${TRANSACTIONS_TABLE} FINAL
             WHERE account = {address:String}`,
            { address }
        );
        const row = rows[0] ?? {};
        const resources: IWalletResourceTotals = {
            energyConsumed: Number(row.energy_consumed ?? 0),
            bandwidthConsumed: Number(row.bandwidth_consumed ?? 0),
            feeSun: Number(row.fee_sun ?? 0),
            energyFeeSun: Number(row.energy_fee_sun ?? 0),
            bandwidthFeeSun: Number(row.bandwidth_fee_sun ?? 0)
        };
        return resources;
    }

    /**
     * Per-month inflow/outflow split by denomination. Direction is inferred from
     * whether the wallet is the row's recipient (`to_address`) or sender
     * (`from_address`); TRX uses native `amount_sun`, USDT uses the raw token
     * amount (`toFloat64OrZero` tolerates the column's string/null shape). The two
     * denominations stay separate because, without USD valuation, they share no
     * axis. `toStartOfMonth` buckets in UTC for stable, timezone-independent labels.
     *
     * The TRX legs are restricted to `type = 'TransferContract'` because
     * `amount_sun` is filled from a *different* on-chain field per contract type
     * (`transaction-parse.ts`): a TRC10 token count for `TransferAssetContract`,
     * delegated/frozen stake for `Delegate*`/`Freeze*`. Summing every type as TRX
     * inflated the bars with non-TRX value. Wallet-to-wallet `TransferContract` is
     * the genuine TRX flow; `TriggerSmartContract` call-value is deliberately
     * excluded here so the chart reads as money in/out, not contract spend.
     *
     * @param address - Base58 account to summarize.
     * @returns Monthly flow buckets ordered oldest first.
     */
    private async queryMonthlyFlow(address: string): Promise<IWalletFlowBucket[]> {
        const rows = await this.clickhouse!.query<Record<string, string | number>>(
            `SELECT toString(toStartOfMonth(timestamp)) AS period,
                    sumIf(amount_sun, type = 'TransferContract' AND to_address = {address:String}) AS trx_in_sun,
                    sumIf(amount_sun, type = 'TransferContract' AND from_address = {address:String}) AS trx_out_sun,
                    sumIf(toFloat64OrZero(token_amount), token_symbol = 'USDT' AND to_address = {address:String}) AS usdt_in_raw,
                    sumIf(toFloat64OrZero(token_amount), token_symbol = 'USDT' AND from_address = {address:String}) AS usdt_out_raw
             FROM ${TRANSACTIONS_TABLE} FINAL
             WHERE account = {address:String} AND ${AccountHistoryService.dedupeFilter()}
             GROUP BY period
             ORDER BY period ASC`,
            { address }
        );
        const flow = rows.map((row) => ({
            period: String(row.period),
            trxInSun: Number(row.trx_in_sun ?? 0),
            trxOutSun: Number(row.trx_out_sun ?? 0),
            usdtInRaw: Number(row.usdt_in_raw ?? 0),
            usdtOutRaw: Number(row.usdt_out_raw ?? 0)
        }));
        return flow;
    }

    /**
     * The top counterparties by transaction count. The counterparty is the other
     * side of each row — `to_address` when the wallet sent, `from_address` when it
     * received — so the `if(...)` expression is repeated in the WHERE clause to
     * drop self-transfers and empty addresses (referencing a SELECT alias in WHERE
     * is not portable). This ranked table is the consumer-friendly stand-in for a
     * force-directed address graph.
     *
     * @param address - Base58 account to summarize.
     * @returns Up to {@link TOP_COUNTERPARTIES} counterparties, most-frequent first.
     */
    private async queryTopCounterparties(address: string): Promise<IWalletCounterparty[]> {
        const counterparty = `if(from_address = {address:String}, to_address, from_address)`;
        const rows = await this.clickhouse!.query<Record<string, string | number>>(
            `SELECT ${counterparty} AS counterparty,
                    count() AS tx_count,
                    countIf(from_address = {address:String}) AS sent_to_count,
                    countIf(to_address = {address:String}) AS received_from_count,
                    sumIf(amount_sun, from_address = {address:String}) AS trx_sent_sun,
                    sumIf(amount_sun, to_address = {address:String}) AS trx_received_sun
             FROM ${TRANSACTIONS_TABLE} FINAL
             WHERE account = {address:String} AND ${AccountHistoryService.dedupeFilter()}
                   AND ${counterparty} != {address:String} AND ${counterparty} != ''
             GROUP BY counterparty
             ORDER BY tx_count DESC
             LIMIT {limit:UInt32}`,
            { address, limit: TOP_COUNTERPARTIES }
        );
        const counterparties = rows.map((row) => ({
            address: String(row.counterparty),
            txCount: Number(row.tx_count ?? 0),
            sentToCount: Number(row.sent_to_count ?? 0),
            receivedFromCount: Number(row.received_from_count ?? 0),
            trxSentSun: Number(row.trx_sent_sun ?? 0),
            trxReceivedSun: Number(row.trx_received_sun ?? 0)
        }));
        return counterparties;
    }

    /**
     * Longest run of consecutive calendar days in a sorted, de-duplicated list of
     * `YYYY-MM-DD` strings. Days are parsed at UTC midnight so the day-delta is
     * exact; a gap of more than one day resets the run.
     *
     * @param days - Active days, ascending, one entry per day.
     * @returns The longest consecutive-day streak (0 for an empty list).
     */
    private static longestStreak(days: string[]): number {
        if (days.length === 0) {
            return 0;
        }
        let longest = 1;
        let current = 1;
        for (let i = 1; i < days.length; i++) {
            const previous = Date.parse(`${days[i - 1]}T00:00:00Z`);
            const today = Date.parse(`${days[i]}T00:00:00Z`);
            const deltaDays = Math.round((today - previous) / MS_PER_DAY);
            if (deltaDays === 1) {
                current += 1;
                if (current > longest) {
                    longest = current;
                }
            } else if (deltaDays > 1) {
                current = 1;
            }
        }
        return longest;
    }

    /**
     * The zeroed summary returned when ClickHouse is unavailable, so a
     * ClickHouse-less deploy renders an honest empty wallet-detail view instead of
     * erroring.
     *
     * @param address - Base58 account the (empty) summary describes.
     * @returns A fully-zeroed activity summary.
     */
    private static emptyWalletSummary(address: string): IWalletActivitySummary {
        return {
            address,
            calendar: [],
            stats: { totalTransactions: 0, firstActivityAt: null, lastActivityAt: null, activeDays: 0, longestStreakDays: 0 },
            resources: { energyConsumed: 0, bandwidthConsumed: 0, feeSun: 0, energyFeeSun: 0, bandwidthFeeSun: 0 },
            flow: [],
            counterparties: []
        };
    }

    /**
     * Advance ingestion by one bounded slice. Picks the least-recently-advanced
     * unpaused, not-complete accounts (up to `accountsPerTick`), pulls up to
     * `pagesPerTick` pages each, writes rows, and persists cursors. No-op when
     * disabled, when ClickHouse or the provider is absent, or when a tick is
     * already running.
     */
    public async runIngestionTick(): Promise<void> {
        if (this.ticking) {
            this.logger.debug('Account-history ingestion already running — skipping overlapping tick');
            return;
        }

        // The whole tick body — settings read, account selection, and the
        // broadcast — runs inside one try so a setup failure (not just a
        // per-account fetch/write, which ingestAccount self-catches) is logged
        // with account-history context. It is rethrown so the scheduler still
        // records the run as failed in its execution history.
        this.ticking = true;
        try {
            const settings = await this.getSettings();
            if (!settings.ingestionEnabled) {
                this.logger.debug('Account-history ingestion disabled — tick is a no-op');
                return;
            }
            if (!this.clickhouse || !this.provider) {
                this.logger.info('Account-history ingestion skipped — ClickHouse or provider unavailable');
                return;
            }

            const candidates = await this.selectAccountsForTick(settings.accountsPerTick);
            for (const address of candidates) {
                await this.ingestAccount(address, settings.pagesPerTick);
            }
            await this.broadcastStats();
        } catch (error) {
            this.logger.error(
                { error: error instanceof Error ? error.message : 'Unknown error' },
                'Account-history ingestion tick failed'
            );
            throw error;
        } finally {
            this.ticking = false;
        }
    }

    /**
     * Choose which accounts advance this tick: unpaused and not yet complete,
     * ordered by least-recently-advanced so coverage rotates fairly.
     *
     * @param accountsPerTick - Maximum accounts to return.
     * @returns Base58 addresses to ingest this tick.
     */
    private async selectAccountsForTick(accountsPerTick: number): Promise<string[]> {
        // One indexed query on PROGRESS does the whole selection: unpaused, not yet
        // complete, least-recently-advanced first, capped at the per-tick count.
        // `status: paused` excludes a paused non-complete account; `paused: {$ne:true}`
        // also excludes a paused *complete*-status account and tolerates the missing
        // denormalized field on pre-migration docs (reads as unpaused).
        const docs = await this.database
            .getCollection<IAccountProgressDoc>(PROGRESS_COLLECTION)
            .find({ paused: { $ne: true }, status: { $nin: ['complete', 'paused'] } })
            .sort({ lastRunAt: 1 })
            .limit(accountsPerTick)
            .toArray();
        return docs.map((doc) => doc.address);
    }

    /**
     * Advance one account this tick by walking BOTH TronGrid endpoints — the
     * general `/transactions` (`'tx'`) and `/transactions/trc20` (`'trc20'`) —
     * each up to `pages` pages with its own cursor, and marking the account
     * `complete` only once both endpoints are exhausted. Walking both is required
     * for full coverage: the native endpoint omits *inbound* TRC20 transfers
     * (the account is only the decoded recipient, not a native party), which the
     * trc20 endpoint supplies. On error each cursor is persisted at its last
     * cleanly-written page so the next tick resumes without re-counting or
     * re-fetching what already landed.
     *
     * @param address - Base58 account to ingest.
     * @param pages - Maximum pages to pull per endpoint this tick.
     */
    private async ingestAccount(address: string, pages: number): Promise<void> {
        const progress = await this.ensureProgress(address);
        await this.patchProgress(address, { status: 'running', lastRunAt: new Date(), lastError: undefined });

        const state: IIngestWalkState = {
            nativeCursor: progress.cursorFingerprint,
            trc20Cursor: progress.trc20CursorFingerprint,
            internalCursor: progress.internalCursorFingerprint,
            nativeComplete: progress.nativeComplete ?? false,
            trc20Complete: progress.trc20Complete ?? false,
            internalComplete: progress.internalComplete ?? false,
            rowsIngested: progress.rowsIngested,
            oldest: progress.oldestTimestampReached,
            newest: progress.newestTimestampSeen
        };

        try {
            if (!state.nativeComplete) {
                await this.walkSource(address, 'tx', pages, state);
            }
            if (!state.trc20Complete) {
                await this.walkSource(address, 'trc20', pages, state);
            }
            if (!state.internalComplete) {
                await this.walkInternalSource(address, pages, state);
            }

            const done = state.nativeComplete && state.trc20Complete && state.internalComplete;
            await this.patchProgress(address, {
                status: done ? 'complete' : 'queued',
                cursorFingerprint: state.nativeComplete ? undefined : state.nativeCursor,
                trc20CursorFingerprint: state.trc20Complete ? undefined : state.trc20Cursor,
                internalCursorFingerprint: state.internalComplete ? undefined : state.internalCursor,
                nativeComplete: state.nativeComplete,
                trc20Complete: state.trc20Complete,
                internalComplete: state.internalComplete,
                // An account that finishes its backfill under current code already
                // had its token legs written by the trc20 walk (events-sourced,
                // real log_index), so it never needs the Stage-3 token sweep. Marking
                // it here is what keeps the ledger-backfill selector targeting only
                // the legacy population (completed before token dual-write, flag absent).
                tokenLegsBackfillComplete: done ? true : undefined,
                rowsIngested: state.rowsIngested,
                oldestTimestampReached: state.oldest,
                newestTimestampSeen: state.newest
            });
            if (done) {
                this.logger.info({ address, rowsIngested: state.rowsIngested }, 'Account-history backfill complete for account (all endpoints exhausted)');
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            this.logger.error({ address, error: message }, 'Account-history ingestion failed for account');
            await this.patchProgress(address, {
                status: 'failed',
                lastError: message,
                cursorFingerprint: state.nativeCursor,
                trc20CursorFingerprint: state.trc20Cursor,
                internalCursorFingerprint: state.internalCursor,
                nativeComplete: state.nativeComplete,
                trc20Complete: state.trc20Complete,
                internalComplete: state.internalComplete,
                rowsIngested: state.rowsIngested,
                oldestTimestampReached: state.oldest,
                newestTimestampSeen: state.newest
            });
        }
    }

    /**
     * Walk one endpoint's pages, writing each page to ClickHouse and advancing
     * that endpoint's cursor in `state` after every clean write. Mutates `state`
     * in place (cursor, completion flag, counts, timestamp bounds) so the caller
     * can persist a single combined progress record. A throw propagates to the
     * caller's catch with `state` reflecting everything written so far.
     *
     * @param address - Base58 account being ingested.
     * @param source - Which endpoint to walk (`'tx'` or `'trc20'`).
     * @param pages - Maximum pages to pull this tick.
     * @param state - Mutable per-tick walk state, updated in place.
     */
    private async walkSource(address: string, source: AccountTxSource, pages: number, state: IIngestWalkState): Promise<void> {
        let fingerprint = source === 'tx' ? state.nativeCursor : state.trc20Cursor;

        for (let page = 0; page < pages; page++) {
            const result = await this.provider!.fetchPage(address, { source, limit: PROVIDER_PAGE_LIMIT, fingerprint });
            if (result.transactions.length > 0) {
                await this.writeTransactions(address, source, result.transactions);
                state.rowsIngested += result.transactions.length;
                for (const tx of result.transactions) {
                    if (!state.newest || tx.timestamp > state.newest) {
                        state.newest = tx.timestamp;
                    }
                    if (!state.oldest || tx.timestamp < state.oldest) {
                        state.oldest = tx.timestamp;
                    }
                }
            }

            fingerprint = result.nextFingerprint;
            if (source === 'tx') {
                state.nativeCursor = fingerprint;
            } else {
                state.trc20Cursor = fingerprint;
            }

            if (!fingerprint) {
                if (source === 'tx') {
                    state.nativeComplete = true;
                } else {
                    state.trc20Complete = true;
                }
                return;
            }
        }
    }

    /**
     * Walk the internal-transactions endpoint's pages, writing each page's value
     * legs to the value-transfer ledger and advancing the internal cursor in
     * `state` after every clean write. The internal counterpart of
     * {@link walkSource}: internal transfers are value legs, not transactions, so
     * they go to `account_value_transfers` and never to `account_transactions`. A
     * contract paying TRX to the account is captured only here. Mutates `state` in
     * place so the caller persists one combined progress record.
     *
     * @param address - Base58 account being ingested.
     * @param pages - Maximum pages to pull this tick.
     * @param state - Mutable per-tick walk state, updated in place.
     */
    private async walkInternalSource(address: string, pages: number, state: IIngestWalkState): Promise<void> {
        let fingerprint = state.internalCursor;

        for (let page = 0; page < pages; page++) {
            const result = await this.provider!.fetchInternalTransfersPage(address, { limit: PROVIDER_PAGE_LIMIT, fingerprint });
            if (result.transfers.length > 0) {
                await this.writeValueTransfers(address, result.transfers);
                state.rowsIngested += result.transfers.length;
                for (const transfer of result.transfers) {
                    if (!state.newest || transfer.timestamp > state.newest) {
                        state.newest = transfer.timestamp;
                    }
                    if (!state.oldest || transfer.timestamp < state.oldest) {
                        state.oldest = transfer.timestamp;
                    }
                }
            }

            fingerprint = result.nextFingerprint;
            state.internalCursor = fingerprint;

            if (!fingerprint) {
                state.internalComplete = true;
                return;
            }
        }
    }

    /**
     * Keep already-complete accounts current. The backward backfill stops once an
     * account reaches `complete` and is then excluded from {@link runIngestionTick}
     * forever — so without this pass a completed account's stored history goes
     * stale the moment new transactions land. This tick re-polls the *leading edge*
     * of each completed account (newest pages, both endpoints) for transactions
     * newer than the recorded watermark and appends them, leaving the account
     * `complete`. Bounded per tick like the backfill, and gated by the same
     * `ingestionEnabled` master switch.
     */
    public async runForwardSyncTick(): Promise<void> {
        if (this.forwardTicking) {
            this.logger.debug('Account-history forward sync already running — skipping overlapping tick');
            return;
        }

        this.forwardTicking = true;
        try {
            const settings = await this.getSettings();
            if (!settings.ingestionEnabled) {
                this.logger.debug('Account-history ingestion disabled — forward sync is a no-op');
                return;
            }
            if (!this.clickhouse || !this.provider) {
                this.logger.info('Account-history forward sync skipped — ClickHouse or provider unavailable');
                return;
            }

            const candidates = await this.selectCompletedAccountsForForward(settings.accountsPerTick);
            for (const address of candidates) {
                await this.forwardSyncAccount(address, settings.pagesPerTick);
            }
            await this.broadcastStats();
        } catch (error) {
            this.logger.error(
                { error: error instanceof Error ? error.message : 'Unknown error' },
                'Account-history forward sync tick failed'
            );
            throw error;
        } finally {
            this.forwardTicking = false;
        }
    }

    /**
     * Choose which completed accounts to forward-sync this tick: unpaused and
     * `complete`, ordered least-recently-advanced so freshness rotates fairly
     * across the completed set. The inverse of {@link selectAccountsForTick},
     * which deliberately excludes `complete`.
     *
     * @param accountsPerTick - Maximum accounts to return.
     * @returns Base58 addresses to forward-sync this tick.
     */
    private async selectCompletedAccountsForForward(accountsPerTick: number): Promise<string[]> {
        // The inverse of selectAccountsForTick: unpaused and `complete`, pushed into
        // one indexed query on PROGRESS. Ordered by the forward-specific timestamp,
        // not `lastRunAt`: for a completed account `lastRunAt` was frozen at backfill
        // completion, so it cannot rotate forward freshness fairly. A
        // never-forward-synced account (`lastForwardRunAt` absent) sorts first, so it
        // is refreshed soonest. `paused: {$ne:true}` excludes a paused completed
        // account (whose status stays `complete`) and tolerates the missing field on
        // pre-migration docs.
        const docs = await this.database
            .getCollection<IAccountProgressDoc>(PROGRESS_COLLECTION)
            .find({ paused: { $ne: true }, status: 'complete' })
            .sort({ lastForwardRunAt: 1 })
            .limit(accountsPerTick)
            .toArray();
        return docs.map((doc) => doc.address);
    }

    /**
     * Forward-poll one completed account to capture transactions that arrived
     * after its backfill, advancing the watermark only when the leading edge is
     * fully drained — so a burst larger than one tick can hold never strands the
     * rows below the fetched window.
     *
     * Each endpoint is walked newest-first, writing transactions newer than the
     * watermark recorded at the start of the drain. Reaching known territory (a
     * row at or below the watermark) completes that endpoint's drain. Hitting the
     * per-tick page cap first instead leaves the endpoint *mid-drain*: its
     * continuation fingerprint is persisted (`forwardTxCursor` /
     * `forwardTrc20Cursor`) and the next tick resumes draining downward from
     * there. Crucially the watermark is NOT advanced while any endpoint is
     * mid-drain — the newest timestamp seen is held in `forwardPendingNewest` and
     * promoted to `newestTimestampSeen` only once both endpoints reach known
     * territory. This closes the silent-data-loss gap an immediate advance caused,
     * where a capped tick moved the watermark past un-fetched rows that every
     * future tick then filtered out as already-known.
     *
     * While an account is mid-drain, an endpoint that is not itself draining is
     * skipped rather than re-walked from the leading edge. Re-walking it would let
     * fresh arrivals push the shared pending watermark up, which on promotion could
     * strand un-fetched rows on the still-draining endpoint; deferring the skipped
     * endpoint's new arrivals to the next clean cycle (after the drain completes)
     * keeps the single shared watermark safe without per-endpoint watermarks. The
     * cost is a few minutes of extra latency for the skipped endpoint during a long
     * drain — never lost data.
     *
     * Status stays `complete` throughout — including on failure. Flipping to
     * `failed` would re-admit the account to the backward backfill (which filters
     * on `status !== 'complete'`) and, with the cursors cleared at completion,
     * trigger a full re-walk that double-counts. On error it keeps `complete`,
     * persists the drain state, and the next forward tick resumes from it.
     *
     * @param address - Base58 completed account to refresh.
     * @param pages - Maximum newest pages to pull per endpoint this tick.
     */
    private async forwardSyncAccount(address: string, pages: number): Promise<void> {
        const progress = await this.ensureProgress(address);
        const threshold = progress.newestTimestampSeen;

        // An account is mid-drain when either endpoint carries a continuation
        // cursor from a prior capped tick. While mid-drain the watermark is frozen
        // at `threshold` and only the still-draining endpoints are advanced.
        const midDrain =
            progress.forwardTxCursor !== undefined ||
            progress.forwardTrc20Cursor !== undefined ||
            progress.forwardInternalCursor !== undefined;

        // Running newest across the whole (possibly multi-tick) drain: seeded from
        // the held pending value when resuming, else from the frozen watermark so
        // an empty poll leaves the watermark unchanged.
        let pendingNewest: Date | undefined = progress.forwardPendingNewest ?? threshold;
        let nextTxCursor = progress.forwardTxCursor;
        let nextTrc20Cursor = progress.forwardTrc20Cursor;
        let nextInternalCursor = progress.forwardInternalCursor;
        let written = 0;

        try {
            for (const source of ['tx', 'trc20'] as AccountTxSource[]) {
                const isTx = source === 'tx';
                const endpointCursor = isTx ? progress.forwardTxCursor : progress.forwardTrc20Cursor;
                const endpointDraining = endpointCursor !== undefined;

                // Mid-drain: leave a non-draining endpoint untouched so its fresh
                // arrivals cannot push the shared pending watermark past rows the
                // still-draining endpoint has not fetched. They are picked up on the
                // next clean cycle, once the drain completes.
                if (midDrain && !endpointDraining) {
                    continue;
                }

                let fingerprint: string | undefined = endpointCursor;
                let drainComplete = false;

                for (let page = 0; page < pages; page++) {
                    const result = await this.provider!.fetchPage(address, { source, limit: PROVIDER_PAGE_LIMIT, fingerprint });
                    if (result.transactions.length === 0) {
                        // Provider exhausted the leading edge — nothing more to drain.
                        drainComplete = true;
                        break;
                    }

                    const fresh = threshold
                        ? result.transactions.filter((tx) => tx.timestamp > threshold)
                        : result.transactions;
                    if (fresh.length > 0) {
                        await this.writeTransactions(address, source, fresh);
                        written += fresh.length;
                        for (const tx of fresh) {
                            if (!pendingNewest || tx.timestamp > pendingNewest) {
                                pendingNewest = tx.timestamp;
                            }
                        }
                    }

                    // Known territory (a row at/below the watermark) or a page with
                    // nothing new means this endpoint's drain is finished.
                    const reachedKnown = threshold ? result.transactions.some((tx) => tx.timestamp <= threshold) : false;
                    fingerprint = result.nextFingerprint;
                    if (reachedKnown || fresh.length === 0 || !fingerprint) {
                        drainComplete = true;
                        break;
                    }
                    if (page === pages - 1) {
                        // Hit the page cap before known territory: the drain resumes
                        // next tick from `fingerprint`. The watermark stays frozen so
                        // the un-fetched rows below this window are never stranded.
                        this.logger.warn({ address, source, pages }, 'Account-history forward sync hit the page cap before reaching the watermark — drain will resume next tick');
                    }
                }

                const continuation = drainComplete ? undefined : fingerprint;
                if (isTx) {
                    nextTxCursor = continuation;
                } else {
                    nextTrc20Cursor = continuation;
                }
            }

            // Internal value transfers — same leading-edge drain discipline as the
            // transaction endpoints, against the same shared watermark, so a contract
            // depositing TRX to a completed account is caught here. Kept as its own
            // block (not folded into the tx/trc20 loop) because it reads value legs,
            // not transactions, and writes the value-transfer ledger.
            {
                const endpointDraining = progress.forwardInternalCursor !== undefined;
                // Mid-drain: leave internal untouched unless it is the draining
                // endpoint, so its fresh arrivals cannot push the shared watermark
                // past rows a still-draining transaction endpoint has not fetched.
                if (!(midDrain && !endpointDraining)) {
                    let fingerprint: string | undefined = progress.forwardInternalCursor;
                    let drainComplete = false;

                    for (let page = 0; page < pages; page++) {
                        const result = await this.provider!.fetchInternalTransfersPage(address, { limit: PROVIDER_PAGE_LIMIT, fingerprint });
                        if (result.transfers.length === 0) {
                            drainComplete = true;
                            break;
                        }

                        const fresh = threshold
                            ? result.transfers.filter((transfer) => transfer.timestamp > threshold)
                            : result.transfers;
                        if (fresh.length > 0) {
                            await this.writeValueTransfers(address, fresh);
                            written += fresh.length;
                            for (const transfer of fresh) {
                                if (!pendingNewest || transfer.timestamp > pendingNewest) {
                                    pendingNewest = transfer.timestamp;
                                }
                            }
                        }

                        const reachedKnown = threshold ? result.transfers.some((transfer) => transfer.timestamp <= threshold) : false;
                        fingerprint = result.nextFingerprint;
                        if (reachedKnown || fresh.length === 0 || !fingerprint) {
                            drainComplete = true;
                            break;
                        }
                        if (page === pages - 1) {
                            this.logger.warn({ address, source: 'internal', pages }, 'Account-history forward sync hit the page cap before reaching the watermark — drain will resume next tick');
                        }
                    }

                    nextInternalCursor = drainComplete ? undefined : fingerprint;
                }
            }

            const stillDraining = nextTxCursor !== undefined || nextTrc20Cursor !== undefined || nextInternalCursor !== undefined;
            // One timestamp for both fields: `lastRunAt` keeps its "last touched by
            // any tick" meaning (so the admin's primary column stays live for
            // completed accounts), while `lastForwardRunAt` records the forward
            // refresh specifically and drives the forward round-robin.
            const now = new Date();
            const patch: Partial<IAccountProgressDoc> = {
                forwardTxCursor: nextTxCursor,
                forwardTrc20Cursor: nextTrc20Cursor,
                forwardInternalCursor: nextInternalCursor,
                rowsIngested: progress.rowsIngested + written,
                lastRunAt: now,
                lastForwardRunAt: now,
                lastError: undefined
            };
            if (stillDraining) {
                // Hold the newest seen; the watermark must not move past an
                // un-drained gap.
                patch.forwardPendingNewest = pendingNewest;
            } else {
                // Every endpoint reached known territory — safe to promote the
                // watermark and clear the held pending value.
                patch.newestTimestampSeen = pendingNewest;
                patch.forwardPendingNewest = undefined;
            }
            await this.patchProgress(address, patch);

            if (written > 0) {
                this.logger.info({ address, written }, 'Account-history forward sync appended new transactions to a completed account');
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            this.logger.error({ address, error: message }, 'Account-history forward sync failed for account');
            // Keep status `complete`; never reopen the backfill (see method doc).
            // Persist the drain state so the next tick resumes; never promote the
            // watermark on a failed (partial) drain.
            const now = new Date();
            await this.patchProgress(address, {
                forwardTxCursor: nextTxCursor,
                forwardTrc20Cursor: nextTrc20Cursor,
                forwardInternalCursor: nextInternalCursor,
                forwardPendingNewest: pendingNewest,
                rowsIngested: progress.rowsIngested + written,
                lastRunAt: now,
                lastForwardRunAt: now,
                lastError: message
            });
        }
    }

    /**
     * Backfill the value-transfer ledger for accounts that finished their backfill
     * before the Stage-2 dual-write shipped. Native legs are reconstructed from
     * stored rows by migration `005`; this tick covers the two leg families the
     * provider must re-fetch: historical internal legs (never lived in
     * `account_transactions`) and token legs (whose `log_index` key is only on the
     * events endpoint). Bounded per tick like the other ticks and gated by the same
     * `ingestionEnabled` master switch. Self-quiescing: once a legacy account's
     * internal source exhausts and its token sweep finishes, the selector excludes
     * it, and new accounts never enter (they are marked token-current at completion).
     *
     * Operates on `complete` accounts — the population forward sync owns — but
     * writes a disjoint set of progress fields (internal cursor, the two token-sweep
     * fields, `lastLedgerBackfillRunAt`), so the two ticks run concurrently without
     * clobbering each other under `patchProgress`'s field-level `$set`.
     */
    public async runLedgerBackfillTick(): Promise<void> {
        if (this.ledgerBackfillTicking) {
            this.logger.debug('Account-history ledger backfill already running — skipping overlapping tick');
            return;
        }

        this.ledgerBackfillTicking = true;
        try {
            const settings = await this.getSettings();
            if (!settings.ingestionEnabled) {
                this.logger.debug('Account-history ingestion disabled — ledger backfill is a no-op');
                return;
            }
            if (!this.clickhouse || !this.provider) {
                this.logger.info('Account-history ledger backfill skipped — ClickHouse or provider unavailable');
                return;
            }

            const candidates = await this.selectAccountsForLedgerBackfill(settings.accountsPerTick);
            if (candidates.length === 0) {
                return;
            }
            for (const address of candidates) {
                await this.backfillLedgerForAccount(address, settings.pagesPerTick);
            }
            await this.broadcastStats();
        } catch (error) {
            this.logger.error(
                { error: error instanceof Error ? error.message : 'Unknown error' },
                'Account-history ledger backfill tick failed'
            );
            throw error;
        } finally {
            this.ledgerBackfillTicking = false;
        }
    }

    /**
     * Select the stalest completed accounts that still owe ledger legs. A completed
     * account is owed work while either its internal source has not exhausted
     * (`internalComplete` absent/false) or its token sweep has not finished
     * (`tokenLegsBackfillComplete` absent/false); once both are satisfied the `$or`
     * stops matching and the account drops out forever. The `status: 'complete'`
     * equality keeps the tick off in-flight backfills, and the
     * `{status, lastLedgerBackfillRunAt, paused}` index serves the equality + sort.
     *
     * @param accountsPerTick - Round-robin batch size for this tick.
     * @returns Up to `accountsPerTick` addresses, stalest-backfilled first.
     */
    private async selectAccountsForLedgerBackfill(accountsPerTick: number): Promise<string[]> {
        const docs = await this.database
            .getCollection<IAccountProgressDoc>(PROGRESS_COLLECTION)
            .find({
                paused: { $ne: true },
                status: 'complete',
                $or: [{ internalComplete: { $ne: true } }, { tokenLegsBackfillComplete: { $ne: true } }]
            })
            .sort({ lastLedgerBackfillRunAt: 1 })
            .limit(accountsPerTick)
            .toArray();
        return docs.map((doc) => doc.address);
    }

    /**
     * Advance one account's ledger backfill: drain a bounded slice of its internal
     * source, then sweep a bounded batch of its stored token transactions. Both
     * sub-tasks are idempotent and persist their own cursor, so a throw in either
     * resumes cleanly next tick. A per-account failure is logged and swallowed so
     * one bad account does not abort the whole tick; `lastLedgerBackfillRunAt` is
     * still stamped so the failing account does not starve the rest by always
     * sorting first.
     *
     * @param address - Completed account to advance.
     * @param pages - Internal-source pages to pull this tick (the shared pacing dial).
     */
    private async backfillLedgerForAccount(address: string, pages: number): Promise<void> {
        const progress = await this.database
            .getCollection<IAccountProgressDoc>(PROGRESS_COLLECTION)
            .findOne({ address });
        if (!progress) {
            return;
        }

        try {
            if (!progress.internalComplete) {
                await this.backfillInternalLegs(address, pages, progress.internalCursorFingerprint);
            }
            if (!progress.tokenLegsBackfillComplete) {
                await this.backfillTokenLegsBatch(address, progress.tokenLegsBackfillCursor);
            }
        } catch (error) {
            this.logger.error(
                { address, error: error instanceof Error ? error.message : 'Unknown error' },
                'Account-history ledger backfill failed for account'
            );
        } finally {
            await this.patchProgress(address, { lastLedgerBackfillRunAt: new Date() });
        }
    }

    /**
     * Drain a bounded slice of an account's internal-transactions source into the
     * ledger, reusing {@link walkInternalSource} so the historical backfill and the
     * live forward drain stay byte-identical. A throwaway walk state is seeded from
     * the stored internal cursor with the other endpoints flagged complete (they are
     * not the backfill's concern). The advanced cursor and completion flag are
     * persisted in a `finally` so a mid-walk throw still resumes from the last clean
     * page — only the two internal fields are written, never the shared counters
     * forward sync also touches.
     *
     * @param address - Completed account to advance.
     * @param pages - Maximum internal pages to pull this tick.
     * @param internalCursor - Stored internal cursor to resume from, if any.
     */
    private async backfillInternalLegs(address: string, pages: number, internalCursor?: string): Promise<void> {
        const state: IIngestWalkState = {
            internalCursor,
            nativeComplete: true,
            trc20Complete: true,
            internalComplete: false,
            rowsIngested: 0
        };
        try {
            await this.walkInternalSource(address, pages, state);
        } finally {
            await this.patchProgress(address, {
                internalCursorFingerprint: state.internalComplete ? undefined : state.internalCursor,
                internalComplete: state.internalComplete
            });
        }
    }

    /**
     * Sweep the next batch of an account's stored `trc20` transactions into the
     * ledger as token legs. Token legs cannot be reconstructed from
     * `account_transactions` (it lacks the `log_index` that keys them), so each
     * distinct stored `trc20` transaction is re-fetched from the provider's events
     * endpoint — exactly the live `writeTokenTransferLegs` source — one events call
     * per transaction through the shared rate limiter. The keyset cursor advances
     * over `(timestamp, tx_id)` so the sweep resumes mid-account across ticks; a
     * short batch means the account is fully swept. Writes legs before advancing the
     * cursor so a write failure re-ingests the batch idempotently next tick.
     *
     * @param address - Completed account to advance.
     * @param cursor - Encoded `(timestamp, tx_id)` watermark of the last swept
     *   transaction, or undefined to start from the account's oldest `trc20` row.
     */
    private async backfillTokenLegsBatch(address: string, cursor?: string): Promise<void> {
        const parsed = AccountHistoryService.parseTokenBackfillCursor(cursor);
        const keyset = parsed
            ? `AND (timestamp, tx_id) > (toDateTime64({ts:String}, 3, 'UTC'), {txId:String})`
            : '';
        const batchRows = await this.clickhouse!.query<{ tx_id: string; ts: string }>(
            `SELECT DISTINCT tx_id, toString(timestamp) AS ts
             FROM ${TRANSACTIONS_TABLE}
             WHERE account = {address:String} AND source = 'trc20' ${keyset}
             ORDER BY timestamp ASC, tx_id ASC
             LIMIT {limit:UInt32}`,
            parsed
                ? { address, ts: parsed.ts, txId: parsed.txId, limit: LEDGER_BACKFILL_TOKEN_TX_PER_TICK }
                : { address, limit: LEDGER_BACKFILL_TOKEN_TX_PER_TICK }
        );

        if (batchRows.length === 0) {
            await this.patchProgress(address, { tokenLegsBackfillComplete: true });
            return;
        }

        const txIds = batchRows.map((row) => row.tx_id);
        // Carry decimals from the stored trc20 rows' token metadata — the events
        // payload omits them — mirroring the live writeTokenTransferLegs enrichment.
        const decimalsRows = await this.clickhouse!.query<{ contract_address: string; token_decimals: number }>(
            `SELECT DISTINCT contract_address, token_decimals
             FROM ${TRANSACTIONS_TABLE}
             WHERE account = {address:String} AND source = 'trc20'
                   AND tx_id IN ({txIds:Array(String)})
                   AND contract_address IS NOT NULL AND token_decimals IS NOT NULL`,
            { address, txIds }
        );
        const decimalsByAsset = new Map<string, number>();
        for (const row of decimalsRows) {
            if (row.contract_address != null && typeof row.token_decimals === 'number') {
                decimalsByAsset.set(row.contract_address, row.token_decimals);
            }
        }

        // Fetch each transaction's legs one at a time, tracking the last
        // *fully-fetched* transaction. `fetchTokenTransferLegs` throws on a real
        // events-fetch failure (rate limit, network) rather than returning empty, so
        // a failure must not advance the cursor past the transaction it could not
        // read — its token legs are unreconstructable without the events log_index.
        // On a mid-batch failure we keep the progress earned through the last clean
        // transaction and let a later tick resume from there, rather than discarding
        // the whole batch and re-spending those rate-limited calls.
        const legs: IValueTransfer[] = [];
        let lastSuccessfulIndex = -1;
        let fetchFailed = false;
        for (let index = 0; index < txIds.length; index++) {
            let txLegs: IValueTransfer[];
            try {
                txLegs = await this.provider!.fetchTokenTransferLegs(address, txIds[index]);
            } catch (error) {
                this.logger.warn(
                    { address, txId: txIds[index], error: error instanceof Error ? error.message : String(error) },
                    'Account-history ledger backfill: token events fetch failed mid-batch; persisting progress through last success'
                );
                fetchFailed = true;
                break;
            }
            for (const leg of txLegs) {
                const decimals = decimalsByAsset.get(leg.assetId);
                legs.push(decimals != null ? { ...leg, assetDecimals: decimals } : leg);
            }
            lastSuccessfulIndex = index;
        }

        // Write legs before advancing the cursor so a ClickHouse write failure
        // throws first and re-ingests the batch idempotently next tick.
        if (legs.length > 0) {
            await this.writeValueTransfers(address, legs);
        }

        // The very first transaction failed: no progress to record, cursor stays put.
        if (lastSuccessfulIndex < 0) {
            return;
        }

        const last = batchRows[lastSuccessfulIndex];
        const patch: Partial<IAccountProgressDoc> = {
            tokenLegsBackfillCursor: AccountHistoryService.encodeTokenBackfillCursor(last.ts, last.tx_id)
        };
        // Mark complete only when the whole batch fetched cleanly AND was short of
        // the cap (the account is exhausted) — never past a failed fetch, which
        // would drop the unread transaction's legs permanently.
        if (!fetchFailed && batchRows.length < LEDGER_BACKFILL_TOKEN_TX_PER_TICK) {
            patch.tokenLegsBackfillComplete = true;
        }
        await this.patchProgress(address, patch);
    }

    /**
     * Encode a token-sweep keyset watermark. The `trc20` `tx_id` is a hex hash and
     * the ClickHouse timestamp string carries no `|`, so a single pipe is an
     * unambiguous separator.
     *
     * @param ts - ClickHouse timestamp string of the last swept transaction.
     * @param txId - Hash of the last swept transaction.
     * @returns The encoded `"<ts>|<txId>"` cursor.
     */
    private static encodeTokenBackfillCursor(ts: string, txId: string): string {
        return `${ts}|${txId}`;
    }

    /**
     * Parse a token-sweep keyset watermark back into its parts.
     *
     * @param cursor - The encoded cursor, or undefined when the sweep has not started.
     * @returns The `(ts, txId)` watermark, or null to start from the oldest row.
     */
    private static parseTokenBackfillCursor(cursor?: string): { ts: string; txId: string } | null {
        if (!cursor) {
            return null;
        }
        const separator = cursor.indexOf('|');
        if (separator < 0) {
            return null;
        }
        return { ts: cursor.slice(0, separator), txId: cursor.slice(separator + 1) };
    }

    /**
     * Project and insert a page of transactions from one endpoint into ClickHouse.
     * ReplacingMergeTree makes the insert idempotent on the full sort key
     * `(account, timestamp, tx_id, source, to_address)`.
     *
     * @param address - The tracked account these rows belong to.
     * @param source - Which endpoint produced them (part of the dedup key).
     * @param transactions - Normalized transactions to store.
     */
    private async writeTransactions(address: string, source: AccountTxSource, transactions: IBlockTransaction[]): Promise<void> {
        const ingestedAt = formatClickHouseDateTime64Utc(new Date());
        const rows = transactions.map((tx) =>
            toAccountTransactionRow(address, tx, source, formatClickHouseDateTime64Utc(tx.timestamp), ingestedAt)
        );
        // Wait for the durable commit before the caller advances the fingerprint
        // cursor. With the default async_insert / wait_for_async_insert:0, a later
        // flush failure would surface only in the error poller — after the cursor
        // has already moved past these rows, permanently skipping the page. A throw
        // here keeps the cursor on the failed page so the next tick re-fetches and
        // (idempotently, via ReplacingMergeTree) re-writes it.
        await this.clickhouse!.insert<IAccountTransactionRow>(TRANSACTIONS_TABLE, rows, { waitForCommit: true });

        // Dual-write the source-independent value legs (the value-transfer ledger).
        // Native legs are derived from the same transactions; internal legs come from
        // the internal endpoint via walkInternalSource; token legs are sourced below.
        // Both backfill and forward sync write through here, so they inherit the
        // dual-write. The ledger insert follows the transaction insert so a
        // value-ledger failure also throws before the cursor advances, keeping the
        // page re-ingestable.
        await this.writeValueTransfers(address, transactions.flatMap((tx) => toValueTransfers(tx)));

        // Token (`token_event`) legs are sourced separately, from the per-transaction
        // events endpoint, because only it carries the TRC20 `log_index` that keeps
        // distinct same-token transfers in one transaction from colliding under the
        // ledger's natural key. Driven off the `trc20` walk: every token transfer the
        // account participates in (inbound and outbound alike) surfaces there, so
        // enriching here covers both directions without a fourth cursor.
        if (source === 'trc20') {
            await this.writeTokenTransferLegs(address, transactions);
        }
    }

    /**
     * Source and write the token value legs for a page of trc20 transactions. For
     * each distinct transaction the page touches, fetches its account-involving token
     * legs — keyed by the protocol `log_index` so distinct same-token transfers never
     * collapse — from the provider's events source and writes them to the value
     * ledger. The events payload omits token decimals, so they are carried over from
     * the trc20 rows' token metadata where available. Insert-before-cursor-advance
     * discipline matches {@link writeTransactions}: a failed write throws before the
     * trc20 cursor moves, so the page is re-ingested idempotently.
     *
     * @param address - The tracked account these legs belong to.
     * @param transactions - The trc20-source transactions of the current page.
     */
    private async writeTokenTransferLegs(address: string, transactions: IBlockTransaction[]): Promise<void> {
        const decimalsByAsset = new Map<string, number>();
        for (const tx of transactions) {
            const assetId = tx.contract?.address;
            const decimals = tx.contract?.parameters?.decimals;
            if (assetId && typeof decimals === 'number') {
                decimalsByAsset.set(assetId, decimals);
            }
        }
        const txIds = [...new Set(transactions.map((tx) => tx.txId))];
        const legs: IValueTransfer[] = [];
        for (const txId of txIds) {
            const txLegs = await this.provider!.fetchTokenTransferLegs(address, txId);
            for (const leg of txLegs) {
                const decimals = decimalsByAsset.get(leg.assetId);
                legs.push(decimals != null ? { ...leg, assetDecimals: decimals } : leg);
            }
        }
        await this.writeValueTransfers(address, legs);
    }

    /**
     * Project and insert value-transfer legs into the `account_value_transfers`
     * ledger. ReplacingMergeTree makes the insert idempotent on the natural key
     * `(account, timestamp, tx_id, origin, leg_key, asset_id)`. A no-op on an empty
     * batch so callers need not guard. Like {@link writeTransactions}, waits for the
     * durable commit so a flush failure throws before any cursor advances.
     *
     * @param address - The tracked account these legs belong to.
     * @param transfers - Normalized value transfers to store.
     */
    private async writeValueTransfers(address: string, transfers: IValueTransfer[]): Promise<void> {
        if (transfers.length === 0) {
            return;
        }
        const ingestedAt = formatClickHouseDateTime64Utc(new Date());
        const rows = transfers.map((leg) =>
            toValueTransferRow(address, leg, formatClickHouseDateTime64Utc(leg.timestamp), ingestedAt)
        );
        await this.clickhouse!.insert<IAccountValueTransferRow>(VALUE_TRANSFERS_TABLE, rows, { waitForCommit: true });
    }

    /**
     * Map a stored scalar snapshot row to the published DTO, attaching any token
     * balances the caller resolved separately (series reads pass none).
     *
     * @param row - Stored scalar snapshot row.
     * @param tokenBalances - Token balances for this snapshot, or empty.
     * @returns The published snapshot.
     */
    private static mapSnapshotRow(
        row: IBalanceSnapshotRow,
        tokenBalances: IAccountBalanceSnapshot['tokenBalances']
    ): IAccountBalanceSnapshot {
        return {
            address: row.account,
            capturedAt: parseClickHouseDateTime64Utc(row.captured_at),
            trxBalanceSun: Number(row.trx_balance_sun),
            stakedEnergySun: Number(row.staked_energy_sun),
            stakedBandwidthSun: Number(row.staked_bandwidth_sun),
            unstakingSun: Number(row.unstaking_sun),
            energyLimit: Number(row.energy_limit),
            energyUsed: Number(row.energy_used),
            netLimit: Number(row.net_limit),
            netUsed: Number(row.net_used),
            tokenBalances
        };
    }

    /**
     * Columns shared by both snapshot reads; aliased so Date/DateTime64 come back
     * as strings the DTO mapper parses uniformly.
     */
    private static readonly SNAPSHOT_COLUMNS =
        `account, toString(day) AS day, toString(captured_at) AS captured_at,
         trx_balance_sun, staked_energy_sun, staked_bandwidth_sun, unstaking_sun,
         energy_limit, energy_used, net_limit, net_used`;

    /**
     * Read the most recent snapshot for an account plus its token balances. Null
     * when none captured. See {@link IAccountHistoryService.getLatestSnapshot}.
     *
     * @param address - Base58 address.
     * @returns The latest snapshot, or null.
     */
    public async getLatestSnapshot(address: string): Promise<IAccountBalanceSnapshot | null> {
        if (!this.clickhouse) {
            return null;
        }
        const rows = await this.clickhouse.query<IBalanceSnapshotRow>(
            `SELECT ${AccountHistoryService.SNAPSHOT_COLUMNS}
             FROM ${BALANCE_SNAPSHOTS_TABLE} FINAL
             WHERE account = {address:String}
             ORDER BY day DESC LIMIT 1`,
            { address }
        );
        if (rows.length === 0) {
            return null;
        }
        const tokenRows = await this.clickhouse.query<ITokenBalanceRow>(
            `SELECT asset, raw_balance FROM ${TOKEN_BALANCES_TABLE} FINAL
             WHERE account = {address:String} AND day = {day:Date}`,
            { address, day: rows[0].day }
        );
        const tokenBalances = tokenRows.map((row) => ({ asset: row.asset, rawBalance: String(row.raw_balance) }));
        return AccountHistoryService.mapSnapshotRow(rows[0], tokenBalances);
    }

    /**
     * Read the scalar snapshot series over a UTC day range, oldest first; token
     * balances omitted. See {@link IAccountHistoryService.getSnapshotSeries}.
     *
     * @param address - Base58 address.
     * @param fromDay - Inclusive start UTC `YYYY-MM-DD`.
     * @param toDay - Inclusive end UTC `YYYY-MM-DD`.
     * @returns Snapshots in range, oldest first.
     */
    public async getSnapshotSeries(address: string, fromDay: string, toDay: string): Promise<IAccountBalanceSnapshot[]> {
        if (!this.clickhouse) {
            return [];
        }
        const rows = await this.clickhouse.query<IBalanceSnapshotRow>(
            `SELECT ${AccountHistoryService.SNAPSHOT_COLUMNS}
             FROM ${BALANCE_SNAPSHOTS_TABLE} FINAL
             WHERE account = {address:String} AND day >= {fromDay:Date} AND day <= {toDay:Date}
             ORDER BY day ASC`,
            { address, fromDay, toDay }
        );
        return rows.map((row) => AccountHistoryService.mapSnapshotRow(row, []));
    }

    /**
     * List distinct held token contracts across all stored snapshots. See
     * {@link IAccountHistoryService.getHeldTokenAssets}.
     *
     * @returns Distinct token contract addresses; empty when ClickHouse is absent.
     */
    public async getHeldTokenAssets(): Promise<string[]> {
        if (!this.clickhouse) {
            return [];
        }
        const rows = await this.clickhouse.query<{ asset: string }>(
            `SELECT DISTINCT asset FROM ${TOKEN_BALANCES_TABLE} FINAL`
        );
        return rows.map((row) => row.asset);
    }

    /**
     * Write one account's snapshot: the scalar row always, plus a token-balance
     * row per held token. Both tables are ReplacingMergeTree keyed on `(account,
     * day[, asset])`, so a same-day re-sample overwrites in place.
     *
     * @param address - Base58 account.
     * @param sample - Normalized on-chain state from the provider.
     * @param day - UTC `YYYY-MM-DD` the snapshot is keyed under.
     */
    private async writeSnapshot(address: string, sample: IAccountSnapshotSample, day: string): Promise<void> {
        if (!this.clickhouse) {
            return;
        }
        const stamp = formatClickHouseDateTime64Utc(new Date());
        const scalarRow: IBalanceSnapshotRow = {
            account: address,
            day,
            captured_at: stamp,
            trx_balance_sun: sample.trxBalanceSun,
            staked_energy_sun: sample.stakedEnergySun,
            staked_bandwidth_sun: sample.stakedBandwidthSun,
            unstaking_sun: sample.unstakingSun,
            energy_limit: sample.energyLimit,
            energy_used: sample.energyUsed,
            net_limit: sample.netLimit,
            net_used: sample.netUsed,
            ingested_at: stamp
        };
        await this.clickhouse.insert<IBalanceSnapshotRow>(BALANCE_SNAPSHOTS_TABLE, [scalarRow], { waitForCommit: true });

        if (sample.tokenBalances.length > 0) {
            const tokenRows: ITokenBalanceRow[] = sample.tokenBalances.map((token) => ({
                account: address,
                day,
                asset: token.asset,
                raw_balance: token.rawBalance,
                ingested_at: stamp
            }));
            await this.clickhouse.insert<ITokenBalanceRow>(TOKEN_BALANCES_TABLE, tokenRows, { waitForCommit: true });
        }
    }

    /**
     * Capture a bounded slice of balance snapshots. Picks tracked, unpaused
     * accounts whose last snapshot day is not today, oldest snapshot day first
     * so selection rotates fairly across UTC days, probes each through the
     * provider, and writes its snapshot. A per-account failure is logged and
     * isolated so one bad account does not abort the tick.
     * See {@link IAccountHistoryService.runSnapshotTick}.
     */
    public async runSnapshotTick(): Promise<void> {
        if (!this.clickhouse || !this.provider) {
            return;
        }
        const provider = this.provider;
        const settings = await this.getSettings();
        if (!settings.ingestionEnabled) {
            return;
        }
        const today = new Date().toISOString().slice(0, 10);
        // One indexed query on PROGRESS: unpaused, not yet snapshotted today, oldest
        // snapshot first so the tick rotates fairly across UTC days instead of
        // starving accounts beyond the per-day ceiling. `lastSnapshotDay: {$ne: today}`
        // matches both an older day and a missing field (never snapshotted), which
        // also sorts first under ascending order; `paused: {$ne:true}` tolerates the
        // missing denormalized field on pre-migration docs.
        const due = await this.database
            .getCollection<IAccountProgressDoc>(PROGRESS_COLLECTION)
            .find({ paused: { $ne: true }, lastSnapshotDay: { $ne: today } })
            .sort({ lastSnapshotDay: 1 })
            .limit(settings.accountsPerTick)
            .toArray();

        for (const account of due) {
            try {
                const sample = await provider.fetchAccountSnapshot(account.address);
                await this.writeSnapshot(account.address, sample, today);
                await this.patchProgress(account.address, { lastSnapshotDay: today });
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                this.logger.error({ address: account.address, error: message }, 'Account-history balance snapshot failed');
            }
        }
    }

    /**
     * Ensure a progress document exists for an account, creating a queued one if
     * absent, and return the current state.
     *
     * @param address - Base58 address.
     * @returns The existing or newly created progress document.
     */
    private async ensureProgress(address: string): Promise<IAccountProgressDoc> {
        const collection = this.database.getCollection<IAccountProgressDoc>(PROGRESS_COLLECTION);
        const result = await collection.findOneAndUpdate(
            { address },
            { $setOnInsert: { address, status: 'queued', rowsIngested: 0, paused: false } },
            { upsert: true, returnDocument: 'after' }
        );
        const doc = (result && 'value' in result ? result.value : result) as IAccountProgressDoc;
        return doc;
    }

    /**
     * Apply a partial update to a progress document.
     *
     * @param address - Base58 address.
     * @param patch - Fields to set; `undefined` values are unset.
     */
    private async patchProgress(address: string, patch: Partial<IAccountProgressDoc>): Promise<void> {
        const set: Record<string, unknown> = {};
        const unset: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(patch)) {
            if (value === undefined) {
                unset[key] = '';
            } else {
                set[key] = value;
            }
        }
        const update: Record<string, unknown> = {};
        if (Object.keys(set).length > 0) {
            update.$set = set;
        }
        if (Object.keys(unset).length > 0) {
            update.$unset = unset;
        }
        await this.database.getCollection<IAccountProgressDoc>(PROGRESS_COLLECTION).updateOne({ address }, update, { upsert: true });
    }

    /**
     * Nudge admin listeners to refetch stats after an ingestion tick. Emits only
     * a timestamp, never the snapshot itself: this event is broadcast to every
     * connected socket (anonymous visitors included) with no room or auth gate,
     * while the {@link getStats} snapshot carries tracked-account addresses,
     * labels, and ingestion errors that the REST surface guards behind
     * `requireAdmin`. Admin clients refetch over that gated endpoint on this
     * signal, mirroring the `curation:changed` / `menu:update` nudges. Silently
     * skipped when no emitter is wired.
     */
    private async broadcastStats(): Promise<void> {
        if (!this.emitter) {
            return;
        }
        this.emitter.emit({ event: STATS_EVENT, payload: { at: Date.now() } });
    }

    /**
     * Convert a stored tracked-account document to the public shape.
     *
     * @param doc - The Mongo document.
     * @returns The public tracked-account record.
     */
    private static toTrackedAccount(doc: ITrackedAccountDoc): ITrackedAccount {
        return {
            address: doc.address,
            label: doc.label,
            paused: Boolean(doc.paused),
            addedAt: doc.addedAt,
            updatedAt: doc.updatedAt
        };
    }

    /**
     * Convert a stored progress document (or its absence) to the public shape,
     * yielding a zeroed `queued` record when ingestion never ran for the account.
     *
     * @param address - Base58 address the progress belongs to.
     * @param doc - The Mongo document, or undefined.
     * @returns The public progress record.
     */
    private static toProgress(address: string, doc: IAccountProgressDoc | undefined): IAccountIngestionProgress {
        if (!doc) {
            return { address, status: 'queued', rowsIngested: 0, catchingUp: false };
        }
        return {
            address,
            status: doc.status,
            cursorFingerprint: doc.cursorFingerprint,
            oldestTimestampReached: doc.oldestTimestampReached,
            newestTimestampSeen: doc.newestTimestampSeen,
            rowsIngested: doc.rowsIngested,
            lastRunAt: doc.lastRunAt,
            lastForwardRunAt: doc.lastForwardRunAt,
            // Mid-drain iff a forward continuation cursor is parked on either
            // endpoint. Surface only the boolean — the opaque fingerprints stay
            // internal, but the operator still learns the account is catching up.
            catchingUp: Boolean(doc.forwardTxCursor || doc.forwardTrc20Cursor),
            lastError: doc.lastError
        };
    }

    /**
     * Convert a ClickHouse row back to the source-independent domain contract,
     * coercing the driver's string-encoded Int64 columns to numbers and parsing
     * the native datetime literal.
     *
     * @param row - A ClickHouse result row.
     * @returns The transaction projection.
     */
    private static rowToBlockTransaction(row: IAccountTransactionRow): IBlockTransaction {
        const num = (value: unknown): number | undefined => {
            if (value === null || value === undefined) {
                return undefined;
            }
            const parsed = Number(value);
            return Number.isFinite(parsed) ? parsed : undefined;
        };

        const energyConsumed = num(row.energy_consumed);
        const energyFee = num(row.energy_fee_sun);
        const bandwidthConsumed = num(row.bandwidth_consumed);
        const bandwidthFee = num(row.bandwidth_fee_sun);

        // Rehydrate TRC20 token detail into contract.parameters (the open decoded-
        // ABI-args domain), mirroring how the trc20 provider mapping stored it, so
        // consumers get the token amount/symbol/decimals without IBlockTransaction
        // carrying token-specific fields.
        const tokenParameters = row.token_amount != null
            ? {
                value: String(row.token_amount),
                symbol: row.token_symbol ?? undefined,
                decimals: row.token_decimals ?? undefined
            }
            : undefined;

        const contract = row.contract_address
            ? {
                address: String(row.contract_address),
                method: row.contract_method ? String(row.contract_method) : undefined,
                parameters: tokenParameters
            }
            : undefined;

        const transaction: IBlockTransaction = {
            txId: String(row.tx_id),
            blockNumber: Number(row.block_number ?? 0),
            timestamp: parseClickHouseDateTime64Utc(String(row.timestamp)),
            type: String(row.type),
            status: String(row.status),
            from: { address: String(row.from_address) },
            to: { address: String(row.to_address) },
            amountSun: num(row.amount_sun),
            feeSun: num(row.fee_sun),
            energy: energyConsumed !== undefined || energyFee !== undefined
                ? { consumed: energyConsumed ?? 0, feeSun: energyFee ?? 0 }
                : undefined,
            bandwidth: bandwidthConsumed !== undefined || bandwidthFee !== undefined
                ? { consumed: bandwidthConsumed ?? 0, feeSun: bandwidthFee ?? 0 }
                : undefined,
            contract,
            memo: row.memo === null || row.memo === undefined ? null : String(row.memo)
        };
        return transaction;
    }
}
