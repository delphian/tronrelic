/**
 * @fileoverview The single authority for the local daily price series.
 *
 * Why this exists: valuation and PnL must never make a live external price call
 * on a page load, so this service backfills daily USD prices into ClickHouse on a
 * schedule and serves every downstream read from local storage. Prices are
 * immutable, so the work is a bounded, resumable *backward* backfill (seed the
 * dense recent window in one ranged call, then walk the deep past one day at a
 * time) plus a cheap daily *forward* append — the same ingestion discipline the
 * account-history module uses, and for the same reason: respect the external rate
 * budget while guaranteeing eventual full coverage.
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
    PriceAsset
} from '@/types';
import { PRICE_ASSET_TRX } from '@/types';
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
import { todayUtcDay, previousUtcDay, shiftUtcDay, diffUtcDays } from '../lib/price-day.js';
import type { IPriceHistoryProvider } from '../providers/IPriceHistoryProvider.js';

/**
 * Width of the dense window seeded in a single ranged call. Kept just under
 * CoinGecko's free-tier daily-granularity ceiling so the seed is one cheap call,
 * not a day-walk.
 */
const RECENT_WINDOW_DAYS = 360;

/**
 * Pause between per-day deep-backfill calls so a tick stays inside CoinGecko's
 * free-tier rate budget. The deep walk is the only place we make one call per
 * day, so this is where throttling matters.
 */
const BACKFILL_DELAY_MS = 2500;

/** WebSocket event nudging the admin page to refetch; must have a case in WebSocketService.emit(). */
const STATS_EVENT = 'price-history:stats';

/** Dependencies injected once at bootstrap. */
export interface IPriceHistoryServiceDependencies {
    /** Mongo access for cursor/settings state. */
    database: IDatabaseService;
    /** ClickHouse access for the price series; undefined when not configured. */
    clickhouse: IClickHouseService | undefined;
    /** The historical-price source seam. */
    provider: IPriceHistoryProvider;
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
    private readonly provider: IPriceHistoryProvider;
    private readonly emitter: IWebSocketService | undefined;
    private readonly logger: ISystemLogService;

    /**
     * @param deps - Injected collaborators; private so the singleton owns
     *   construction.
     */
    private constructor(deps: IPriceHistoryServiceDependencies) {
        this.database = deps.database;
        this.clickhouse = deps.clickhouse;
        this.provider = deps.provider;
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
     * Non-blocking pause used to throttle the deep-backfill day-walk.
     *
     * @param ms - Milliseconds to wait.
     * @returns A promise resolving after the delay.
     */
    private static delay(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
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
            {
                $setOnInsert: {
                    asset,
                    recentSeeded: false,
                    oldestDayFetched: null,
                    newestDayFetched: null,
                    backfillComplete: false,
                    updatedAt: new Date()
                }
            },
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
     * Read all tracked-asset cursors.
     *
     * @returns Every progress doc.
     */
    private async listAssetProgress(): Promise<IPriceAssetProgressDoc[]> {
        const collection = this.database.getCollection<IPriceAssetProgressDoc>(PROGRESS_COLLECTION);
        const docs = await collection.find({}).toArray();
        return docs;
    }

    /**
     * Project price points to ClickHouse rows and durably insert them. Stamping a
     * fresh `fetched_at` lets ReplacingMergeTree treat a re-fetch of the same
     * `(asset, day)` as an overwrite, so retries and overlapping ranges are
     * idempotent.
     *
     * @param points - Daily points to store; a no-op when empty.
     */
    private async insertPoints(points: IPricePoint[]): Promise<void> {
        if (!this.clickhouse || points.length === 0) {
            return;
        }
        const fetchedAt = PriceHistoryService.formatVersionColumn(new Date());
        const rows: IPriceHistoryRow[] = points.map((point) => ({
            asset: point.asset,
            day: point.day,
            price_usd: point.priceUsd,
            source: this.provider.id,
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
     * Read settings, seeding defaults on first access.
     *
     * @returns Effective settings.
     */
    async getSettings(): Promise<IPriceHistorySettings> {
        const collection = this.database.getCollection<IPriceHistorySettingsDoc>(SETTINGS_COLLECTION);
        const existing = await collection.findOne({ key: SETTINGS_KEY });
        if (existing) {
            return {
                ingestionEnabled: existing.ingestionEnabled,
                daysPerTick: existing.daysPerTick,
                tokensPerTick: existing.tokensPerTick
            };
        }
        await collection.updateOne(
            { key: SETTINGS_KEY },
            { $setOnInsert: { key: SETTINGS_KEY, ...DEFAULT_SETTINGS, updatedAt: new Date() } },
            { upsert: true }
        );
        return { ...DEFAULT_SETTINGS };
    }

    /**
     * Merge settings; only supplied fields change.
     *
     * @param patch - Partial settings.
     * @returns Settings after the merge.
     */
    async updateSettings(patch: Partial<IPriceHistorySettings>): Promise<IPriceHistorySettings> {
        const current = await this.getSettings();
        const next: IPriceHistorySettings = {
            ingestionEnabled: patch.ingestionEnabled ?? current.ingestionEnabled,
            daysPerTick: patch.daysPerTick ?? current.daysPerTick,
            tokensPerTick: patch.tokensPerTick ?? current.tokensPerTick
        };
        const collection = this.database.getCollection<IPriceHistorySettingsDoc>(SETTINGS_COLLECTION);
        await collection.updateOne(
            { key: SETTINGS_KEY },
            { $set: { ...next, updatedAt: new Date() } },
            { upsert: true }
        );
        return next;
    }

    /**
     * Build the coverage snapshot for the admin surface. Per-asset bounds and day
     * counts come from one grouped ClickHouse aggregate; the seed/complete flags
     * come from the Mongo cursors.
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

        const assets: IPriceAssetCoverage[] = progress.map((doc) => {
            const count = counts.get(doc.asset);
            return {
                asset: doc.asset,
                oldestDay: count?.oldest_day ?? doc.oldestDayFetched,
                newestDay: count?.newest_day ?? doc.newestDayFetched,
                dayCount: count?.day_count ?? 0,
                recentSeeded: doc.recentSeeded,
                backfillComplete: doc.backfillComplete
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
            totals: { assetCount: assets.length, oldestDay, newestDay, staleAssets }
        };
    }

    /**
     * Seed an asset's dense recent window in one ranged call, recording the
     * resulting day bounds and flipping `recentSeeded`. Empty results (unlisted /
     * unknown asset) still flip the flag so the asset does not block the tick
     * forever — it simply contributes no prices.
     *
     * @param asset - The asset to seed.
     */
    private async seedRecentWindow(asset: PriceAsset): Promise<void> {
        const today = todayUtcDay();
        const fromDay = shiftUtcDay(today, -RECENT_WINDOW_DAYS);
        const points = await this.provider.fetchRange(asset, fromDay, today);
        await this.insertPoints(points);
        const patch: Partial<IPriceAssetProgressDoc> = { recentSeeded: true };
        if (points.length > 0) {
            patch.oldestDayFetched = points[0].day;
            patch.newestDayFetched = points[points.length - 1].day;
        }
        await this.patchAssetProgress(asset, patch);
        this.logger.info({ asset, seeded: points.length }, 'Seeded recent price window');
    }

    /**
     * Walk one asset's deep past, one day older at a time, up to `daysPerTick`.
     * Stops (and marks `backfillComplete`) when the provider returns null for a
     * day (listing reached) or the {@link MAX_BACKFILL_DAYS} floor is hit. The
     * cursor advances after every clean write, so a failed tick resumes without
     * re-fetching.
     *
     * @param doc - The asset's current cursor.
     * @param daysPerTick - Max days to walk this tick.
     */
    private async backfillDeepHistory(doc: IPriceAssetProgressDoc, daysPerTick: number): Promise<void> {
        if (!doc.oldestDayFetched) {
            return;
        }
        const floorDay = shiftUtcDay(todayUtcDay(), -MAX_BACKFILL_DAYS);
        let cursor = doc.oldestDayFetched;
        for (let walked = 0; walked < daysPerTick; walked += 1) {
            const target = previousUtcDay(cursor);
            if (diffUtcDays(floorDay, target) < 0) {
                await this.patchAssetProgress(doc.asset, { backfillComplete: true });
                this.logger.info({ asset: doc.asset, floorDay }, 'Backfill reached lookback floor');
                return;
            }
            const point = await this.provider.fetchDay(doc.asset, target);
            if (!point) {
                await this.patchAssetProgress(doc.asset, { backfillComplete: true });
                this.logger.info({ asset: doc.asset, target }, 'Backfill reached asset listing (no earlier price)');
                return;
            }
            await this.insertPoints([point]);
            cursor = target;
            await this.patchAssetProgress(doc.asset, { oldestDayFetched: cursor });
            await PriceHistoryService.delay(BACKFILL_DELAY_MS);
        }
    }

    /**
     * Advance the backward backfill one bounded slice: ensure TRX is tracked, seed
     * any un-seeded asset's recent window (TRX first, then up to `tokensPerTick`
     * tokens), then spend the day budget walking the single least-recently-
     * advanced incomplete asset's deep history.
     */
    async runBackfillTick(): Promise<void> {
        const settings = await this.getSettings();
        if (!settings.ingestionEnabled || !this.clickhouse) {
            return;
        }
        await this.ensureAssetProgress(PRICE_ASSET_TRX);

        const progress = await this.listAssetProgress();
        const unseeded = progress.filter((doc) => !doc.recentSeeded);
        unseeded.sort((a, b) => (a.asset === PRICE_ASSET_TRX ? -1 : b.asset === PRICE_ASSET_TRX ? 1 : 0));
        const seedBudget = unseeded.slice(0, settings.tokensPerTick + 1);
        for (const doc of seedBudget) {
            await this.seedRecentWindow(doc.asset);
        }
        if (seedBudget.length > 0) {
            this.emitStats();
            return; // Seeding consumed this tick; deep-walk on a later tick.
        }

        const incomplete = progress
            .filter((doc) => doc.recentSeeded && !doc.backfillComplete && doc.oldestDayFetched)
            .sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime());
        if (incomplete.length > 0) {
            await this.backfillDeepHistory(incomplete[0], settings.daysPerTick);
        }
        this.emitStats();
    }

    /**
     * Append the most recent closed days for every tracked, seeded asset — one
     * cheap ranged call per asset covering the gap since its newest stored day.
     */
    async runForwardTick(): Promise<void> {
        const settings = await this.getSettings();
        if (!settings.ingestionEnabled || !this.clickhouse) {
            return;
        }
        const today = todayUtcDay();
        const progress = await this.listAssetProgress();
        for (const doc of progress) {
            if (!doc.recentSeeded || !doc.newestDayFetched || doc.newestDayFetched >= today) {
                continue;
            }
            const points = await this.provider.fetchRange(doc.asset, doc.newestDayFetched, today);
            if (points.length === 0) {
                continue;
            }
            await this.insertPoints(points);
            await this.patchAssetProgress(doc.asset, { newestDayFetched: points[points.length - 1].day });
        }
        this.emitStats();
    }
}
