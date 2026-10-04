/// <reference types="vitest" />

/**
 * GscService unit tests.
 *
 * Covers the read-side behaviors that keep the /system/traffic SEO tab
 * honest: period windows anchored on the newest delivered day (and their
 * returned bounds),
 * zero-filled daily buckets, the true-daily-totals override that corrects
 * for GSC's anonymized-query undercount, and the totals-collection indexes.
 * The network fetch path (googleapis) is intentionally untested here —
 * these tests exercise the Mongo aggregation/lookup logic only.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ICacheService, IDatabaseService, ISystemLogService } from '@/types';
import { GscService } from '../services/gsc.service.js';

/** Days GSC data lags behind now — mirrors GSC_DATA_DELAY_DAYS in the service. */
const DELAY_DAYS = 3;

/** Milliseconds per day. */
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Minimal logger double — every call is a vi.fn so tests can assert on
 * warn/info paths without pulling in pino.
 */
function createMockLogger(): ISystemLogService {
    const fns = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        fatal: vi.fn(),
        trace: vi.fn(),
        child: vi.fn(() => fns)
    } as unknown as ISystemLogService;
    return fns;
}

/**
 * In-memory Mongo collection double covering the surface GscService's
 * read paths touch: createIndex (spied), aggregate().toArray() served
 * from `aggregateRows`, find().toArray() served from `findRows`,
 * findOne() returning the `findRows` entry with the newest `date` (the
 * only findOne the service issues is the newest-day lookup), and
 * bulkWrite (spied).
 */
interface IFakeCollection {
    createIndex: ReturnType<typeof vi.fn>;
    bulkWrite: ReturnType<typeof vi.fn>;
    aggregateRows: unknown[];
    findRows: unknown[];
    aggregate(pipeline: unknown): { toArray(): Promise<unknown[]> };
    find(filter: unknown): { toArray(): Promise<unknown[]> };
    findOne(filter: unknown, options?: unknown): Promise<unknown>;
}

/**
 * Build one fake collection double.
 *
 * @returns A collection double with staging arrays for reads.
 */
function createFakeCollection(): IFakeCollection {
    const fake: IFakeCollection = {
        createIndex: vi.fn(async () => 'ok'),
        bulkWrite: vi.fn(async () => ({})),
        aggregateRows: [],
        findRows: [],
        aggregate() {
            return { toArray: async () => fake.aggregateRows };
        },
        find() {
            return { toArray: async () => fake.findRows };
        },
        async findOne() {
            const rows = fake.findRows as Array<{ date: Date }>;
            const newest = rows.reduce<{ date: Date } | null>(
                (best, row) => (!best || row.date > best.date ? row : best),
                null
            );
            return newest;
        }
    };
    return fake;
}

/**
 * Compute the newest day the service falls back to when no daily totals
 * are stored — midnight UTC, DELAY_DAYS before today.
 *
 * @returns The fallback anchor day as a UTC-midnight timestamp in ms.
 */
function fallbackAnchorDay(): number {
    const now = new Date();
    return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - DELAY_DAYS);
}

/**
 * Build a fake IDatabaseService routing getCollection() to per-name
 * collection doubles, plus vi.fn key-value methods.
 *
 * @returns The fake database and the two collections GscService uses.
 */
function createFakeDatabase(): {
    database: IDatabaseService;
    queries: IFakeCollection;
    totals: IFakeCollection;
    pageTotals: IFakeCollection;
} {
    const queries = createFakeCollection();
    const totals = createFakeCollection();
    const pageTotals = createFakeCollection();
    const collections: Record<string, IFakeCollection> = {
        module_user_gsc_queries: queries,
        module_user_gsc_daily_totals: totals,
        module_user_gsc_page_totals: pageTotals
    };
    const database = {
        getCollection: vi.fn((name: string) => collections[name]),
        get: vi.fn(async () => null),
        set: vi.fn(async () => undefined)
    } as unknown as IDatabaseService;
    return { database, queries, totals, pageTotals };
}

/**
 * Compute the contiguous UTC day keys the service's getKeywordsByDay
 * window covers, oldest first — mirrors the service's window math.
 *
 * @param days - Number of daily buckets.
 * @returns Day keys in `YYYY-MM-DD`.
 */
function expectedDayKeys(days: number): string[] {
    const now = new Date();
    const since = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - DELAY_DAYS - days + 1);
    const keys: string[] = [];
    for (let i = 0; i < days; i++) {
        keys.push(new Date(since + i * DAY_MS).toISOString().split('T')[0]);
    }
    return keys;
}

describe('GscService', () => {
    beforeEach(() => {
        GscService.resetInstance();
    });

    /**
     * Wire a fresh singleton against fake collections.
     *
     * @returns The service instance and its staged collections.
     */
    function setup(): { service: GscService; queries: IFakeCollection; totals: IFakeCollection; pageTotals: IFakeCollection } {
        const { database, queries, totals, pageTotals } = createFakeDatabase();
        GscService.setDependencies(database, {} as ICacheService, createMockLogger());
        return { service: GscService.getInstance(), queries, totals, pageTotals };
    }

    describe('createIndexes()', () => {
        it('creates the daily-totals dedup and TTL indexes', async () => {
            const { service, totals } = setup();

            await service.createIndexes();

            expect(totals.createIndex).toHaveBeenCalledWith(
                { date: 1 },
                expect.objectContaining({ unique: true, name: 'gsc_totals_dedup' })
            );
            expect(totals.createIndex).toHaveBeenCalledWith(
                { fetchedAt: 1 },
                expect.objectContaining({ name: 'gsc_totals_ttl' })
            );
        });

        it('creates the page-totals dedup and TTL indexes', async () => {
            const { service, pageTotals } = setup();

            await service.createIndexes();

            expect(pageTotals.createIndex).toHaveBeenCalledWith(
                { date: 1, page: 1 },
                expect.objectContaining({ unique: true, name: 'gsc_page_totals_dedup' })
            );
            expect(pageTotals.createIndex).toHaveBeenCalledWith(
                { fetchedAt: 1 },
                expect.objectContaining({ name: 'gsc_page_totals_ttl' })
            );
        });
    });

    describe('getKeywordsForPeriod()', () => {
        it('ends the window on the newest delivered day, not a fixed delay', async () => {
            // Google often finalizes a day later than the fixed delay assumes.
            // "24h" must mean the latest day Google returned, or the view sits
            // on an undelivered day and shows nothing.
            const { service, totals } = setup();
            totals.findRows = [
                { date: new Date('2026-09-28T00:00:00.000Z'), clicks: 1, impressions: 50, fetchedAt: new Date() },
                { date: new Date('2026-09-29T00:00:00.000Z'), clicks: 2, impressions: 39, fetchedAt: new Date() }
            ];

            const result = await service.getKeywordsForPeriod(24, 10);

            expect(result.windowStart).toBe('2026-09-29T00:00:00.000Z');
            expect(result.windowEnd).toBe('2026-09-29T23:59:59.999Z');
        });

        it('covers whole days and falls back to the fixed delay with no totals', async () => {
            // Before the first fetch there is no newest day to anchor on, so
            // the window must still resolve to sensible whole-day bounds.
            const { service } = setup();
            const anchor = fallbackAnchorDay();

            const result = await service.getKeywordsForPeriod(168, 10);

            expect(new Date(result.windowStart).getTime()).toBe(anchor - 6 * DAY_MS);
            expect(new Date(result.windowEnd).getTime()).toBe(anchor + DAY_MS - 1);
            expect(result.keywords).toEqual([]);
        });
    });

    describe('getPagesForPeriod()', () => {
        it('shares the keyword window so the page table can share the picker', async () => {
            const { service, totals } = setup();
            totals.findRows = [
                { date: new Date('2026-09-29T00:00:00.000Z'), clicks: 2, impressions: 39, fetchedAt: new Date() }
            ];

            const result = await service.getPagesForPeriod(168, 10);

            expect(result.windowStart).toBe('2026-09-23T00:00:00.000Z');
            expect(result.windowEnd).toBe('2026-09-29T23:59:59.999Z');
            expect(result.pages).toEqual([]);
        });

        it('impression-weights position and derives CTR from aggregated rows', async () => {
            // Position must weight by impressions, not average naively, and a
            // surfaced-but-unclicked page (zero clicks) must still appear.
            const { service, pageTotals } = setup();
            pageTotals.aggregateRows = [
                { _id: '/energy', totalClicks: 5, totalImpressions: 100, weightedPosition: 250 },
                { _id: '/quiet', totalClicks: 0, totalImpressions: 40, weightedPosition: 320 }
            ];

            const result = await service.getPagesForPeriod(168, 10);

            expect(result.pages[0]).toEqual({ page: '/energy', clicks: 5, impressions: 100, ctr: 0.05, position: 2.5 });
            expect(result.pages[1]).toEqual({ page: '/quiet', clicks: 0, impressions: 40, ctr: 0, position: 8 });
        });
    });

    describe('getKeywordsByDay()', () => {
        it('zero-fills every day in the window when no data exists', async () => {
            // A stalled gsc:fetch job must render as an explicit flat line,
            // not as days silently missing from the chart.
            const { service } = setup();
            const days = 5;

            const out = await service.getKeywordsByDay(days);

            expect(out.days).toBe(days);
            expect(out.buckets.map(b => b.date)).toEqual(expectedDayKeys(days));
            for (const bucket of out.buckets) {
                expect(bucket.totalClicks).toBe(0);
                expect(bucket.totalImpressions).toBe(0);
                expect(bucket.keywords).toEqual([]);
            }
        });

        it('prefers true daily totals over keyword-row sums, with fallback', async () => {
            // GSC drops anonymized queries from keyword rows, so their sums
            // undercount; the date-only totals are authoritative when present.
            const { service, queries, totals } = setup();
            const days = 3;
            const [dayA, dayB] = expectedDayKeys(days);

            queries.aggregateRows = [
                { _id: { date: dayA, query: 'tron energy' }, clicks: 2, impressions: 40, weightedPosition: 120 },
                { _id: { date: dayB, query: 'tron relic' }, clicks: 1, impressions: 10, weightedPosition: 30 }
            ];
            // Totals exist only for dayA — dayB falls back to keyword sums.
            totals.findRows = [
                { date: new Date(`${dayA}T00:00:00.000Z`), clicks: 17, impressions: 900, fetchedAt: new Date() }
            ];

            const out = await service.getKeywordsByDay(days);

            const bucketA = out.buckets.find(b => b.date === dayA);
            const bucketB = out.buckets.find(b => b.date === dayB);
            expect(bucketA?.totalClicks).toBe(17);
            expect(bucketA?.totalImpressions).toBe(900);
            // Keyword detail rows remain from the query-dimension data.
            expect(bucketA?.keywords[0]?.keyword).toBe('tron energy');
            expect(bucketB?.totalClicks).toBe(1);
            expect(bucketB?.totalImpressions).toBe(10);
        });
    });
});
