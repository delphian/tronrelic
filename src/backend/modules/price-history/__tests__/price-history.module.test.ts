/**
 * @fileoverview Tests for the price-history module, service, day helpers, and
 * the cursor un-parking migration.
 *
 * Covers the two-phase module lifecycle (init attaches the vendor adapters and
 * prepares without registering jobs; run registers both jobs and publishes the
 * service), the service's settings and asset-tracking behaviour, the two-phase
 * backfill (recent seed then chunked deep walk), the progressive backoff that
 * parks an asset a fetch could not price in either phase, the skip of a class
 * no vendor can be asked for, the operator reset, and the UTC day arithmetic
 * the whole module keys on. Hand-rolled in-memory fakes stand in for Mongo,
 * ClickHouse, the scheduler, the registry, and the routed price source so the
 * suite runs with no live infrastructure.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { PriceAsset } from '@/types';
import { PriceHistoryModule } from '../PriceHistoryModule.js';
import { PriceHistoryService } from '../services/price-history.service.js';
import { ProviderRegistry, type ISourcedPricePoint } from '../../providers/index.js';
import { COINGECKO_DESCRIPTOR, GECKOTERMINAL_DESCRIPTOR, TRONSCAN_DESCRIPTOR } from '../../providers/database/index.js';
import { PRICE_TABLE, PROGRESS_COLLECTION, DEFAULT_SETTINGS } from '../database/index.js';
import { migration as unparkMigration } from '../migrations/002_unpark_empty_token_cursors.js';
import { toUtcDay, previousUtcDay, shiftUtcDay, diffUtcDays } from '../lib/price-day.js';
import { retryDelayMs, isRetryAtCeiling, RETRY_BASE_DELAY_MS, RETRY_MAX_DELAY_MS } from '../lib/retry-backoff.js';
import type { IPriceHistoryRouter } from '../providers/IPriceHistoryRouter.js';
import type { IPriceRangeOutcome, PriceRangeVerdict } from '../providers/IPriceRangeOutcome.js';

/**
 * Minimal in-memory Mongo collection supporting only the operations the module
 * uses: upsert via `updateOne` with `$set`/`$setOnInsert`/`$inc`, `updateMany`
 * with the equality and `$ne` filters the migration issues, `findOne`, and
 * `find().toArray()`.
 */
class FakeCollection {
    public docs: Array<Record<string, unknown>> = [];

    /**
     * @param filter - Equality / `$ne` filter.
     * @returns The first matching doc, or null.
     */
    async findOne(filter: Record<string, unknown>): Promise<Record<string, unknown> | null> {
        return this.docs.find((doc) => this.matches(doc, filter)) ?? null;
    }

    /**
     * @param filter - Equality filter (empty returns all).
     * @returns A cursor-like object with `toArray`.
     */
    find(filter: Record<string, unknown> = {}): { toArray: () => Promise<Array<Record<string, unknown>>> } {
        const matched = this.docs.filter((doc) => this.matches(doc, filter));
        return { toArray: async () => matched };
    }

    /**
     * Upsert honoring `$set`, `$setOnInsert`, and `$inc`, the only update
     * operators the service uses.
     *
     * @param filter - Equality filter identifying the doc.
     * @param update - `$set` / `$setOnInsert` / `$inc` payloads.
     * @param options - `{ upsert }`.
     */
    async updateOne(
        filter: Record<string, unknown>,
        update: { $set?: Record<string, unknown>; $setOnInsert?: Record<string, unknown>; $inc?: Record<string, number> },
        options: { upsert?: boolean } = {}
    ): Promise<void> {
        const existing = this.docs.find((doc) => this.matches(doc, filter));
        if (existing) {
            this.apply(existing, update);
            return;
        }
        if (options.upsert) {
            const created: Record<string, unknown> = { ...filter, ...update.$setOnInsert };
            this.apply(created, { $set: update.$set, $inc: update.$inc });
            this.docs.push(created);
        }
    }

    /**
     * Apply `$set` to every matching doc, the shape the migration issues.
     *
     * @param filter - Equality / `$ne` filter.
     * @param update - `$set` payload.
     */
    async updateMany(filter: Record<string, unknown>, update: { $set?: Record<string, unknown> }): Promise<void> {
        for (const doc of this.docs.filter((candidate) => this.matches(candidate, filter))) {
            this.apply(doc, update);
        }
    }

    /**
     * @param doc - Document to mutate.
     * @param update - Operators to apply.
     */
    private apply(
        doc: Record<string, unknown>,
        update: { $set?: Record<string, unknown>; $inc?: Record<string, number> }
    ): void {
        Object.assign(doc, update.$set ?? {});
        for (const [key, delta] of Object.entries(update.$inc ?? {})) {
            doc[key] = (typeof doc[key] === 'number' ? (doc[key] as number) : 0) + delta;
        }
    }

    /**
     * @param doc - Candidate document.
     * @param filter - Equality / `$ne` filter.
     * @returns True when every filter key matches.
     */
    private matches(doc: Record<string, unknown>, filter: Record<string, unknown>): boolean {
        return Object.entries(filter).every(([key, value]) => {
            if (value && typeof value === 'object' && '$ne' in (value as Record<string, unknown>)) {
                return doc[key] !== (value as { $ne: unknown }).$ne;
            }
            return doc[key] === value;
        });
    }
}

/**
 * In-memory IDatabaseService surface used by the module/service/migration:
 * cached collections, a no-op `createIndex`, and `updateMany` by name.
 */
class FakeDatabase {
    public collections = new Map<string, FakeCollection>();

    getCollection<T>(name: string): FakeCollection {
        let collection = this.collections.get(name);
        if (!collection) {
            collection = new FakeCollection();
            this.collections.set(name, collection);
        }
        return collection;
    }

    async createIndex(): Promise<void> {
        // Indexes are a production concern; the fake tracks nothing.
    }

    async updateMany(name: string, filter: Record<string, unknown>, update: { $set?: Record<string, unknown> }): Promise<void> {
        await this.getCollection(name).updateMany(filter, update);
    }
}

/**
 * In-memory ClickHouse fake that stores inserted rows and answers the three
 * query shapes the service issues (single-day point, range series, grouped
 * coverage counts) by scanning those rows.
 */
class FakeClickhouse {
    public rows: Array<{ asset: string; day: string; price_usd: number; source: string }> = [];

    async insert<T extends Record<string, unknown>>(table: string, rows: T[]): Promise<void> {
        if (table === PRICE_TABLE) {
            for (const row of rows) {
                this.rows.push({ asset: String(row.asset), day: String(row.day), price_usd: Number(row.price_usd), source: String(row.source) });
            }
        }
    }

    async query<T = Record<string, unknown>>(sql: string, params: Record<string, unknown> = {}): Promise<T[]> {
        if (sql.includes('GROUP BY asset')) {
            const byAsset = new Map<string, { count: number; days: string[] }>();
            for (const row of this.rows) {
                const entry = byAsset.get(row.asset) ?? { count: 0, days: [] };
                entry.count += 1;
                entry.days.push(row.day);
                byAsset.set(row.asset, entry);
            }
            return Array.from(byAsset.entries()).map(([asset, entry]) => ({
                asset,
                day_count: entry.count,
                oldest_day: entry.days.slice().sort()[0],
                newest_day: entry.days.slice().sort()[entry.days.length - 1]
            })) as T[];
        }
        if ('day' in params) {
            return this.rows
                .filter((row) => row.asset === params.asset && row.day === params.day)
                .map((row) => ({ price_usd: row.price_usd })) as T[];
        }
        return this.rows
            .filter((row) => row.asset === params.asset && row.day >= String(params.fromDay) && row.day <= String(params.toDay))
            .sort((a, b) => (a.day < b.day ? -1 : 1))
            .map((row) => ({ day: row.day, price_usd: row.price_usd })) as T[];
    }
}

/**
 * Deterministic routed price source: yields a synthetic ascending series for
 * every day in the range on or after a configured listing day, so an asset's
 * history ends exactly where the test says it does. Assets in `unpriceable`
 * always come back `empty`, as if every vendor had been asked and had nothing.
 * A verdict forced through `verdicts` overrides both, so a test can stage the
 * inconclusive and unavailable cases the router reports.
 */
class FakeProvider implements IPriceHistoryRouter {
    public readonly id = 'fake';

    public calls: Array<{ asset: PriceAsset; fromDay: string; toDay: string }> = [];

    /** Per-asset verdicts a test forces the next fetches to report, in place of the synthetic series. */
    public verdicts = new Map<PriceAsset, PriceRangeVerdict>();

    /**
     * @param listingDay - Days strictly older than this return nothing.
     * @param unpriceable - Assets the source never prices.
     */
    constructor(private readonly listingDay = '2000-01-01', private readonly unpriceable: PriceAsset[] = []) {}

    forgetAsset(): void {
        // The fake remembers nothing per asset.
    }

    async fetchRange(asset: PriceAsset, fromDay: string, toDay: string): Promise<IPriceRangeOutcome> {
        this.calls.push({ asset, fromDay, toDay });
        const forced = this.verdicts.get(asset);
        if (forced) {
            return { verdict: forced, points: [], asked: forced === 'unavailable' ? [] : [this.id], skipped: forced === 'priced' ? [] : ['other'] };
        }
        if (this.unpriceable.includes(asset)) {
            return { verdict: 'empty', points: [], asked: [this.id], skipped: [] };
        }
        const points: ISourcedPricePoint[] = [];
        const span = diffUtcDays(fromDay, toDay);
        for (let offset = 0; offset <= span; offset += 1) {
            const day = shiftUtcDay(fromDay, offset);
            if (day >= this.listingDay) {
                points.push({ asset, day, priceUsd: 1 + offset / 100, source: this.id, sourceRef: 'ref' });
            }
        }
        return { verdict: points.length > 0 ? 'priced' : 'empty', points, asked: [this.id], skipped: [] };
    }
}

/**
 * Make a parked asset due again by moving its retry time into the past, the
 * way the passage of time would, so a test can drive several attempts through
 * the backoff without waiting.
 *
 * @param database - The fake database holding the cursor.
 * @param asset - The parked asset.
 */
function expireBackoff(database: FakeDatabase, asset: PriceAsset): void {
    const doc = database.getCollection(PROGRESS_COLLECTION).docs.find((candidate) => candidate.asset === asset);
    if (doc) {
        doc.nextAttemptAt = new Date(0);
    }
}

/** Stub logger matching the ISystemLogService shape the module touches. */
const stubLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: () => stubLogger
};

/**
 * Reset the service singleton between tests so each gets fresh wiring. The
 * private static is cleared through an indexed cast — acceptable in tests.
 */
function resetServiceSingleton(): void {
    (PriceHistoryService as unknown as { instance: PriceHistoryService | null }).instance = null;
}

/**
 * A registry with the three price vendors declared, as the providers module
 * would leave it, so the module can attach its adapters.
 *
 * @returns A fresh registry.
 */
function createRegistry(): ProviderRegistry {
    ProviderRegistry.resetInstance();
    const registry = ProviderRegistry.getInstance();
    for (const descriptor of [TRONSCAN_DESCRIPTOR, COINGECKO_DESCRIPTOR, GECKOTERMINAL_DESCRIPTOR]) {
        registry.registerVendor({
            descriptor,
            defaults: {},
            testConnection: async () => ({ ok: true, message: 'ok' }),
            isEnabled: async () => true
        });
    }
    return registry;
}

describe('price-day helpers', () => {
    it('projects instants to UTC day strings', () => {
        expect(toUtcDay(new Date('2024-03-15T23:59:59.999Z'))).toBe('2024-03-15');
    });

    it('walks days on the UTC boundary', () => {
        expect(previousUtcDay('2024-03-01')).toBe('2024-02-29');
        expect(shiftUtcDay('2024-03-15', -10)).toBe('2024-03-05');
        expect(diffUtcDays('2024-03-05', '2024-03-15')).toBe(10);
    });
});

describe('retry-backoff', () => {
    it('doubles from an hour and stops at a day', () => {
        expect(retryDelayMs(1)).toBe(RETRY_BASE_DELAY_MS);
        expect(retryDelayMs(2)).toBe(RETRY_BASE_DELAY_MS * 2);
        expect(retryDelayMs(5)).toBe(RETRY_BASE_DELAY_MS * 16);
        expect(retryDelayMs(6)).toBe(RETRY_MAX_DELAY_MS);
        expect(retryDelayMs(500)).toBe(RETRY_MAX_DELAY_MS);
        expect(retryDelayMs(0)).toBe(RETRY_BASE_DELAY_MS);
    });

    it('reports the ceiling only once the delay is a full day', () => {
        expect(isRetryAtCeiling(5)).toBe(false);
        expect(isRetryAtCeiling(6)).toBe(true);
        expect(isRetryAtCeiling(50)).toBe(true);
    });
});

describe('PriceHistoryModule lifecycle', () => {
    let database: FakeDatabase;
    let scheduler: { register: ReturnType<typeof vi.fn> };
    let serviceRegistry: { register: ReturnType<typeof vi.fn> };
    let providerRegistry: ProviderRegistry;
    let app: { use: ReturnType<typeof vi.fn> };
    let menuService: { create: ReturnType<typeof vi.fn> };

    beforeEach(() => {
        resetServiceSingleton();
        database = new FakeDatabase();
        scheduler = { register: vi.fn() };
        serviceRegistry = { register: vi.fn() };
        providerRegistry = createRegistry();
        app = { use: vi.fn() };
        menuService = { create: vi.fn().mockResolvedValue({ id: 'node' }) };
    });

    /**
     * @param module - The module under test.
     */
    async function initModule(module: PriceHistoryModule): Promise<void> {
        await module.init({
            database: database as never,
            clickhouse: undefined,
            scheduler: scheduler as never,
            serviceRegistry: serviceRegistry as never,
            providerRegistry,
            app: app as never,
            menuService: menuService as never
        });
    }

    it('exposes correct metadata', () => {
        const module = new PriceHistoryModule();
        expect(module.metadata.id).toBe('price-history');
        expect(module.metadata.version).toBe('1.1.0');
    });

    it('attaches one price adapter per vendor during init() without registering jobs', async () => {
        const module = new PriceHistoryModule();
        await initModule(module);
        expect(providerRegistry.getPriceHistoryProvider('tronscan')?.id).toBe('tronscan');
        expect(providerRegistry.getPriceHistoryProvider('coingecko')?.id).toBe('coingecko');
        expect(providerRegistry.getPriceHistoryProvider('geckoterminal')?.id).toBe('geckoterminal');
        expect(scheduler.register).not.toHaveBeenCalled();
        expect(serviceRegistry.register).not.toHaveBeenCalled();
        expect(app.use).not.toHaveBeenCalled();
    });

    it('registers both jobs and publishes the service during run()', async () => {
        const module = new PriceHistoryModule();
        await initModule(module);
        await module.run();
        const jobs = scheduler.register.mock.calls.map((call) => call[0]);
        expect(jobs).toContain('price-history:backfill');
        expect(jobs).toContain('price-history:forward-sync');
        expect(serviceRegistry.register).toHaveBeenCalledWith('price-history', expect.anything());
        expect(app.use).toHaveBeenCalledWith('/api/admin/system/price-history', expect.anything(), expect.anything(), expect.any(Function));
        expect(menuService.create).toHaveBeenCalledWith(expect.objectContaining({ namespace: 'main', label: 'Price History' }));
    });
});

describe('PriceHistoryService', () => {
    let database: FakeDatabase;
    let clickhouse: FakeClickhouse;
    let provider: FakeProvider;
    let service: PriceHistoryService;

    /**
     * Wire a fresh service around a provider.
     *
     * @param source - The fake source to use.
     */
    function wire(source: FakeProvider): void {
        resetServiceSingleton();
        provider = source;
        PriceHistoryService.setDependencies({
            database: database as never,
            clickhouse: clickhouse as never,
            provider,
            registry: createRegistry(),
            emitter: undefined,
            logger: stubLogger as never
        });
        service = PriceHistoryService.getInstance();
    }

    beforeEach(() => {
        vi.clearAllMocks();
        database = new FakeDatabase();
        clickhouse = new FakeClickhouse();
        wire(new FakeProvider('2017-01-01'));
    });

    it('seeds default settings on first read and merges updates', async () => {
        const defaults = await service.getSettings();
        expect(defaults.ingestionEnabled).toBe(true);
        expect(defaults.chunkDays).toBe(DEFAULT_SETTINGS.chunkDays);
        expect(defaults.trxSources).toEqual(DEFAULT_SETTINGS.trxSources);
        const updated = await service.updateSettings({ chunkDays: 90, tokenSources: ['geckoterminal', 'coingecko', 'bogus'] });
        expect(updated.chunkDays).toBe(90);
        expect(updated.tokensPerTick).toBe(defaults.tokensPerTick);
        // Unknown vendor ids are dropped rather than stored.
        expect(updated.tokenSources).toEqual(['geckoterminal', 'coingecko']);
    });

    it('reads a settings document written before routing existed', async () => {
        await database.getCollection('module_price-history_settings').updateOne(
            { key: 'settings' },
            { $set: { key: 'settings', ingestionEnabled: false, daysPerTick: 30, tokensPerTick: 2 } },
            { upsert: true }
        );
        const settings = await service.getSettings();
        expect(settings.ingestionEnabled).toBe(false);
        expect(settings.chunkDays).toBe(DEFAULT_SETTINGS.chunkDays);
        expect(settings.tokensPerTick).toBe(2);
        expect(settings.tokenSources).toEqual(DEFAULT_SETTINGS.tokenSources);
    });

    it('rejects a chunk wider than one vendor call can serve', async () => {
        await expect(service.updateSettings({ chunkDays: 5000 })).rejects.toThrow(/chunkDays/);
    });

    it('tracks token assets but ignores TRX as a token', async () => {
        await service.ensureAssetsTracked(['TXYZcontract', 'TRX']);
        const progress = await database.getCollection(PROGRESS_COLLECTION).find().toArray();
        const assets = progress.map((doc) => doc.asset);
        expect(assets).toContain('TXYZcontract');
        expect(assets).not.toContain('TRX');
    });

    it('seeds the recent window for TRX on the first backfill tick and records the source', async () => {
        await service.runBackfillTick();
        const stats = await service.getStats();
        const trx = stats.assets.find((asset) => asset.asset === 'TRX');
        expect(trx?.recentSeeded).toBe(true);
        expect((trx?.dayCount ?? 0)).toBeGreaterThan(0);
        expect(trx?.newestDay).not.toBeNull();
        expect(trx?.source).toBe('fake');
        expect(trx?.sourceRef).toBe('ref');
        const price = await service.getPriceOn('TRX', trx!.newestDay!);
        expect(price).not.toBeNull();
        expect(clickhouse.rows[0].source).toBe('fake');
    });

    it('walks deep history one chunk per tick and completes at the listing', async () => {
        // Listing inside the second chunk: seed covers ~360 days, chunk 1 covers
        // the year before, chunk 2 finds the listing partway, chunk 3 is empty.
        const listing = shiftUtcDay(toUtcDay(new Date()), -(360 + 365 + 100));
        wire(new FakeProvider(listing));
        await service.updateSettings({ chunkDays: 365 });

        await service.runBackfillTick(); // seed
        await service.runBackfillTick(); // chunk 1
        let trx = (await service.getStats()).assets.find((asset) => asset.asset === 'TRX');
        expect(trx?.backfillComplete).toBe(false);
        expect(provider.calls).toHaveLength(2);
        expect(diffUtcDays(provider.calls[1].fromDay, provider.calls[1].toDay)).toBe(364);

        await service.runBackfillTick(); // chunk 2: partial (listing inside)
        await service.runBackfillTick(); // chunk 3: empty -> complete
        trx = (await service.getStats()).assets.find((asset) => asset.asset === 'TRX');
        expect(trx?.backfillComplete).toBe(true);
        expect(trx?.oldestDay).toBe(listing);
    }, 15_000);

    it('parks an asset no source can price instead of marking it seeded, and a reset re-queues it', async () => {
        wire(new FakeProvider('2017-01-01', ['TUNPRICED']));
        await service.ensureAssetsTracked(['TUNPRICED']);

        await service.runBackfillTick(); // seeds TRX and attempts the token
        let token = (await service.getStats()).assets.find((asset) => asset.asset === 'TUNPRICED');
        expect(token?.recentSeeded).toBe(false);
        expect(token?.unpricedAttempts).toBe(1);
        expect(token?.nextAttemptAt).not.toBeNull();

        // A second tick within the retry window does not ask again.
        const callsBefore = provider.calls.filter((call) => call.asset === 'TUNPRICED').length;
        await service.runBackfillTick();
        expect(provider.calls.filter((call) => call.asset === 'TUNPRICED').length).toBe(callsBefore);

        await service.resetAsset('TUNPRICED');
        token = (await service.getStats()).assets.find((asset) => asset.asset === 'TUNPRICED');
        expect(token?.unpricedAttempts).toBe(0);
        expect(token?.nextAttemptAt).toBeNull();
        await service.runBackfillTick();
        expect(provider.calls.filter((call) => call.asset === 'TUNPRICED').length).toBe(callsBefore + 1);
    });

    it('backs off progressively up to a day and logs an error for each attempt at the ceiling', async () => {
        wire(new FakeProvider('2017-01-01', ['TUNPRICED']));
        await service.ensureAssetsTracked(['TUNPRICED']);

        await service.runBackfillTick(); // seeds TRX; the token is parked for the first time
        provider.verdicts.set('TRX', 'empty'); // finish TRX on the next chunk so the deep walk stays quiet
        for (let attempt = 2; attempt <= 7; attempt += 1) {
            expireBackoff(database, 'TUNPRICED');
            const before = Date.now();
            await service.runBackfillTick();
            const token = (await service.getStats()).assets.find((asset) => asset.asset === 'TUNPRICED');
            expect(token?.unpricedAttempts).toBe(attempt);
            const waitMs = new Date(token!.nextAttemptAt!).getTime() - before;
            expect(waitMs).toBeGreaterThanOrEqual(retryDelayMs(attempt) - 1000);
            expect(waitMs).toBeLessThanOrEqual(retryDelayMs(attempt) + 1000);
        }
        // Attempts 6 and 7 are at the daily ceiling; the five before are not.
        expect(stubLogger.error).toHaveBeenCalledTimes(2);
        expect(stubLogger.error.mock.calls[0][0]).toMatchObject({ asset: 'TUNPRICED', phase: 'seed', attempts: 6 });
    });

    it('parks a deep chunk left inconclusive by a disabled vendor instead of marking the asset complete', async () => {
        await service.runBackfillTick(); // seed TRX
        const seeded = (await service.getStats()).assets.find((asset) => asset.asset === 'TRX');

        provider.verdicts.set('TRX', 'inconclusive');
        await service.runBackfillTick(); // deep chunk: a vendor was skipped, the rest had nothing
        let trx = (await service.getStats()).assets.find((asset) => asset.asset === 'TRX');
        expect(trx?.backfillComplete).toBe(false);
        expect(trx?.recentSeeded).toBe(true);
        expect(trx?.unpricedAttempts).toBe(1);
        expect(trx?.nextAttemptAt).not.toBeNull();
        expect(trx?.oldestDay).toBe(seeded?.oldestDay);
        expect(stubLogger.info).toHaveBeenCalledWith(expect.objectContaining({ phase: 'backfill', verdict: 'inconclusive' }), expect.any(String));

        // While parked the walk does not ask again.
        const callsBefore = provider.calls.length;
        await service.runBackfillTick();
        expect(provider.calls.length).toBe(callsBefore);

        // Once the vendor is back and the backoff has elapsed, the walk resumes and the count clears.
        provider.verdicts.delete('TRX');
        expireBackoff(database, 'TRX');
        await service.runBackfillTick();
        trx = (await service.getStats()).assets.find((asset) => asset.asset === 'TRX');
        expect(trx?.unpricedAttempts).toBe(0);
        expect(trx?.nextAttemptAt).toBeNull();
        expect(trx!.oldestDay! < seeded!.oldestDay!).toBe(true);
    }, 15_000);

    it('skips a class no vendor can be asked for without counting an attempt, and warns once', async () => {
        provider.verdicts.set('TUNAVAIL', 'unavailable');
        await service.ensureAssetsTracked(['TUNAVAIL', 'TUNAVAIL2']);

        await service.runBackfillTick();
        const stats = await service.getStats();
        for (const asset of ['TUNAVAIL', 'TUNAVAIL2']) {
            const token = stats.assets.find((candidate) => candidate.asset === asset);
            expect(token?.recentSeeded).toBe(false);
            expect(token?.unpricedAttempts).toBe(0);
            expect(token?.nextAttemptAt).toBeNull();
        }
        // The second token of the class is never asked once the first reports the class unavailable.
        expect(provider.calls.filter((call) => call.asset === 'TUNAVAIL2')).toHaveLength(0);
        expect(stubLogger.warn).toHaveBeenCalledTimes(1);
        expect(stubLogger.warn.mock.calls[0][0]).toMatchObject({ assets: ['TUNAVAIL', 'TUNAVAIL2'], classes: ['token'] });
        // TRX shares nothing with the token class and still seeded.
        expect(stats.assets.find((candidate) => candidate.asset === 'TRX')?.recentSeeded).toBe(true);
    });

    it('lists the registered price vendors as sources', async () => {
        const sources = await service.getPriceSources();
        expect(sources.map((source) => source.id)).toEqual(['tronscan', 'coingecko', 'geckoterminal']);
        expect(sources.every((source) => source.enabled)).toBe(true);
    });
});

describe('002_unpark_empty_token_cursors', () => {
    it('clears recentSeeded on empty token cursors and leaves TRX and priced tokens alone', async () => {
        const database = new FakeDatabase();
        const progress = database.getCollection(PROGRESS_COLLECTION);
        progress.docs.push(
            { asset: 'TRX', recentSeeded: true, oldestDayFetched: '2020-01-01', newestDayFetched: '2024-01-01' },
            { asset: 'TEMPTY', recentSeeded: true, oldestDayFetched: null, newestDayFetched: null },
            { asset: 'TPRICED', recentSeeded: true, oldestDayFetched: '2023-01-01', newestDayFetched: '2024-01-01' }
        );

        await unparkMigration.up({ database: database as never });

        expect(progress.docs.find((doc) => doc.asset === 'TRX')?.recentSeeded).toBe(true);
        expect(progress.docs.find((doc) => doc.asset === 'TPRICED')?.recentSeeded).toBe(true);
        const empty = progress.docs.find((doc) => doc.asset === 'TEMPTY');
        expect(empty?.recentSeeded).toBe(false);
        expect(empty?.unpricedAttempts).toBe(0);
        expect(empty?.nextAttemptAt).toBeNull();
    });
});
