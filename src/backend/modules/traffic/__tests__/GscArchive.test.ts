/// <reference types="vitest" />

/**
 * GscArchive unit tests.
 *
 * Covers how stored documents become ClickHouse rows, that inserts are
 * synchronous so a failed write reaches the caller, the prune statement and
 * the input check that guards it (`exec` takes no bound parameters), the
 * coverage read's handling of an empty archive, and the read statements:
 * bound parameters, FINAL, distinct aliases, and empty results without
 * ClickHouse.
 */

import { describe, it, expect, vi } from 'vitest';
import type { IClickHouseService, ISystemLogService } from '@/types';
import { GscArchive } from '../services/GscArchive.js';

/** Logger double; the archive only logs prune results at debug level. */
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
 * Build a ClickHouse double whose methods are spies.
 *
 * @param queryRows - Rows the `query` spy resolves with.
 * @returns The double and its spies.
 */
function createClickHouse(queryRows: unknown[] = []): {
    clickhouse: IClickHouseService;
    insert: ReturnType<typeof vi.fn>;
    exec: ReturnType<typeof vi.fn>;
    query: ReturnType<typeof vi.fn>;
} {
    const insert = vi.fn(async () => undefined);
    const exec = vi.fn(async () => undefined);
    const query = vi.fn(async () => queryRows);
    const clickhouse = { insert, exec, query, ping: vi.fn() } as unknown as IClickHouseService;
    return { clickhouse, insert, exec, query };
}

/** The run stamp every document in these tests carries. */
const FETCHED_AT = new Date('2026-11-10T03:00:00.123Z');

describe('GscArchive', () => {
    it('reports itself disabled without ClickHouse and refuses writes and prunes', async () => {
        const archive = new GscArchive(undefined, createMockLogger());

        expect(archive.isEnabled()).toBe(false);
        await expect(archive.writeDailyTotals([{ date: new Date('2026-10-07'), clicks: 1, impressions: 2, fetchedAt: FETCHED_AT }]))
            .rejects.toThrow('ClickHouse is not configured');
        await expect(archive.prune('gsc_queries', '2026-10-01', '2026-10-07', FETCHED_AT))
            .rejects.toThrow('ClickHouse is not configured');
    });

    it('writes keyword rows as day keys and native timestamps, synchronously', async () => {
        const { clickhouse, insert } = createClickHouse();
        const archive = new GscArchive(clickhouse, createMockLogger());

        await archive.writeQueries([{
            query: 'tron energy',
            page: 'https://tronrelic.com/',
            country: 'usa',
            device: 'DESKTOP',
            date: new Date('2026-10-07'),
            clicks: 1,
            impressions: 5,
            ctr: 0.2,
            position: 3,
            fetchedAt: FETCHED_AT
        }]);

        expect(insert).toHaveBeenCalledWith('gsc_queries', [{
            date: '2026-10-07',
            query: 'tron energy',
            page: 'https://tronrelic.com/',
            country: 'usa',
            device: 'DESKTOP',
            clicks: 1,
            impressions: 5,
            ctr: 0.2,
            position: 3,
            fetched_at: '2026-11-10 03:00:00.123'
        }], { synchronous: true });
    });

    it('skips the insert when there are no rows', async () => {
        const { clickhouse, insert } = createClickHouse();
        const archive = new GscArchive(clickhouse, createMockLogger());

        await archive.writePageTotals([]);

        expect(insert).not.toHaveBeenCalled();
    });

    it('prunes only rows older than the run inside the window', async () => {
        const { clickhouse, exec } = createClickHouse();
        const archive = new GscArchive(clickhouse, createMockLogger());

        await archive.prune('gsc_page_totals', '2026-10-01', '2026-10-07', FETCHED_AT);

        expect(exec).toHaveBeenCalledWith(
            "DELETE FROM gsc_page_totals WHERE date BETWEEN toDate('2026-10-01') AND toDate('2026-10-07') " +
            "AND fetched_at < toDateTime64('2026-11-10 03:00:00.123', 3, 'UTC')"
        );
    });

    it('refuses to prune with a day that is not YYYY-MM-DD, before any SQL runs', async () => {
        // The days are placed in the statement as text, so anything else
        // must never reach ClickHouse.
        const { clickhouse, exec } = createClickHouse();
        const archive = new GscArchive(clickhouse, createMockLogger());

        await expect(archive.prune('gsc_queries', "2026-10-01') OR 1=1 --", '2026-10-07', FETCHED_AT))
            .rejects.toThrow('YYYY-MM-DD');
        expect(exec).not.toHaveBeenCalled();
    });

    it('reports null bounds for an empty archive', async () => {
        // min() and max() of an empty table return 1970-01-01, not null.
        const { clickhouse } = createClickHouse([{ firstDate: '1970-01-01', lastDate: '1970-01-01', days: '0' }]);
        const archive = new GscArchive(clickhouse, createMockLogger());

        await expect(archive.getCoverage()).resolves.toEqual({ firstDate: null, lastDate: null, days: 0 });
    });

    it('returns no rows from every read without ClickHouse', async () => {
        // Matches the module's other ClickHouse-backed reads, which degrade to
        // empty instead of failing the request.
        const archive = new GscArchive(undefined, createMockLogger());

        await expect(archive.sumByKeyword('2026-09-01', '2026-09-30', 10)).resolves.toEqual([]);
        await expect(archive.getCoverage()).resolves.toEqual({ firstDate: null, lastDate: null, days: 0 });
    });

    it('sums keywords with bound day parameters, FINAL, and numeric counts', async () => {
        // ClickHouse returns 64-bit sums as strings, and an unmerged refetch
        // must be counted once.
        const { clickhouse, query } = createClickHouse([
            { keyword: 'tron energy', total_clicks: '3', total_impressions: '40', weighted_position: 120 }
        ]);
        const archive = new GscArchive(clickhouse, createMockLogger());

        const rows = await archive.sumByKeyword('2026-09-01', '2026-09-30', 10);

        const [sql, params] = query.mock.calls[0];
        expect(sql).toContain('FROM gsc_queries FINAL');
        expect(sql).toContain('date BETWEEN {since:Date} AND {end:Date}');
        expect(sql).toContain('LIMIT {limit:UInt32}');
        expect(params).toEqual({ since: '2026-09-01', end: '2026-09-30', limit: 10 });
        expect(rows).toEqual([{ keyword: 'tron energy', clicks: 3, impressions: 40, weightedPosition: 120 }]);
    });

    it('sends no limit when the caller asks for every pair', async () => {
        const { clickhouse, query } = createClickHouse();
        const archive = new GscArchive(clickhouse, createMockLogger());

        await archive.sumByKeywordPage('2026-09-01', '2026-09-30');

        const [sql, params] = query.mock.calls[0];
        expect(sql).not.toContain('LIMIT');
        expect(params).toEqual({ since: '2026-09-01', end: '2026-09-30' });
    });

    it('keeps aggregate aliases distinct from column names', async () => {
        // ClickHouse substitutes a SELECT alias wherever its name appears in
        // the same list, so `sum(impressions) AS impressions` would nest one
        // sum inside another in the weighted-position column.
        const { clickhouse, query } = createClickHouse();
        const archive = new GscArchive(clickhouse, createMockLogger());

        await archive.topKeywordsByBucket('2026-01-01', '2026-09-30', 'week', 3);

        const [sql, params] = query.mock.calls[0];
        expect(sql).not.toMatch(/AS (clicks|impressions)\b/);
        expect(sql).toContain('toMonday(date)');
        expect(sql).toContain('LIMIT {topN:UInt32} BY bucket');
        expect(params).toEqual({ since: '2026-01-01', end: '2026-09-30', topN: 3 });
    });

    it('matches a contains keyword as bound literal text, never as a pattern', async () => {
        const { clickhouse, query } = createClickHouse();
        const archive = new GscArchive(clickhouse, createMockLogger());

        await archive.keywordSumsByBucket('trx (tron)', 'contains', '2026-01-01', '2026-09-30', 'month');
        await archive.keywordSumsByBucket('tron energy', 'exact', '2026-01-01', '2026-09-30', 'day');

        expect(query.mock.calls[0][0]).toContain('positionCaseInsensitiveUTF8(query, {keyword:String}) > 0');
        expect(query.mock.calls[0][0]).toContain('toStartOfMonth(date)');
        expect(query.mock.calls[0][1]).toMatchObject({ keyword: 'trx (tron)' });
        expect(query.mock.calls[1][0]).toContain('query = {keyword:String}');
    });

    it('reports the archived range and day count', async () => {
        const { clickhouse } = createClickHouse([{ firstDate: '2025-07-13', lastDate: '2026-11-10', days: '486' }]);
        const archive = new GscArchive(clickhouse, createMockLogger());

        await expect(archive.getCoverage()).resolves.toEqual({ firstDate: '2025-07-13', lastDate: '2026-11-10', days: 486 });
    });
});
