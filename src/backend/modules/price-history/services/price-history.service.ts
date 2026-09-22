/**
 * @fileoverview The single authority for the local daily price series.
 *
 * Why this exists: valuation and PnL must never make a live external price call
 * on a page load, so this service backfills daily USD prices into ClickHouse on a
 * schedule and serves every downstream read from local storage. Prices are
 * immutable, so the work is a bounded, resumable *backward* backfill (seed the
 * dense recent window in one ranged call, then walk the deep past one chunk at
 * a time) plus a cheap daily *forward* append — the same ingestion discipline
 * the account-history module uses, and for the same reason: respect the
 * external rate budget while guaranteeing eventual full coverage.
 *
 * The service sees one `IPriceHistoryProvider`. In production that is the
 * routing provider, which tries the operator's ordered vendors per asset class,
 * so this file never learns which vendor priced what beyond the `source` each
 * point carries.
 *
 * All access routes through this singleton; the ClickHouse `price_history` table
 * and the Mongo cursor collections are reached only here. Published on the
 * service registry as `'price-history'`.
 */

import type {
    IDatabaseService,
    IClickHouseService,
    ISystemLogService,
    IWebSocketService,
    IPriceHistoryService,
    IPriceHistorySettings,
    IPriceHistoryStats,
    IPriceAssetCoverage,
    IPricePoint,
    IPriceSourceInfo,
    PriceAsset
} from '@/types';
import { PRICE_ASSET_TRX } from '@/types';
import type { IProviderRegistry, ISourcedPricePoint } from '../../providers/index.js';
import type { IPriceHistoryRouter } from '../providers/IPriceHistoryRouter.js';
import type { IPriceRangeOutcome } from '../providers/IPriceRangeOutcome.js';
import {
    SETTINGS_COLLECTION,
    PROGRESS_COLLECTION,
    PRICE_TABLE,
    SETTINGS_KEY,
    DEFAULT_SETTINGS,
    MAX_BACKFILL_DAYS,
    type IPriceAssetProgressDoc,
    type IPriceHistorySettingsDoc,
    type IPriceHistoryRow
} from '../database/index.js';
import { todayUtcDay, shiftUtcDay, diffUtcDays, previousUtcDay } from '../lib/price-day.js';
import { retryDelayMs, isRetryAtCeiling } from '../lib/retry-backoff.js';

/**
 * Width of the dense window seeded in the first ranged call for an asset. Kept
 * just under a year so a keyless CoinGecko caller, whose history is capped at
 * 365 days of age, can still seed a token in one call.
 */
const RECENT_WINDOW_DAYS = 360;

/**
 * Pause after a deep-backfill chunk so back-to-back manual runs stay inside
 * the vendors' rate budgets. One chunk per tick is the normal cadence, so this
 * only matters when an operator hammers the manual button.
 */
const BACKFILL_DELAY_MS = 1000;

/**
 * Bounds on the chunk width an operator may set. The ceiling matches the most
 * daily candles the pool vendor returns per call, so one chunk is never wider
 * than one call can serve.
 */
const CHUNK_DAYS_LIMITS = { min: 1, max: 1000 };

/** WebSocket event nudging the admin page to refetch; must have a case in WebSocketService.emit(). */
const STATS_EVENT = 'price-history:stats';

/** A representative token address used only to ask a vendor whether it prices tokens at all. */
const TOKEN_PROBE_ASSET = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';

/**
 * The two routing classes an asset falls into. Every asset in a class shares
 * the same vendor list, so once one asset of a class finds no vendor can be
 * asked, the tick knows the rest of that class would find the same.
 */
type AssetClass = 'trx' | 'token';

/** How one asset's seed attempt ended, as far as the tick's bookkeeping cares. */
type SeedResult = 'seeded' | 'parked' | 'unavailable';

/** How one deep-walk chunk ended, as far as the tick's bookkeeping cares. */
type ChunkResult = 'advanced' | 'complete' | 'parked' | 'unavailable';

/** Dependencies injected once at bootstrap. */
export interface IPriceHistoryServiceDependencies {
    /** Mongo access for cursor/settings state. */
    database: IDatabaseService;
    /** ClickHouse access for the price series; undefined when not configured. */
    clickhouse: IClickHouseService | undefined;
    /** The routed price source — the routing provider in production. */
    provider: IPriceHistoryRouter;
    /** The vendor registry, read to list the sources the routing settings may name. */
    registry: IProviderRegistry;
    /** Optional emitter for live admin stats; undefined silently skips broadcasts. */
    emitter: IWebSocketService | undefined;
    /** Child logger for ingestion diagnostics. */
    logger: ISystemLogService;
}

/**
 * One ClickHouse row of an asset's per-day count, used to build coverage stats
 * without scanning the whole table per asset.
 */
interface IAssetCountRow {
    asset: string;
    day_count: number;
    oldest_day: string | null;
    newest_day: string | null;
}

/**
 * Singleton service backing all price reads and the ingestion ticks.
 */
export class PriceHistoryService implements IPriceHistoryService {
    private static instance: PriceHistoryService | null = null;

    private readonly database: IDatabaseService;
    private readonly clickhouse: IClickHouseService | undefined;
    private readonly provider: IPriceHistoryRouter;
    private readonly registry: IProviderRegistry;
    private readonly emitter: IWebSocketService | undefined;
    private readonly logger: ISystemLogService;

    /**
     * Provider fetch calls attempted since process start. In-memory by design:
     * the signal is "is the provider healthy right now", not an audit trail, so
     * a restart resetting it is acceptable and keeps the counter free of storage.
     */
    private providerCalls = 0;

    /** Provider fetch calls that failed since process start (see {@link providerCalls}). */
    private providerErrors = 0;

    /**
     * @param deps - Injected collaborators; private so the singleton owns
     *   construction.
     */
    private constructor(deps: IPriceHistoryServiceDependencies) {
        this.database = deps.database;
        this.clickhouse = deps.clickhouse;
        this.provider = deps.provider;
        this.registry = deps.registry;
        this.emitter = deps.emitter;
        this.logger = deps.logger;
    }

    /**
     * Broadcast a timestamp-only nudge so the admin page refetches coverage over
     * its requireAdmin REST endpoint. No-op when no emitter is wired (WebSockets
     * disabled or tests). The payload never carries data — admin-only detail
     * stays behind the gated read.
     */
    private emitStats(): void {
        this.emitter?.emit({ event: STATS_EVENT, payload: { at: Date.now() } });
    }

    /**
     * Wire dependencies on first call; subsequent calls are ignored so every
     * consumer shares one instance and one cursor view.
     *
     * @param deps - Injected collaborators.
     */
    public static setDependencies(deps: IPriceHistoryServiceDependencies): void {
        if (!PriceHistoryService.instance) {
            PriceHistoryService.instance = new PriceHistoryService(deps);
        }
    }

    /**
     * Retrieve the configured singleton.
     *
     * @returns The shared instance.
     * @throws If {@link setDependencies} has not run.
     */
    public static getInstance(): PriceHistoryService {
        if (!PriceHistoryService.instance) {
            throw new Error('PriceHistoryService.setDependencies() must be called before getInstance()');
        }
        return PriceHistoryService.instance;
    }

    /**
     * Format an instant as ClickHouse `DateTime64(3,'UTC')` literal. The client
     * expects `YYYY-MM-DD HH:MM:SS.sss`, not ISO with `T`/`Z`.
     *
     * @param date - The instant to format.
     * @returns The ClickHouse-formatted UTC datetime string.
     */
    private static formatVersionColumn(date: Date): string {
        return date.toISOString().replace('T', ' ').replace('Z', '');
    }

    /**
     * Non-blocking pause used to throttle back-to-back deep-backfill chunks.
     *
     * @param ms - Milliseconds to wait.
     * @returns A promise resolving after the delay.
     */
    private static delay(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    /**
     * Run one provider fetch through the rolling health counters: every call
     * increments the attempt count, a throw increments the error count and
     * rethrows unchanged so the caller's failure handling (cursor persistence,
     * scheduler failure record) is untouched. Wrapping here keeps the counting
     * in one place instead of at each provider call site.
     *
     * @param fetch - The provider call to run.
     * @returns Whatever the provider call resolves to.
     */
    private async countProviderCall<T>(fetch: () => Promise<T>): Promise<T> {
        this.providerCalls += 1;
        try {
            return await fetch();
        } catch (error) {
            this.providerErrors += 1;
            throw error;
        }
    }

    /**
     * The fresh cursor an asset starts from, used both when an asset is first
     * tracked and when an operator resets one.
     *
     * @param asset - The asset the cursor belongs to.
     * @returns A progress document with nothing fetched yet.
     */
    private static freshProgress(asset: PriceAsset): IPriceAssetProgressDoc {
        return {
            asset,
            recentSeeded: false,
            oldestDayFetched: null,
            newestDayFetched: null,
            backfillComplete: false,
            source: null,
            sourceRef: null,
            unpricedAttempts: 0,
            nextAttemptAt: null,
            updatedAt: new Date()
        };
    }

    /**
     * Which routing class an asset belongs to, so the tick can group assets
     * that share a vendor list.
     *
     * @param asset - The asset to classify.
     * @returns `trx` for the native coin, `token` for any contract address.
     */
    private static assetClass(asset: PriceAsset): AssetClass {
        return asset === PRICE_ASSET_TRX ? 'trx' : 'token';
    }

    /**
     * Idempotently ensure a single tracked-asset cursor exists. Called for TRX at
     * boot and for token contracts the valuation engine reports holding.
     *
     * @param asset - The asset to track.
     */
    private async ensureAssetProgress(asset: PriceAsset): Promise<void> {
        const collection = this.database.getCollection<IPriceAssetProgressDoc>(PROGRESS_COLLECTION);
        await collection.updateOne(
            { asset },
            { $setOnInsert: PriceHistoryService.freshProgress(asset) },
            { upsert: true }
        );
    }

    /**
     * Persist a cursor mutation, stamping `updatedAt` for least-recently-advanced
     * selection.
     *
     * @param asset - The asset whose cursor changed.
     * @param patch - Fields to set.
     */
    private async patchAssetProgress(asset: PriceAsset, patch: Partial<IPriceAssetProgressDoc>): Promise<void> {
        const collection = this.database.getCollection<IPriceAssetProgressDoc>(PROGRESS_COLLECTION);
        await collection.updateOne({ asset }, { $set: { ...patch, updatedAt: new Date() } });
    }

    /**
     * Read all tracked-asset cursors, filling in the fields a document written
     * before the retry and source columns existed would lack, so every reader
     * sees a complete cursor.
     *
     * @returns Every progress doc.
     */
    private async listAssetProgress(): Promise<IPriceAssetProgressDoc[]> {
        const collection = this.database.getCollection<IPriceAssetProgressDoc>(PROGRESS_COLLECTION);
        const docs = await collection.find({}).toArray();
        return docs.map((doc) => ({
            ...doc,
            source: doc.source ?? null,
            sourceRef: doc.sourceRef ?? null,
            unpricedAttempts: typeof doc.unpricedAttempts === 'number' ? doc.unpricedAttempts : 0,
            nextAttemptAt: doc.nextAttemptAt ? new Date(doc.nextAttemptAt) : null
        }));
    }

    /**
     * Whether an asset's backoff has elapsed, so a tick may fetch for it again.
     * An asset that has never been parked is always due.
     *
     * @param doc - The asset's cursor.
     * @param now - The tick's notion of the current time, in milliseconds.
     * @returns True when the asset may be fetched this tick.
     */
    private static isDue(doc: IPriceAssetProgressDoc, now: number): boolean {
        return !doc.nextAttemptAt || doc.nextAttemptAt.getTime() <= now;
    }

    /**
     * Park an asset after a fetch that returned no prices, in either phase.
     * The attempt count drives a progressive backoff so the vendors are not
     * re-asked every tick, and once the backoff has reached its daily ceiling
     * each further unpriced attempt is logged as an error naming the phase and
     * which vendors were asked or skipped, so an asset that stays unpriced for
     * more than a day shows up on the logs page rather than only in the
     * coverage table. The count is incremented atomically so a manual run
     * overlapping a scheduled tick cannot lose an attempt; the delay is
     * computed from the tick's snapshot, which in that rare overlap lags by
     * one step and nothing more.
     *
     * @param doc - The asset's cursor as the tick read it.
     * @param phase - Which fetch found nothing, for the log entry.
     * @param outcome - The router's report, for the log entry.
     * @param fromDay - Inclusive start of the range that was asked for.
     * @param toDay - Inclusive end of the range that was asked for.
     */
    private async parkAsset(
        doc: IPriceAssetProgressDoc,
        phase: 'seed' | 'backfill',
        outcome: IPriceRangeOutcome,
        fromDay: string,
        toDay: string
    ): Promise<void> {
        const attempts = doc.unpricedAttempts + 1;
        const nextAttemptAt = new Date(Date.now() + retryDelayMs(attempts));
        const collection = this.database.getCollection<IPriceAssetProgressDoc>(PROGRESS_COLLECTION);
        await collection.updateOne(
            { asset: doc.asset },
            {
                $set: { nextAttemptAt, updatedAt: new Date() },
                $inc: { unpricedAttempts: 1 }
            }
        );
        const detail = {
            asset: doc.asset,
            phase,
            verdict: outcome.verdict,
            asked: outcome.asked,
            skipped: outcome.skipped,
            fromDay,
            toDay,
            attempts,
            nextAttemptAt
        };
        if (isRetryAtCeiling(attempts)) {
            this.logger.error(detail, 'Asset still unpriced after the retry backoff reached its daily ceiling');
        } else {
            this.logger.info(detail, 'No price returned; asset parked for retry');
        }
    }

    /**
     * Project price points to ClickHouse rows and durably insert them. Stamping a
     * fresh `fetched_at` lets ReplacingMergeTree treat a re-fetch of the same
     * `(asset, day)` as an overwrite, so retries and overlapping ranges are
     * idempotent. Each row records the vendor that produced its point.
     *
     * @param points - Daily points to store; a no-op when empty.
     */
    private async insertPoints(points: ISourcedPricePoint[]): Promise<void> {
        if (!this.clickhouse || points.length === 0) {
            return;
        }
        const fetchedAt = PriceHistoryService.formatVersionColumn(new Date());
        const rows: IPriceHistoryRow[] = points.map((point) => ({
            asset: point.asset,
            day: point.day,
            price_usd: point.priceUsd,
            source: point.source,
            fetched_at: fetchedAt
        }));
        await this.clickhouse.insert<IPriceHistoryRow>(PRICE_TABLE, rows, { waitForCommit: true });
    }

    /**
     * Read one asset's price on one day. Null means "not stored / unpriced",
     * never zero — callers treat an unlisted asset as excluded, not worthless.
     *
     * @param asset - The asset to price.
     * @param day - UTC `YYYY-MM-DD`.
     * @returns The closing USD price, or null.
     */
    async getPriceOn(asset: PriceAsset, day: string): Promise<number | null> {
        if (!this.clickhouse) {
            return null;
        }
        const rows = await this.clickhouse.query<{ price_usd: number }>(
            `SELECT price_usd FROM ${PRICE_TABLE} FINAL WHERE asset = {asset:String} AND day = {day:Date} LIMIT 1`,
            { asset, day }
        );
        return rows.length > 0 ? rows[0].price_usd : null;
    }

    /**
     * Batch one asset's prices for an explicit day set. Implemented as a single
     * bounded range scan (min..max of the requested days) filtered to the set, so
     * valuing a transaction feed costs one query rather than one per row.
     *
     * @param asset - The asset to price.
     * @param days - UTC `YYYY-MM-DD` days to look up.
     * @returns Stored points for the requested days; missing days omitted.
     */
    async getPricesForDays(asset: PriceAsset, days: string[]): Promise<IPricePoint[]> {
        if (!this.clickhouse || days.length === 0) {
            return [];
        }
        const sorted = [...days].sort();
        const wanted = new Set(days);
        const series = await this.getSeries(asset, sorted[0], sorted[sorted.length - 1]);
        return series.filter((point) => wanted.has(point.day));
    }

    /**
     * Read a contiguous daily series, oldest first — the price track for the
     * balance-over-time chart.
     *
     * @param asset - The asset to price.
     * @param fromDay - Inclusive start UTC `YYYY-MM-DD`.
     * @param toDay - Inclusive end UTC `YYYY-MM-DD`.
     * @returns Points in range, oldest first.
     */
    async getSeries(asset: PriceAsset, fromDay: string, toDay: string): Promise<IPricePoint[]> {
        if (!this.clickhouse) {
            return [];
        }
        const rows = await this.clickhouse.query<{ day: string; price_usd: number }>(
            `SELECT day, price_usd FROM ${PRICE_TABLE} FINAL
             WHERE asset = {asset:String} AND day >= {fromDay:Date} AND day <= {toDay:Date}
             ORDER BY day ASC`,
            { asset, fromDay, toDay }
        );
        return rows.map((row) => ({ asset, day: row.day, priceUsd: row.price_usd }));
    }

    /**
     * Register token assets for backfill. Idempotent; TRX is implicit. The
     * valuation engine calls this with the contracts a user actually held so the
     * tracked set widens only to assets that need pricing.
     *
     * @param assets - TRC20 contract addresses to ensure tracked.
     */
    async ensureAssetsTracked(assets: PriceAsset[]): Promise<void> {
        for (const asset of assets) {
            if (asset && asset !== PRICE_ASSET_TRX) {
                await this.ensureAssetProgress(asset);
            }
        }
    }

    /**
     * Shape a stored settings document into the published settings, filling in
     * defaults for fields added after the document was written (a document from
     * before routing existed carries no source lists) and ignoring retired ones.
     *
     * @param doc - The stored document, or null before first access.
     * @returns Complete settings.
     */
    private static settingsFromDoc(doc: Partial<IPriceHistorySettingsDoc> | null): IPriceHistorySettings {
        return {
            ingestionEnabled: doc?.ingestionEnabled ?? DEFAULT_SETTINGS.ingestionEnabled,
            chunkDays: typeof doc?.chunkDays === 'number' ? doc.chunkDays : DEFAULT_SETTINGS.chunkDays,
            tokensPerTick: typeof doc?.tokensPerTick === 'number' ? doc.tokensPerTick : DEFAULT_SETTINGS.tokensPerTick,
            trxSources: Array.isArray(doc?.trxSources) ? doc.trxSources : [...DEFAULT_SETTINGS.trxSources],
            tokenSources: Array.isArray(doc?.tokenSources) ? doc.tokenSources : [...DEFAULT_SETTINGS.tokenSources]
        };
    }

    /**
     * Read settings, seeding defaults on first access.
     *
     * @returns Effective settings.
     */
    async getSettings(): Promise<IPriceHistorySettings> {
        const collection = this.database.getCollection<IPriceHistorySettingsDoc>(SETTINGS_COLLECTION);
        const existing = await collection.findOne({ key: SETTINGS_KEY });
        if (existing) {
            return PriceHistoryService.settingsFromDoc(existing);
        }
        await collection.updateOne(
            { key: SETTINGS_KEY },
            { $setOnInsert: { key: SETTINGS_KEY, ...DEFAULT_SETTINGS, updatedAt: new Date() } },
            { upsert: true }
        );
        return PriceHistoryService.settingsFromDoc(null);
    }

    /**
     * Keep a source list to vendor ids that exist and declare the capability,
     * de-duplicated in the operator's order. An id that names nothing is
     * dropped rather than stored, so a typo cannot silently route an asset
     * class to no vendor at all.
     *
     * @param sources - The operator's list.
     * @returns The cleaned list.
     */
    private sanitizeSources(sources: unknown): string[] {
        if (!Array.isArray(sources)) {
            return [];
        }
        const known = new Set(this.registry.listVendorsWithCapability('price-history').map((vendor) => vendor.descriptor.id));
        const cleaned: string[] = [];
        for (const entry of sources) {
            if (typeof entry === 'string' && known.has(entry) && !cleaned.includes(entry)) {
                cleaned.push(entry);
            }
        }
        return cleaned;
    }

    /**
     * Merge settings; only supplied fields change. Numeric dials are bounded so
     * a chunk can never exceed what one vendor call can serve, and source lists
     * are reduced to registered vendors.
     *
     * @param patch - Partial settings.
     * @returns Settings after the merge.
     * @throws When a supplied numeric dial is not a whole number in range.
     */
    async updateSettings(patch: Partial<IPriceHistorySettings>): Promise<IPriceHistorySettings> {
        const current = await this.getSettings();
        const next: IPriceHistorySettings = { ...current };
        if (patch.ingestionEnabled !== undefined) {
            next.ingestionEnabled = patch.ingestionEnabled === true;
        }
        if (patch.chunkDays !== undefined) {
            const chunkDays = Number(patch.chunkDays);
            if (!Number.isInteger(chunkDays) || chunkDays < CHUNK_DAYS_LIMITS.min || chunkDays > CHUNK_DAYS_LIMITS.max) {
                throw new Error(`chunkDays must be a whole number between ${CHUNK_DAYS_LIMITS.min} and ${CHUNK_DAYS_LIMITS.max}`);
            }
            next.chunkDays = chunkDays;
        }
        if (patch.tokensPerTick !== undefined) {
            const tokensPerTick = Number(patch.tokensPerTick);
            if (!Number.isInteger(tokensPerTick) || tokensPerTick < 1) {
                throw new Error('tokensPerTick must be a whole number of at least 1');
            }
            next.tokensPerTick = tokensPerTick;
        }
        if (patch.trxSources !== undefined) {
            next.trxSources = this.sanitizeSources(patch.trxSources);
        }
        if (patch.tokenSources !== undefined) {
            next.tokenSources = this.sanitizeSources(patch.tokenSources);
        }
        const collection = this.database.getCollection<IPriceHistorySettingsDoc>(SETTINGS_COLLECTION);
        await collection.updateOne(
            { key: SETTINGS_KEY },
            { $set: { ...next, updatedAt: new Date() } },
            { upsert: true }
        );
        return next;
    }

    /**
     * List the vendors that declare the price-history capability, with what each
     * can serve and whether it is switched on, for the routing settings form.
     *
     * @returns One entry per vendor, in registration order.
     */
    async getPriceSources(): Promise<IPriceSourceInfo[]> {
        const vendors = this.registry.listVendorsWithCapability('price-history');
        return Promise.all(
            vendors.map(async (vendor) => ({
                id: vendor.descriptor.id,
                label: vendor.descriptor.label,
                supportsTrx: vendor.priceHistory?.supportsAsset(PRICE_ASSET_TRX) ?? false,
                supportsTokens: vendor.priceHistory?.supportsAsset(TOKEN_PROBE_ASSET) ?? false,
                enabled: await vendor.isEnabled()
            }))
        );
    }

    /**
     * Clear one asset's cursor so the next tick seeds it again, and tell the
     * provider to forget whatever it remembered about the asset. Stored prices
     * are kept; a re-fetch overwrites the same `(asset, day)` in place.
     *
     * @param asset - The asset to reset.
     */
    async resetAsset(asset: PriceAsset): Promise<void> {
        if (!asset) {
            throw new Error('An asset is required');
        }
        const collection = this.database.getCollection<IPriceAssetProgressDoc>(PROGRESS_COLLECTION);
        // Only a tracked asset can be reset. Upserting here would let a typo in
        // the route param create a cursor for a string no vendor can price, which
        // every tick would then spend seed budget on.
        const existing = await collection.findOne({ asset });
        if (!existing) {
            throw new Error(`Asset ${asset} is not tracked`);
        }
        await collection.updateOne({ asset }, { $set: PriceHistoryService.freshProgress(asset) });
        this.provider.forgetAsset(asset);
        this.logger.info({ asset }, 'Price-history cursor reset');
        this.emitStats();
    }

    /**
     * Build the coverage snapshot for the admin surface. Per-asset bounds and day
     * counts come from one grouped ClickHouse aggregate; the seed/complete flags,
     * the source, and the retry state come from the Mongo cursors.
     *
     * @returns Settings, per-asset coverage, and cross-asset rollups.
     */
    async getStats(): Promise<IPriceHistoryStats> {
        const settings = await this.getSettings();
        const progress = await this.listAssetProgress();

        const counts = new Map<string, IAssetCountRow>();
        if (this.clickhouse) {
            const rows = await this.clickhouse.query<IAssetCountRow>(
                `SELECT asset,
                        count() AS day_count,
                        toString(min(day)) AS oldest_day,
                        toString(max(day)) AS newest_day
                 FROM ${PRICE_TABLE} FINAL
                 GROUP BY asset`
            );
            for (const row of rows) {
                counts.set(row.asset, row);
            }
        }

        const floorDay = shiftUtcDay(todayUtcDay(), -MAX_BACKFILL_DAYS);
        const assets: IPriceAssetCoverage[] = progress.map((doc) => {
            const count = counts.get(doc.asset);
            const oldestDay = count?.oldest_day ?? doc.oldestDayFetched;
            // Backfill ETA input: days the deep walk still has to cover before
            // the lookback floor — 0 once complete, null before a cursor exists.
            // The listing date may end the walk earlier, so this is a ceiling,
            // which is the honest bound an operator can plan against.
            const estimatedDaysRemaining = doc.backfillComplete
                ? 0
                : oldestDay
                    ? Math.max(0, diffUtcDays(floorDay, oldestDay))
                    : null;
            return {
                asset: doc.asset,
                oldestDay,
                newestDay: count?.newest_day ?? doc.newestDayFetched,
                dayCount: count?.day_count ?? 0,
                recentSeeded: doc.recentSeeded,
                backfillComplete: doc.backfillComplete,
                estimatedDaysRemaining,
                source: doc.source,
                sourceRef: doc.sourceRef,
                unpricedAttempts: doc.unpricedAttempts,
                nextAttemptAt: doc.nextAttemptAt ? doc.nextAttemptAt.toISOString() : null
            };
        });

        const oldestDay = assets.reduce<string | null>(
            (min, a) => (a.oldestDay && (!min || a.oldestDay < min) ? a.oldestDay : min),
            null
        );
        const newestDay = assets.reduce<string | null>(
            (max, a) => (a.newestDay && (!max || a.newestDay > max) ? a.newestDay : max),
            null
        );

        const staleThreshold = shiftUtcDay(todayUtcDay(), -1);
        const staleAssets = assets.filter(
            (asset) => asset.recentSeeded && (!asset.newestDay || asset.newestDay < staleThreshold)
        ).length;

        return {
            settings,
            assets,
            totals: {
                assetCount: assets.length,
                oldestDay,
                newestDay,
                staleAssets,
                providerCalls: this.providerCalls,
                providerErrors: this.providerErrors
            }
        };
    }

    /**
     * Seed an asset's dense recent window in one ranged call. A priced answer
     * records the day bounds and the serving vendor and flips `recentSeeded`.
     * An answer with no prices, whether every vendor was asked or one was
     * skipped as disabled, parks the asset under the progressive backoff
     * instead, so a vendor added or enabled later picks it up on its own and
     * the seed budget is not spent re-asking every tick. When no vendor could
     * be asked at all the cursor is left exactly as it was: nothing was
     * learned, so nothing is counted against the asset. A vendor failure
     * throws through, leaving the cursor untouched for the next tick.
     *
     * The oldest bound is the oldest day actually returned, not the window
     * start. The winning vendor may only cover the tail of the window (an
     * aggregator that listed the token recently), and a later vendor in the
     * routing order may hold the days before that. Booking the window start
     * would move the deep walk past those days and leave a permanent gap the
     * forward append can never fill.
     *
     * @param doc - The cursor of the asset to seed.
     * @returns How the seed ended, so the tick can count real seeding work
     *   toward its budget and stop asking for a class no vendor can serve.
     */
    private async seedRecentWindow(doc: IPriceAssetProgressDoc): Promise<SeedResult> {
        const today = todayUtcDay();
        const fromDay = shiftUtcDay(today, -RECENT_WINDOW_DAYS);
        const outcome = await this.countProviderCall(() => this.provider.fetchRange(doc.asset, fromDay, today));
        let result: SeedResult;
        if (outcome.verdict === 'unavailable') {
            result = 'unavailable';
        } else if (outcome.verdict !== 'priced') {
            await this.parkAsset(doc, 'seed', outcome, fromDay, today);
            result = 'parked';
        } else {
            const points = outcome.points;
            await this.insertPoints(points);
            await this.patchAssetProgress(doc.asset, {
                recentSeeded: true,
                oldestDayFetched: points[0].day,
                newestDayFetched: points[points.length - 1].day,
                source: points[0].source,
                sourceRef: points[0].sourceRef ?? null,
                unpricedAttempts: 0,
                nextAttemptAt: null
            });
            this.logger.info({ asset: doc.asset, seeded: points.length, source: points[0].source }, 'Seeded recent price window');
            result = 'seeded';
        }
        return result;
    }

    /**
     * Walk one asset's deep past by one chunk: fetch the `chunkDays` ending the
     * day before the oldest day already covered, store what comes back, and
     * move the cursor to the oldest day returned. A chunk every eligible vendor
     * was asked about and none could price is read as the asset's listing date
     * and marks `backfillComplete`; so does reaching the
     * {@link MAX_BACKFILL_DAYS} floor. A chunk that came back without prices
     * while a vendor was skipped as disabled is not final, because the skipped
     * vendor may hold it, so the asset is parked under the backoff with its
     * cursor untouched and is walked again once the vendor is back. When no
     * vendor could be asked at all the cursor is left as it was. The cursor
     * advances only after a clean write, so a failed tick resumes without
     * re-fetching.
     *
     * The cursor moves to the oldest day actually returned, not the chunk
     * start, for the same reason the seed does: the winning vendor may only
     * cover the tail of the chunk (an aggregator whose listing date falls
     * inside it), and a later vendor in the routing order may hold the days
     * before that. Booking the chunk start would skip those days for good,
     * because the next chunk starts where this one did. Booking the oldest
     * returned day makes the next chunk ask the vendors about the untouched
     * days instead, and progress is still guaranteed since every returned day
     * is older than the previous cursor.
     *
     * @param doc - The asset's current cursor; must carry an oldest day.
     * @param chunkDays - Width of the range to fetch this tick.
     * @returns How the chunk ended, so the tick can move on to another asset
     *   when this one's class has no vendor to ask.
     */
    private async backfillDeepHistory(doc: IPriceAssetProgressDoc, chunkDays: number): Promise<ChunkResult> {
        const floorDay = shiftUtcDay(todayUtcDay(), -MAX_BACKFILL_DAYS);
        const toDay = previousUtcDay(doc.oldestDayFetched as string);
        let result: ChunkResult;
        if (diffUtcDays(floorDay, toDay) < 0) {
            await this.patchAssetProgress(doc.asset, { backfillComplete: true, unpricedAttempts: 0, nextAttemptAt: null });
            this.logger.info({ asset: doc.asset, floorDay }, 'Backfill reached lookback floor');
            result = 'complete';
        } else {
            const chunkStart = shiftUtcDay(toDay, -(chunkDays - 1));
            const fromDay = diffUtcDays(floorDay, chunkStart) < 0 ? floorDay : chunkStart;
            const outcome = await this.countProviderCall(() => this.provider.fetchRange(doc.asset, fromDay, toDay));
            if (outcome.verdict === 'unavailable') {
                result = 'unavailable';
            } else if (outcome.verdict === 'inconclusive') {
                await this.parkAsset(doc, 'backfill', outcome, fromDay, toDay);
                result = 'parked';
            } else if (outcome.verdict === 'empty') {
                await this.patchAssetProgress(doc.asset, { backfillComplete: true, unpricedAttempts: 0, nextAttemptAt: null });
                this.logger.info({ asset: doc.asset, fromDay, toDay, asked: outcome.asked }, 'Backfill reached asset listing (no earlier price)');
                result = 'complete';
            } else {
                const points = outcome.points;
                await this.insertPoints(points);
                await this.patchAssetProgress(doc.asset, {
                    oldestDayFetched: points[0].day,
                    source: points[0].source,
                    sourceRef: points[0].sourceRef ?? null,
                    unpricedAttempts: 0,
                    nextAttemptAt: null
                });
                this.logger.info({ asset: doc.asset, fromDay, toDay, oldestDay: points[0].day, points: points.length, source: points[0].source }, 'Backfilled price chunk');
                await PriceHistoryService.delay(BACKFILL_DELAY_MS);
                result = 'advanced';
            }
        }
        return result;
    }

    /**
     * Advance the backward backfill one bounded slice: ensure TRX is tracked, seed
     * any un-seeded asset whose backoff has elapsed (TRX first, then up to
     * `tokensPerTick` tokens), then spend the tick fetching one chunk of the
     * least-recently-advanced incomplete asset's deep history.
     *
     * An asset class no vendor can be asked for is skipped for the rest of the
     * tick as soon as one of its assets reports that, without counting an
     * attempt against any of them: every asset in the class shares the vendor
     * list, so asking again would only repeat the answer. One warning names
     * the skipped assets so the operator can see the class is switched off.
     */
    async runBackfillTick(): Promise<void> {
        const settings = await this.getSettings();
        if (!settings.ingestionEnabled || !this.clickhouse) {
            return;
        }
        await this.ensureAssetProgress(PRICE_ASSET_TRX);

        const now = Date.now();
        const progress = await this.listAssetProgress();
        const unseeded = progress.filter((doc) => !doc.recentSeeded && PriceHistoryService.isDue(doc, now));
        // TRX is seeded whenever it is due and never counts against the token
        // budget; the token slice is bounded by `tokensPerTick` on its own, so
        // the setting means what it says whether or not TRX is already seeded.
        const seedBudget = [
            ...unseeded.filter((doc) => doc.asset === PRICE_ASSET_TRX),
            ...unseeded.filter((doc) => doc.asset !== PRICE_ASSET_TRX).slice(0, settings.tokensPerTick)
        ];
        const failures: Array<{ asset: PriceAsset; error: unknown }> = [];
        const unavailableClasses = new Set<AssetClass>();
        const skippedUnavailable: PriceAsset[] = [];
        let seeded = 0;
        for (const doc of seedBudget) {
            const assetClass = PriceHistoryService.assetClass(doc.asset);
            if (unavailableClasses.has(assetClass)) {
                skippedUnavailable.push(doc.asset);
                continue;
            }
            // One asset's failure (a vendor outage) must not stop the other
            // assets from seeding or block the deep walk behind it every tick.
            // The cursor is untouched on a throw, so the asset is retried next
            // tick either way. A parked asset does not count as seeded: it did
            // no ingestion work, so it must not hold the deep walk back.
            try {
                const result = await this.seedRecentWindow(doc);
                if (result === 'seeded') {
                    seeded += 1;
                } else if (result === 'unavailable') {
                    unavailableClasses.add(assetClass);
                    skippedUnavailable.push(doc.asset);
                }
            } catch (error) {
                failures.push({ asset: doc.asset, error });
                this.logger.error({ error, asset: doc.asset }, 'Seeding recent price window failed');
            }
        }

        if (seeded === 0) {
            const incomplete = progress
                .filter((doc) => doc.recentSeeded && !doc.backfillComplete && doc.oldestDayFetched && PriceHistoryService.isDue(doc, now))
                .sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime());
            // One chunk per tick: stop at the first asset that could be asked,
            // whatever it answered, and only move past assets whose class has
            // no vendor to ask so a switched-off token class cannot block TRX.
            // A throw is collected like a seed failure rather than escaping
            // here, so the seed failures gathered above still reach the
            // scheduler's record and the admin page still gets its nudge. The
            // cursor is untouched on a throw, so the chunk is retried next tick.
            for (const doc of incomplete) {
                const assetClass = PriceHistoryService.assetClass(doc.asset);
                if (unavailableClasses.has(assetClass)) {
                    skippedUnavailable.push(doc.asset);
                    continue;
                }
                let result: ChunkResult;
                try {
                    result = await this.backfillDeepHistory(doc, settings.chunkDays);
                } catch (error) {
                    failures.push({ asset: doc.asset, error });
                    this.logger.error({ error, asset: doc.asset }, 'Deep price backfill chunk failed');
                    break;
                }
                if (result !== 'unavailable') {
                    break;
                }
                unavailableClasses.add(assetClass);
                skippedUnavailable.push(doc.asset);
            }
        }

        if (skippedUnavailable.length > 0) {
            this.logger.warn(
                { assets: skippedUnavailable, classes: Array.from(unavailableClasses) },
                'Price ingestion skipped assets: no enabled vendor is configured for their class'
            );
        }
        this.emitStats();
        PriceHistoryService.rethrowFailures(failures);
    }

    /**
     * Surface per-asset failures collected during a tick as one error, after
     * the rest of the tick's work has run, so the scheduler still records the
     * tick as failed without one asset's problem having blocked the others.
     *
     * @param failures - The assets that threw and what they threw.
     * @throws When at least one asset failed.
     */
    private static rethrowFailures(failures: Array<{ asset: PriceAsset; error: unknown }>): void {
        if (failures.length === 0) {
            return;
        }
        const detail = failures
            .map(({ asset, error }) => `${asset}: ${error instanceof Error ? error.message : String(error)}`)
            .join('; ');
        throw new Error(`Price ingestion failed for ${failures.length} asset(s) — ${detail}`);
    }

    /**
     * Append the most recent closed days for every tracked, seeded asset — one
     * cheap ranged call per asset covering the gap since its newest stored day.
     * An asset that comes back without prices is simply tried again tomorrow,
     * since the forward gap only grows by a day; a class no vendor can be asked
     * for is skipped for the rest of the run and named in one warning.
     */
    async runForwardTick(): Promise<void> {
        const settings = await this.getSettings();
        if (!settings.ingestionEnabled || !this.clickhouse) {
            return;
        }
        const today = todayUtcDay();
        const progress = await this.listAssetProgress();
        const failures: Array<{ asset: PriceAsset; error: unknown }> = [];
        const unavailableClasses = new Set<AssetClass>();
        const skippedUnavailable: PriceAsset[] = [];
        for (const doc of progress) {
            const newestDayFetched = doc.newestDayFetched;
            if (!doc.recentSeeded || !newestDayFetched || newestDayFetched >= today) {
                continue;
            }
            const assetClass = PriceHistoryService.assetClass(doc.asset);
            if (unavailableClasses.has(assetClass)) {
                skippedUnavailable.push(doc.asset);
                continue;
            }
            // Isolate each asset so one vendor failure does not leave every
            // asset after it a day behind; the failed asset is retried tomorrow.
            try {
                const outcome = await this.countProviderCall(() => this.provider.fetchRange(doc.asset, newestDayFetched, today));
                if (outcome.verdict === 'unavailable') {
                    unavailableClasses.add(assetClass);
                    skippedUnavailable.push(doc.asset);
                    continue;
                }
                if (outcome.verdict !== 'priced') {
                    continue;
                }
                const points = outcome.points;
                await this.insertPoints(points);
                await this.patchAssetProgress(doc.asset, {
                    newestDayFetched: points[points.length - 1].day,
                    source: points[0].source,
                    sourceRef: points[0].sourceRef ?? null
                });
            } catch (error) {
                failures.push({ asset: doc.asset, error });
                this.logger.error({ error, asset: doc.asset }, 'Forward price append failed');
            }
        }
        if (skippedUnavailable.length > 0) {
            this.logger.warn(
                { assets: skippedUnavailable, classes: Array.from(unavailableClasses) },
                'Forward price append skipped assets: no enabled vendor is configured for their class'
            );
        }
        this.emitStats();
        PriceHistoryService.rethrowFailures(failures);
    }
}
