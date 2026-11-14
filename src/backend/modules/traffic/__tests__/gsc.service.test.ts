/// <reference types="vitest" />

/**
 * GscService unit tests.
 *
 * Covers the read-side behaviors that keep the /system/traffic SEO tab and
 * the SEO AI tool honest, against an archive double: period, range, and
 * `all` windows (and their returned bounds), zero-filled buckets by day,
 * week, or month, totals taken from the anonymization-immune daily totals,
 * and the first non-final day. The fetch path runs against a stubbed
 * googleapis client, covering the request options, the archive writes and
 * the prune of rows a refetch no longer returns, the saved fetch markers on
 * the daily path, and their absence on the backfill path.
 */

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import type { ICacheService, IDatabaseService, ISystemLogService } from '@/types';

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));

vi.mock('googleapis', () => ({
    google: {
        auth: {
            /**
             * Stand-in for the service-account auth client, which the
             * stubbed Search Console client never calls.
             */
            GoogleAuth: class {}
        },
        /**
         * Return a Search Console client whose search analytics query is the
         * shared mock, so each test controls what Google "returns".
         *
         * @returns A client exposing only `searchanalytics.query`.
         */
        searchconsole: () => ({ searchanalytics: { query: queryMock } })
    }
}));

import { GscService } from '../services/gsc.service.js';
import type { IGscArchive } from '../services/IGscArchive.js';

/**
 * Archive double whose every method except `isEnabled` is a spy typed to the
 * interface's own signature, so tests can stage what the reads return and
 * assert what the writes received while the double still satisfies
 * `IGscArchive`.
 */
type FakeArchive = Pick<IGscArchive, 'isEnabled'> & {
    [K in Exclude<keyof IGscArchive, 'isEnabled'>]: Mock<IGscArchive[K]>;
};

/**
 * Build an archive double, enabled or disabled, so tests can check both that
 * a deployment without ClickHouse makes no extra requests and what an enabled
 * archive receives. Reads return nothing until a test stages rows.
 *
 * @param enabled - What `isEnabled()` reports.
 * @returns The archive double.
 */
function createFakeArchive(enabled: boolean): FakeArchive {
    return {
        isEnabled: () => enabled,
        writeQueries: vi.fn<IGscArchive['writeQueries']>(async () => undefined),
        writeDailyTotals: vi.fn<IGscArchive['writeDailyTotals']>(async () => undefined),
        writePageTotals: vi.fn<IGscArchive['writePageTotals']>(async () => undefined),
        prune: vi.fn<IGscArchive['prune']>(async () => undefined),
        getCoverage: vi.fn<IGscArchive['getCoverage']>(async () => ({ firstDate: null, lastDate: null, days: 0 })),
        sumByKeyword: vi.fn<IGscArchive['sumByKeyword']>(async () => []),
        sumByPage: vi.fn<IGscArchive['sumByPage']>(async () => []),
        sumByKeywordPage: vi.fn<IGscArchive['sumByKeywordPage']>(async () => []),
        sumTotalsByBucket: vi.fn<IGscArchive['sumTotalsByBucket']>(async () => []),
        topKeywordsByBucket: vi.fn<IGscArchive['topKeywordsByBucket']>(async () => []),
        keywordSumsByBucket: vi.fn<IGscArchive['keywordSumsByBucket']>(async () => [])
    };
}

/**
 * Stage the archive's day range, which period windows end on and `all`
 * windows start from.
 *
 * @param archive - The archive double.
 * @param firstDate - Oldest archived day.
 * @param lastDate - Newest archived day.
 */
function stageCoverage(archive: FakeArchive, firstDate: string, lastDate: string): void {
    archive.getCoverage.mockResolvedValue({ firstDate, lastDate, days: 1 });
}

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
 * Compute the newest day the service falls back to when nothing is archived:
 * midnight UTC, DELAY_DAYS before today, as a timestamp in ms.
 */
function fallbackAnchorDay(): number {
    const now = new Date();
    return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - DELAY_DAYS);
}

/**
 * Build a fake IDatabaseService exposing only the key-value methods, which
 * is all GscService uses: credentials and the saved fetch markers.
 *
 * @param kv - Entries `get` should return.
 * @returns The fake database.
 */
function createFakeDatabase(kv: Record<string, string>): IDatabaseService {
    return {
        get: vi.fn(async (key: string) => kv[key] ?? null),
        set: vi.fn(async () => undefined)
    } as unknown as IDatabaseService;
}

describe('GscService', () => {
    beforeEach(() => {
        GscService.resetInstance();
    });

    /**
     * Wire a fresh singleton against a key-value double and an archive double.
     *
     * @param kv - Key-value entries the fake database's `get` should return,
     *   such as the saved first non-final day.
     * @param archiveEnabled - Whether the archive double reports itself enabled.
     * @returns The service instance, the fake database, and the archive double.
     */
    function setup(kv: Record<string, string> = {}, archiveEnabled = false): {
        service: GscService;
        database: IDatabaseService;
        archive: FakeArchive;
    } {
        const database = createFakeDatabase(kv);
        const archive = createFakeArchive(archiveEnabled);
        GscService.setDependencies(database, {} as ICacheService, createMockLogger(), archive);
        return { service: GscService.getInstance(), database, archive };
    }

    describe('window resolution', () => {
        it('ends a period on the newest archived day, not a fixed delay', async () => {
            // Google often finalizes a day later than the fixed delay assumes.
            // "24h" must mean the latest day Google returned, or the view sits
            // on an undelivered day and shows nothing.
            const { service, archive } = setup({}, true);
            stageCoverage(archive, '2025-07-13', '2026-09-29');

            const result = await service.getKeywords({ kind: 'period', hours: 24 }, 10);

            expect(result.windowStart).toBe('2026-09-29T00:00:00.000Z');
            expect(result.windowEnd).toBe('2026-09-29T23:59:59.999Z');
            expect(archive.sumByKeyword).toHaveBeenCalledWith('2026-09-29', '2026-09-29', 10);
        });

        it('covers whole days and falls back to the fixed delay with nothing archived', async () => {
            // Before the first fetch there is no newest day to anchor on, so
            // the window must still resolve to sensible whole-day bounds.
            const { service } = setup();
            const anchor = fallbackAnchorDay();

            const result = await service.getKeywords({ kind: 'period', hours: 168 }, 10);

            expect(new Date(result.windowStart).getTime()).toBe(anchor - 6 * DAY_MS);
            expect(new Date(result.windowEnd).getTime()).toBe(anchor + DAY_MS - 1);
            expect(result.keywords).toEqual([]);
        });

        it('starts an all window on the oldest archived day', async () => {
            const { service, archive } = setup({}, true);
            stageCoverage(archive, '2025-07-13', '2026-09-29');

            const result = await service.getKeywords({ kind: 'all' }, 10);

            expect(result.windowStart).toBe('2025-07-13T00:00:00.000Z');
            expect(result.windowEnd).toBe('2026-09-29T23:59:59.999Z');
        });

        it('reads an explicit range exactly, without consulting the archived range', async () => {
            const { service, archive } = setup({}, true);

            const result = await service.getPages({ kind: 'range', startDate: '2025-03-01', endDate: '2025-03-31' }, 5);

            expect(result.windowStart).toBe('2025-03-01T00:00:00.000Z');
            expect(result.windowEnd).toBe('2025-03-31T23:59:59.999Z');
            expect(archive.sumByPage).toHaveBeenCalledWith('2025-03-01', '2025-03-31', 5);
            expect(archive.getCoverage).not.toHaveBeenCalled();
        });

        it('rejects a reversed or malformed range', async () => {
            const { service } = setup();

            await expect(service.getKeywords({ kind: 'range', startDate: '2025-04-01', endDate: '2025-03-01' })).rejects.toThrow(/after/);
            await expect(service.getKeywords({ kind: 'range', startDate: '2025-02-30', endDate: '2025-03-01' })).rejects.toThrow(/YYYY-MM-DD/);
        });

        it('reports the first non-final day only when the window reaches it', async () => {
            // The tab marks figures that can still change. A saved day past the
            // window's end means every day shown is final.
            const inside = setup({ 'gsc:firstIncompleteDate': '2026-09-29' }, true);
            stageCoverage(inside.archive, '2026-01-01', '2026-09-29');
            expect((await inside.service.getKeywords({ kind: 'period', hours: 168 }, 10)).firstIncompleteDate).toBe('2026-09-29');

            GscService.resetInstance();
            const beyond = setup({ 'gsc:firstIncompleteDate': '2026-09-30' }, true);
            stageCoverage(beyond.archive, '2026-01-01', '2026-09-29');
            expect((await beyond.service.getKeywords({ kind: 'period', hours: 168 }, 10)).firstIncompleteDate).toBeNull();
        });

        it('raises a saved day before the window start to the window start', async () => {
            // A 24-hour view of the newest day while earlier days are also
            // non-final must not name a date outside its own window.
            const { service, archive } = setup({ 'gsc:firstIncompleteDate': '2026-09-27' }, true);
            stageCoverage(archive, '2026-01-01', '2026-09-29');

            expect((await service.getKeywords({ kind: 'period', hours: 24 }, 10)).firstIncompleteDate).toBe('2026-09-29');
        });
    });

    describe('ranked reads', () => {
        it('impression-weights position and derives CTR from summed page rows', async () => {
            // Position must weight by impressions, not average naively, and a
            // surfaced-but-unclicked page (zero clicks) must still appear.
            const { service, archive } = setup({}, true);
            archive.sumByPage.mockResolvedValue([
                { page: '/energy', clicks: 5, impressions: 100, weightedPosition: 250 },
                { page: '/quiet', clicks: 0, impressions: 40, weightedPosition: 320 }
            ]);

            const result = await service.getPages({ kind: 'period', hours: 168 }, 10);

            expect(result.pages[0]).toEqual({ page: '/energy', clicks: 5, impressions: 100, ctr: 0.05, position: 2.5 });
            expect(result.pages[1]).toEqual({ page: '/quiet', clicks: 0, impressions: 40, ctr: 0, position: 8 });
        });

        it('passes no limit for keyword-page pairs unless the caller sets one', async () => {
            // The admin panel shows every pair; only a capped caller narrows it.
            const { service, archive } = setup({}, true);
            archive.sumByKeywordPage.mockResolvedValue([
                { keyword: 'tron energy', page: '/tools/energy', clicks: 2, impressions: 10, weightedPosition: 30 }
            ]);

            const result = await service.getKeywordPagePairs({ kind: 'all' });

            expect(archive.sumByKeywordPage.mock.calls[0][2]).toBeUndefined();
            expect(result.pairs).toEqual([{ keyword: 'tron energy', page: '/tools/energy', clicks: 2, impressions: 10, ctr: 0.2, position: 3 }]);
        });
    });

    describe('getKeywordHistory()', () => {
        it('zero-fills every day and leaves position null where there were no impressions', async () => {
            // A chart of one keyword must show quiet days as zero, and a 0
            // position would plot as better than first place.
            const { service, archive } = setup({}, true);
            stageCoverage(archive, '2026-01-01', '2026-09-29');
            archive.keywordSumsByBucket.mockResolvedValue([
                { bucket: '2026-09-27', keyword: 'tronrelic', clicks: 1, impressions: 4, weightedPosition: 6 }
            ]);

            const out = await service.getKeywordHistory('  TronRelic ', { kind: 'period', hours: 72 });

            expect(out.keyword).toBe('tronrelic');
            expect(out.granularity).toBe('day');
            expect(out.windowStart).toBe('2026-09-27T00:00:00.000Z');
            expect(archive.keywordSumsByBucket).toHaveBeenCalledWith('tronrelic', 'exact', '2026-09-27', '2026-09-29', 'day');
            expect(out.days).toEqual([
                { date: '2026-09-27', clicks: 1, impressions: 4, ctr: 0.25, position: 1.5, preliminary: false },
                { date: '2026-09-28', clicks: 0, impressions: 0, ctr: 0, position: null, preliminary: false },
                { date: '2026-09-29', clicks: 0, impressions: 0, ctr: 0, position: null, preliminary: false }
            ]);
            expect(out.totals).toEqual({ clicks: 1, impressions: 4, ctr: 0.25, position: 1.5 });
        });

        it('sums contains matches per bucket and lists the variants by impressions', async () => {
            const { service, archive } = setup({}, true);
            stageCoverage(archive, '2026-01-01', '2026-09-29');
            archive.keywordSumsByBucket.mockResolvedValue([
                { bucket: '2026-09-29', keyword: 'tron energy rental', clicks: 1, impressions: 2, weightedPosition: 20 },
                { bucket: '2026-09-29', keyword: 'cheap tron energy', clicks: 0, impressions: 5, weightedPosition: 150 }
            ]);

            const out = await service.getKeywordHistory('tron energy', { kind: 'period', hours: 24 }, 'contains');

            expect(out.days).toEqual([
                { date: '2026-09-29', clicks: 1, impressions: 7, ctr: 0.1429, position: 24.3, preliminary: false }
            ]);
            expect(out.matchedQueries).toEqual(['cheap tron energy', 'tron energy rental']);
        });

        it('buckets a long window by week, labelling each by its Monday', async () => {
            // A year of daily points is too long to chart or to hand a model.
            // 2026-09-29 is a Tuesday, so the last bucket starts Monday the 28th.
            const { service, archive } = setup({}, true);
            stageCoverage(archive, '2025-07-13', '2026-09-29');

            const out = await service.getKeywordHistory('tronrelic', { kind: 'period', hours: 8760 });

            expect(out.granularity).toBe('week');
            expect(archive.keywordSumsByBucket.mock.calls[0][4]).toBe('week');
            expect(out.days.at(-1)?.date).toBe('2026-09-28');
            expect(out.days.length).toBeLessThanOrEqual(54);
        });

        it('flags buckets holding a non-final day as preliminary', async () => {
            const { service, archive } = setup({ 'gsc:firstIncompleteDate': '2026-09-29' }, true);
            stageCoverage(archive, '2026-01-01', '2026-09-29');

            const out = await service.getKeywordHistory('tronrelic', { kind: 'period', hours: 48 });

            expect(out.firstIncompleteDate).toBe('2026-09-29');
            expect(out.days.map(d => [d.date, d.preliminary])).toEqual([
                ['2026-09-28', false],
                ['2026-09-29', true]
            ]);
        });
    });

    describe('getKeywordTrend()', () => {
        it('zero-fills every bucket in the window when no data exists', async () => {
            // A stalled gsc:fetch job must render as an explicit flat line,
            // not as days silently missing from the chart.
            const { service, archive } = setup({}, true);
            stageCoverage(archive, '2026-01-01', '2026-09-29');

            const out = await service.getKeywordTrend({ kind: 'period', hours: 5 * 24 });

            expect(out.buckets.map(b => b.date)).toEqual(['2026-09-25', '2026-09-26', '2026-09-27', '2026-09-28', '2026-09-29']);
            for (const bucket of out.buckets) {
                expect(bucket.totalClicks).toBe(0);
                expect(bucket.totalImpressions).toBe(0);
                expect(bucket.keywords).toEqual([]);
            }
        });

        it('takes totals from the daily totals and keywords from the keyword rows', async () => {
            // GSC drops anonymized queries from keyword rows, so their sums
            // undercount; the date-only totals are authoritative.
            const { service, archive } = setup({}, true);
            stageCoverage(archive, '2026-01-01', '2026-09-29');
            archive.sumTotalsByBucket.mockResolvedValue([{ bucket: '2026-09-28', clicks: 17, impressions: 900 }]);
            archive.topKeywordsByBucket.mockResolvedValue([
                { bucket: '2026-09-28', keyword: 'tron energy', clicks: 2, impressions: 40, weightedPosition: 120 }
            ]);

            const out = await service.getKeywordTrend({ kind: 'period', hours: 48 }, 15);

            expect(archive.topKeywordsByBucket).toHaveBeenCalledWith('2026-09-28', '2026-09-29', 'day', 15);
            expect(out.buckets[0]).toEqual({
                date: '2026-09-28',
                totalClicks: 17,
                totalImpressions: 900,
                preliminary: false,
                keywords: [{ keyword: 'tron energy', clicks: 2, impressions: 40, ctr: 0.05, position: 3 }]
            });
            expect(out.buckets[1].totalClicks).toBe(0);
        });

        it('buckets the whole archive by month when the caller asks', async () => {
            const { service, archive } = setup({}, true);
            stageCoverage(archive, '2025-07-13', '2026-09-29');

            const out = await service.getKeywordTrend({ kind: 'all' }, 5, 'month');

            expect(out.granularity).toBe('month');
            expect(out.buckets[0].date).toBe('2025-07-01');
            expect(out.buckets.at(-1)?.date).toBe('2026-09-01');
            expect(out.buckets).toHaveLength(15);
        });

        it('flags buckets from the first non-final day onward as preliminary', async () => {
            // Google's fresh figures for these days can still change, so the
            // chart must be able to say so for each bucket it draws.
            const { service, archive } = setup({ 'gsc:firstIncompleteDate': '2026-09-28' }, true);
            stageCoverage(archive, '2026-01-01', '2026-09-29');

            const out = await service.getKeywordTrend({ kind: 'period', hours: 72 });

            expect(out.firstIncompleteDate).toBe('2026-09-28');
            expect(out.buckets.map(b => [b.date, b.preliminary])).toEqual([
                ['2026-09-27', false],
                ['2026-09-28', true],
                ['2026-09-29', true]
            ]);
        });
    });

    describe('getStatus()', () => {
        it('reports how far back the archive reaches, or null without ClickHouse', async () => {
            const enabled = setup({}, true);
            stageCoverage(enabled.archive, '2025-07-13', '2026-09-29');
            expect((await enabled.service.getStatus()).history).toEqual({ firstDate: '2025-07-13', lastDate: '2026-09-29', days: 1 });

            GscService.resetInstance();
            const disabled = setup({}, false);
            expect((await disabled.service.getStatus()).history).toBeNull();
        });
    });

    describe('fetchAndStore()', () => {
        /**
         * Wire a singleton whose key-value store holds credentials, so the
         * fetch path runs against the stubbed Search Console client.
         *
         * @param archiveEnabled - Whether the archive double reports itself enabled.
         * @returns The service instance, the fake database, and the archive double.
         */
        function setupConfigured(archiveEnabled = true): ReturnType<typeof setup> {
            return setup({
                'gsc:credentials': JSON.stringify({ client_email: 'a@b.c', private_key: 'k' }),
                'gsc:siteUrl': 'sc-domain:tronrelic.com'
            }, archiveEnabled);
        }

        /**
         * Answer each Search Console request with one row shaped for the
         * dimensions it asked for, as Google does.
         *
         * @param request - The query call's argument, carrying the dimensions.
         * @returns A response holding one row for the requested dimensions.
         */
        function oneRowPerRequest(request: { requestBody: { dimensions: string[] } }): { data: { rows: unknown[] } } {
            const keysByDimension: Record<string, string> = {
                query: 'tron energy',
                page: 'https://tronrelic.com/',
                country: 'usa',
                device: 'DESKTOP',
                date: '2026-10-07'
            };
            const keys = request.requestBody.dimensions.map(d => keysByDimension[d]);
            return { data: { rows: [{ keys, clicks: 1, impressions: 5, ctr: 0.2, position: 3 }] } };
        }

        beforeEach(() => {
            queryMock.mockReset();
        });

        it('requests fresh data, not only finalized days', async () => {
            // With the API default ("final"), a day Google is slow to finalize
            // is missing from every run, and the SEO tab stays on the last
            // finalized day for days at a time.
            const { service } = setupConfigured();
            queryMock.mockImplementation(async (request) => oneRowPerRequest(request));

            await service.fetchAndStore('2026-09-08', '2026-10-08');

            expect(queryMock).toHaveBeenCalledTimes(3);
            for (const [request] of queryMock.mock.calls) {
                expect(request.requestBody.dataState).toBe('all');
            }
        });

        it('writes each request to its archive table and prunes rows the refetch did not return', async () => {
            // Fresh numbers change until a day is final, and a row from an
            // earlier fetch can be absent from a later one. Rows the run did
            // not touch keep their older fetchedAt and must be removed.
            const { service, archive } = setupConfigured();
            queryMock.mockImplementation(async (request) => oneRowPerRequest(request));

            const result = await service.fetchAndStore('2026-09-08', '2026-10-08');

            expect(result).toEqual({ rowsFetched: 3 });
            expect(archive.writeQueries).toHaveBeenCalledWith([expect.objectContaining({ query: 'tron energy', clicks: 1 })]);
            expect(archive.writeDailyTotals).toHaveBeenCalledWith([expect.objectContaining({ clicks: 1, impressions: 5 })]);
            expect(archive.writePageTotals).toHaveBeenCalledWith([expect.objectContaining({ page: 'https://tronrelic.com/' })]);

            // The stub's only row is dated 2026-10-07, so the prune starts there.
            const runStamp = archive.writeQueries.mock.calls[0][0][0].fetchedAt;
            for (const table of ['gsc_queries', 'gsc_daily_totals', 'gsc_page_totals']) {
                expect(archive.prune).toHaveBeenCalledWith(table, '2026-10-07', '2026-10-08', runStamp);
            }
        });

        it('keeps archived days older than anything Google returned', async () => {
            // Google omits days past its 16-month limit, so a window reaching
            // that far returns rows only for its later days. The earlier days'
            // archived rows exist nowhere else and must not be pruned.
            const { service, archive } = setupConfigured();
            queryMock.mockImplementation(async (request: { requestBody: { dimensions: string[] } }) => {
                const days = ['2025-07-12', '2025-07-10'];
                const rows = days.map(day => ({
                    keys: request.requestBody.dimensions.map(d => (d === 'date' ? day : `${d}-key`)),
                    clicks: 1,
                    impressions: 2,
                    ctr: 0.5,
                    position: 3
                }));
                return { data: { rows } };
            });

            await service.archiveWindow('2025-07-06', '2025-07-12');

            for (const table of ['gsc_queries', 'gsc_daily_totals', 'gsc_page_totals']) {
                expect(archive.prune).toHaveBeenCalledWith(table, '2025-07-10', '2025-07-12', expect.any(Date));
            }
        });

        it('keeps stored rows and the saved day when Google returns nothing for the window', async () => {
            // An empty response must not wipe a window that held data.
            const { service, database, archive } = setupConfigured();
            queryMock.mockResolvedValue({ data: { rows: [] } });

            await service.fetchAndStore('2026-09-08', '2026-10-08');

            expect(archive.prune).not.toHaveBeenCalled();
            expect(database.set).not.toHaveBeenCalledWith('gsc:firstIncompleteDate', expect.anything());
        });

        it('saves the first non-final day Google reports for the date-only request', async () => {
            // Only a request grouped by date alone carries this metadata, and
            // the reads depend on it to mark days whose figures can change.
            const { service, database } = setupConfigured();
            queryMock.mockImplementation(async (request) => {
                const response = oneRowPerRequest(request);
                return request.requestBody.dimensions.length === 1
                    ? { data: { ...response.data, metadata: { firstIncompleteDate: '2026-10-07' } } }
                    : response;
            });

            await service.fetchAndStore('2026-09-08', '2026-10-08');

            expect(database.set).toHaveBeenCalledWith('gsc:firstIncompleteDate', '2026-10-07');
        });

        it('clears the saved day once Google reports the whole window as final', async () => {
            const { service, database } = setupConfigured();
            queryMock.mockImplementation(async (request) => oneRowPerRequest(request));

            await service.fetchAndStore('2026-09-08', '2026-10-08');

            expect(database.set).toHaveBeenCalledWith('gsc:firstIncompleteDate', null);
        });

        it('refuses without ClickHouse, before calling Google', async () => {
            // There is nowhere else to store a fetch, so it must not run.
            const { service } = setupConfigured(false);

            await expect(service.fetchAndStore('2026-09-08', '2026-10-08')).rejects.toThrow('ClickHouse is not configured');
            expect(queryMock).not.toHaveBeenCalled();
        });

        it('does not record a fetch when the archive write fails', async () => {
            // The scheduler must see the run as failed, and the "fetched"
            // time on the SEO tab must not claim a run that stored nothing.
            const { service, archive, database } = setupConfigured();
            queryMock.mockImplementation(async (request) => oneRowPerRequest(request));
            archive.writeQueries.mockRejectedValueOnce(new Error('ClickHouse unavailable'));

            await expect(service.fetchAndStore('2026-09-08', '2026-10-08')).rejects.toThrow('ClickHouse unavailable');

            expect(database.set).not.toHaveBeenCalledWith('gsc:lastFetch', expect.anything());
        });

        it('records the fetch time after a successful run', async () => {
            const { service, database } = setupConfigured();
            queryMock.mockImplementation(async (request) => oneRowPerRequest(request));

            await service.fetchAndStore('2026-09-08', '2026-10-08');

            expect(database.set).toHaveBeenCalledWith('gsc:lastFetch', expect.any(String));
        });
    });

    describe('archiveWindow()', () => {
        beforeEach(() => {
            queryMock.mockReset();
        });

        it('writes the archive but leaves the saved fetch markers alone', async () => {
            // A backfilled window is months old; saving its markers would make
            // the SEO tab mark the wrong days as not final.
            const { service, archive, database } = setup({
                'gsc:credentials': JSON.stringify({ client_email: 'a@b.c', private_key: 'k' }),
                'gsc:siteUrl': 'sc-domain:tronrelic.com'
            }, true);
            queryMock.mockImplementation(async (request: { requestBody: { dimensions: string[] } }) => ({
                data: {
                    rows: [{ keys: request.requestBody.dimensions.map(d => (d === 'date' ? '2025-08-01' : `${d}-key`)), clicks: 2, impressions: 9, ctr: 0.22, position: 4 }],
                    metadata: { firstIncompleteDate: '2025-08-01' }
                }
            }));

            const result = await service.archiveWindow('2025-08-01', '2025-08-07');

            expect(result).toEqual({ rowsFetched: 3 });
            expect(archive.writeQueries).toHaveBeenCalledTimes(1);
            expect(archive.writeDailyTotals).toHaveBeenCalledTimes(1);
            expect(archive.writePageTotals).toHaveBeenCalledTimes(1);
            expect(database.set).not.toHaveBeenCalled();
        });

        it('refuses when the archive is disabled, before calling Google', async () => {
            const { service } = setup({}, false);

            await expect(service.archiveWindow('2025-08-01', '2025-08-07')).rejects.toThrow('ClickHouse is not configured');
            expect(queryMock).not.toHaveBeenCalled();
        });
    });
});
