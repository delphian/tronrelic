/**
 * @fileoverview Tests for the price-history module, service, and day helpers.
 *
 * Covers the two-phase module lifecycle (init prepares without registering jobs;
 * run registers both jobs and publishes the service), the service's settings and
 * asset-tracking behaviour, the two-phase backfill (recent seed then deep walk),
 * and the UTC day arithmetic the whole module keys on. Hand-rolled in-memory
 * fakes stand in for Mongo, ClickHouse, the scheduler, the registry, and the
 * price source so the suite runs with no live infrastructure.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { IPricePoint, PriceAsset } from '@/types';
import { PriceHistoryModule } from '../PriceHistoryModule.js';
import { PriceHistoryService } from '../services/price-history.service.js';
import type { IPriceHistoryProvider } from '../providers/IPriceHistoryProvider.js';
import { PRICE_TABLE } from '../database/index.js';
import { toUtcDay, previousUtcDay, shiftUtcDay, diffUtcDays, toCoinGeckoHistoryDate } from '../lib/price-day.js';

/**
 * Minimal in-memory Mongo collection supporting only the operations the module
 * uses: upsert via `updateOne` with `$set`/`$setOnInsert`, `findOne`, and
 * `find().toArray()`. Matching is by the small set of equality filters the
 * service issues (`key`, `asset`).
 */
class FakeCollection {
    public docs: Array<Record<string, unknown>> = [];

    /**
     * @param filter - Equality filter.
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
     * Upsert honoring `$set` and `$setOnInsert`, the only update operators the
     * service uses.
     *
     * @param filter - Equality filter identifying the doc.
     * @param update - `$set` / `$setOnInsert` payloads.
     * @param options - `{ upsert }`.
     */
    async updateOne(
        filter: Record<string, unknown>,
        update: { $set?: Record<string, unknown>; $setOnInsert?: Record<string, unknown> },
        options: { upsert?: boolean } = {}
    ): Promise<void> {
        const existing = this.docs.find((doc) => this.matches(doc, filter));
        if (existing) {
            Object.assign(existing, update.$set ?? {});
            return;
        }
        if (options.upsert) {
            this.docs.push({ ...filter, ...update.$setOnInsert, ...update.$set });
        }
    }

    /**
     * @param doc - Candidate document.
     * @param filter - Equality filter.
     * @returns True when every filter key matches.
     */
    private matches(doc: Record<string, unknown>, filter: Record<string, unknown>): boolean {
        return Object.entries(filter).every(([key, value]) => doc[key] === value);
    }
}

/**
 * In-memory IDatabaseService surface used by the module/service: cached
 * collections plus a no-op `createIndex`.
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
}

/**
 * In-memory ClickHouse fake that stores inserted rows and answers the three
 * query shapes the service issues (single-day point, range series, grouped
 * coverage counts) by scanning those rows.
 */
class FakeClickhouse {
    public rows: Array<{ asset: string; day: string; price_usd: number }> = [];

    async insert<T extends Record<string, unknown>>(table: string, rows: T[]): Promise<void> {
        if (table === PRICE_TABLE) {
            for (const row of rows) {
                this.rows.push({ asset: String(row.asset), day: String(row.day), price_usd: Number(row.price_usd) });
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
 * Deterministic price source: `fetchRange` yields a synthetic ascending series,
 * `fetchDay` yields a price until a configured listing floor, then null.
 */
class FakeProvider implements IPriceHistoryProvider {
    public readonly id = 'fake';

    /**
     * @param listingDay - Days strictly older than this return null from fetchDay,
     *   simulating a coin that did not yet trade.
     */
    constructor(private readonly listingDay = '2000-01-01') {}

    async fetchRange(asset: PriceAsset, fromDay: string, toDay: string): Promise<IPricePoint[]> {
        const points: IPricePoint[] = [];
        const span = diffUtcDays(fromDay, toDay);
        for (let offset = 0; offset <= span; offset += 1) {
            const day = shiftUtcDay(fromDay, offset);
            points.push({ asset, day, priceUsd: 1 + offset / 100 });
        }
        return points;
    }

    async fetchDay(asset: PriceAsset, day: string): Promise<IPricePoint | null> {
        return day < this.listingDay ? null : { asset, day, priceUsd: 0.5 };
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

describe('price-day helpers', () => {
    it('projects instants to UTC day strings', () => {
        expect(toUtcDay(new Date('2024-03-15T23:59:59.999Z'))).toBe('2024-03-15');
    });

    it('walks days on the UTC boundary', () => {
        expect(previousUtcDay('2024-03-01')).toBe('2024-02-29');
        expect(shiftUtcDay('2024-03-15', -10)).toBe('2024-03-05');
        expect(diffUtcDays('2024-03-05', '2024-03-15')).toBe(10);
    });

    it('formats the CoinGecko /history date', () => {
        expect(toCoinGeckoHistoryDate('2024-03-15')).toBe('15-03-2024');
    });
});

describe('PriceHistoryModule lifecycle', () => {
    let database: FakeDatabase;
    let scheduler: { register: ReturnType<typeof vi.fn> };
    let serviceRegistry: { register: ReturnType<typeof vi.fn> };
    let app: { use: ReturnType<typeof vi.fn> };
    let menuService: { create: ReturnType<typeof vi.fn> };

    beforeEach(() => {
        resetServiceSingleton();
        database = new FakeDatabase();
        scheduler = { register: vi.fn() };
        serviceRegistry = { register: vi.fn() };
        app = { use: vi.fn() };
        menuService = { create: vi.fn().mockResolvedValue({ id: 'node' }) };
    });

    it('exposes correct metadata', () => {
        const module = new PriceHistoryModule();
        expect(module.metadata.id).toBe('price-history');
        expect(module.metadata.version).toBe('1.0.0');
    });

    it('does NOT register jobs during init()', async () => {
        const module = new PriceHistoryModule();
        await module.init({ database: database as never, clickhouse: undefined, scheduler: scheduler as never, serviceRegistry: serviceRegistry as never, app: app as never, menuService: menuService as never });
        expect(scheduler.register).not.toHaveBeenCalled();
        expect(serviceRegistry.register).not.toHaveBeenCalled();
        expect(app.use).not.toHaveBeenCalled();
    });

    it('registers both jobs and publishes the service during run()', async () => {
        const module = new PriceHistoryModule();
        await module.init({ database: database as never, clickhouse: undefined, scheduler: scheduler as never, serviceRegistry: serviceRegistry as never, app: app as never, menuService: menuService as never });
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
    let service: PriceHistoryService;

    beforeEach(() => {
        resetServiceSingleton();
        database = new FakeDatabase();
        clickhouse = new FakeClickhouse();
        PriceHistoryService.setDependencies({
            database: database as never,
            clickhouse: clickhouse as never,
            provider: new FakeProvider('2017-01-01'),
            emitter: undefined,
            logger: stubLogger as never
        });
        service = PriceHistoryService.getInstance();
    });

    it('seeds default settings on first read and merges updates', async () => {
        const defaults = await service.getSettings();
        expect(defaults.ingestionEnabled).toBe(true);
        const updated = await service.updateSettings({ daysPerTick: 5 });
        expect(updated.daysPerTick).toBe(5);
        expect(updated.tokensPerTick).toBe(defaults.tokensPerTick);
    });

    it('tracks token assets but ignores TRX as a token', async () => {
        await service.ensureAssetsTracked(['TXYZcontract', 'TRX']);
        const progress = await database.getCollection('module_price-history_progress').find().toArray();
        const assets = progress.map((doc) => doc.asset);
        expect(assets).toContain('TXYZcontract');
        expect(assets).not.toContain('TRX');
    });

    it('seeds the recent window for TRX on the first backfill tick and serves the price back', async () => {
        await service.runBackfillTick();
        const stats = await service.getStats();
        const trx = stats.assets.find((asset) => asset.asset === 'TRX');
        expect(trx?.recentSeeded).toBe(true);
        expect((trx?.dayCount ?? 0)).toBeGreaterThan(0);
        expect(trx?.newestDay).not.toBeNull();
        const price = await service.getPriceOn('TRX', trx!.newestDay!);
        expect(price).not.toBeNull();
    });
});
