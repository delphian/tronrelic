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
    IAddTrackedAccountInput,
    ITrackedAccount,
    IBlockTransaction,
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
    type IAccountHistorySettingsDoc,
    type IAccountProgressDoc,
    type IAccountTransactionRow,
    type ITrackedAccountDoc
} from '../database/index.js';
import type { IAccountHistoryProvider } from '../providers/IAccountHistoryProvider.js';
import { toAccountTransactionRow } from '../providers/trongrid-account-history.provider.js';
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

/** Base58 TRON mainnet address shape: leading `T`, 34 chars total. */
const TRON_ADDRESS_PATTERN = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;

/** WebSocket event name for live ingestion stats; must have a case in WebSocketService.emit(). */
const STATS_EVENT = 'account-history:stats';

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
        await this.setProgressStatus(address, paused ? 'paused' : 'queued');
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

        const stats: IAccountHistoryStats = {
            settings,
            accounts: accountStats,
            totals: {
                trackedAccounts: accounts.length,
                rowsIngested: accountStats.reduce((sum, a) => sum + a.progress.rowsIngested, 0),
                completeAccounts: accountStats.filter((a) => a.progress.status === 'complete').length,
                failedAccounts: accountStats.filter((a) => a.progress.status === 'failed').length
            }
        };
        return stats;
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

        const rows = await this.clickhouse.query<IAccountTransactionRow>(
            `SELECT account, tx_id, block_number, timestamp, type, status, from_address, to_address,
                    amount_sun, fee_sun, energy_consumed, energy_fee_sun, bandwidth_consumed, bandwidth_fee_sun,
                    contract_address, contract_method, memo
             FROM ${TRANSACTIONS_TABLE} FINAL
             WHERE account = {address:String}
             ORDER BY timestamp DESC
             LIMIT {limit:UInt32} OFFSET {offset:UInt32}`,
            { address, limit, offset }
        );

        const countRows = await this.clickhouse.query<{ total: string | number }>(
            `SELECT count(DISTINCT tx_id) AS total FROM ${TRANSACTIONS_TABLE} WHERE account = {address:String}`,
            { address }
        );

        const page: IAccountTransactionPage = {
            transactions: rows.map(AccountHistoryService.rowToBlockTransaction),
            total: Number(countRows[0]?.total ?? 0)
        };
        return page;
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
        const tracked = await this.database
            .getCollection<ITrackedAccountDoc>(TRACKED_COLLECTION)
            .find({ paused: { $ne: true } })
            .toArray();
        if (tracked.length === 0) {
            return [];
        }

        const progressDocs = await this.database
            .getCollection<IAccountProgressDoc>(PROGRESS_COLLECTION)
            .find({ address: { $in: tracked.map((t) => t.address) } })
            .toArray();
        const progressByAddress = new Map<string, IAccountProgressDoc>();
        for (const doc of progressDocs) {
            progressByAddress.set(doc.address, doc);
        }

        const eligible = tracked.filter((t) => progressByAddress.get(t.address)?.status !== 'complete');
        eligible.sort((a, b) => {
            const aRun = progressByAddress.get(a.address)?.lastRunAt?.getTime() ?? 0;
            const bRun = progressByAddress.get(b.address)?.lastRunAt?.getTime() ?? 0;
            return aRun - bRun;
        });

        const selected = eligible.slice(0, accountsPerTick).map((t) => t.address);
        return selected;
    }

    /**
     * Walk up to `pages` pages for one account, writing each page to ClickHouse
     * and advancing the cursor only after a clean write. On error the cursor is
     * left untouched so the next tick retries the same page.
     *
     * @param address - Base58 account to ingest.
     * @param pages - Maximum pages to pull this tick.
     */
    private async ingestAccount(address: string, pages: number): Promise<void> {
        const progress = await this.ensureProgress(address);
        await this.patchProgress(address, { status: 'running', lastRunAt: new Date(), lastError: undefined });

        let fingerprint = progress.cursorFingerprint;
        let rowsThisTick = 0;
        let oldest = progress.oldestTimestampReached;
        let newest = progress.newestTimestampSeen;

        try {
            for (let page = 0; page < pages; page++) {
                const result = await this.provider!.fetchPage(address, { limit: PROVIDER_PAGE_LIMIT, fingerprint });
                if (result.transactions.length > 0) {
                    await this.writeTransactions(address, result.transactions);
                    rowsThisTick += result.transactions.length;
                    for (const tx of result.transactions) {
                        if (!newest || tx.timestamp > newest) {
                            newest = tx.timestamp;
                        }
                        if (!oldest || tx.timestamp < oldest) {
                            oldest = tx.timestamp;
                        }
                    }
                }

                fingerprint = result.nextFingerprint;
                if (!fingerprint) {
                    await this.patchProgress(address, {
                        status: 'complete',
                        cursorFingerprint: undefined,
                        rowsIngested: progress.rowsIngested + rowsThisTick,
                        oldestTimestampReached: oldest,
                        newestTimestampSeen: newest
                    });
                    this.logger.info({ address, rowsThisTick }, 'Account-history backfill complete for account');
                    return;
                }
            }

            await this.patchProgress(address, {
                status: 'queued',
                cursorFingerprint: fingerprint,
                rowsIngested: progress.rowsIngested + rowsThisTick,
                oldestTimestampReached: oldest,
                newestTimestampSeen: newest
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            this.logger.error({ address, error: message }, 'Account-history ingestion failed for account');
            await this.patchProgress(address, {
                status: 'failed',
                lastError: message,
                rowsIngested: progress.rowsIngested + rowsThisTick,
                oldestTimestampReached: oldest,
                newestTimestampSeen: newest
            });
        }
    }

    /**
     * Project and insert a page of transactions into ClickHouse. ReplacingMergeTree
     * makes the insert idempotent on `(account, timestamp, tx_id)`.
     *
     * @param address - The tracked account these rows belong to.
     * @param transactions - Normalized transactions to store.
     */
    private async writeTransactions(address: string, transactions: IBlockTransaction[]): Promise<void> {
        const ingestedAt = formatClickHouseDateTime64Utc(new Date());
        const rows = transactions.map((tx) =>
            toAccountTransactionRow(address, tx, formatClickHouseDateTime64Utc(tx.timestamp), ingestedAt)
        );
        await this.clickhouse!.insert<IAccountTransactionRow>(TRANSACTIONS_TABLE, rows);
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
        const existing = await collection.findOne({ address });
        if (existing) {
            return existing;
        }
        const fresh: IAccountProgressDoc = { address, status: 'queued', rowsIngested: 0 };
        await collection.updateOne({ address }, { $setOnInsert: fresh }, { upsert: true });
        return fresh;
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
     * Force a progress status, used when pausing/resuming an account.
     *
     * @param address - Base58 address.
     * @param status - The status to set.
     */
    private async setProgressStatus(address: string, status: IAccountProgressDoc['status']): Promise<void> {
        await this.ensureProgress(address);
        await this.patchProgress(address, { status });
    }

    /**
     * Broadcast the current stats snapshot to admin listeners. Silently skipped
     * when no emitter is wired.
     */
    private async broadcastStats(): Promise<void> {
        if (!this.emitter) {
            return;
        }
        const stats = await this.getStats();
        this.emitter.emit({ event: STATS_EVENT, payload: stats });
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
            return { address, status: 'queued', rowsIngested: 0 };
        }
        return {
            address,
            status: doc.status,
            cursorFingerprint: doc.cursorFingerprint,
            oldestTimestampReached: doc.oldestTimestampReached,
            newestTimestampSeen: doc.newestTimestampSeen,
            rowsIngested: doc.rowsIngested,
            lastRunAt: doc.lastRunAt,
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
            contract: row.contract_address
                ? { address: String(row.contract_address), method: row.contract_method ? String(row.contract_method) : undefined }
                : undefined,
            memo: row.memo === null || row.memo === undefined ? null : String(row.memo)
        };
        return transaction;
    }
}
