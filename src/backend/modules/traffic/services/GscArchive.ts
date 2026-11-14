/**
 * @fileoverview ClickHouse implementation of the permanent Search Console archive.
 *
 * Writes the rows `GscService` fetches from Google into the `gsc_queries`,
 * `gsc_daily_totals`, and `gsc_page_totals` tables created by migration 023,
 * which have no TTL, and serves every Search Console read from them. Google
 * keeps only 16 months, so these tables are the only place older history
 * survives.
 *
 * - Inserts are synchronous: rows arrive already batched, one Search Console
 *   page (up to 5,000 rows) at a time, and a failed write must surface to the
 *   caller rather than to the async-insert error poller later.
 * - Pruning uses a lightweight `DELETE`, which ClickHouse supports on the
 *   `ReplacingMergeTree` engine these tables use.
 * - Reads use `FINAL`, so a refetched row ClickHouse has not merged yet is
 *   counted once.
 * - ClickHouse returns 64-bit sums as JSON strings, so every count is passed
 *   through `Number()`.
 */

import type { IClickHouseService, ISystemLogService } from '@/types';
import { formatClickHouseDateTime64Utc } from '../../../lib/formatClickHouseDateTime64Utc.js';
import type { IGscDailyTotalDocument, IGscPageTotalDocument, IGscQueryDocument } from './gsc.service.js';
import { parseGscDay, toGscDayKey } from './parseGscDay.js';
import type {
    GscArchiveTable,
    GscGranularity,
    GscKeywordMatch,
    IGscArchive,
    IGscArchiveBucketKeywordSums,
    IGscArchiveBucketTotals,
    IGscArchiveCoverage,
    IGscArchiveKeywordPageSums,
    IGscArchiveKeywordSums,
    IGscArchivePageSums
} from './IGscArchive.js';

/**
 * The SQL that maps a day to its bucket's first day. Taken from this fixed
 * map, never from caller text, so placing it in a statement is safe.
 */
const BUCKET_EXPRESSIONS: Readonly<Record<GscGranularity, string>> = {
    day: 'date',
    week: 'toMonday(date)',
    month: 'toStartOfMonth(date)'
};

/**
 * The summed columns every aggregate read selects, with position weighted by
 * impressions. The aliases differ from the column names on purpose: ClickHouse
 * substitutes a SELECT alias wherever its name appears in the same list, so
 * `sum(impressions) AS impressions` would turn the weighted sum into a sum
 * nested inside a sum, which ClickHouse rejects.
 */
const SUM_COLUMNS = 'sum(clicks) AS total_clicks, sum(impressions) AS total_impressions, sum(position * impressions) AS weighted_position';

/** The day-range filter every read applies, with both bounds bound as parameters. */
const WINDOW_FILTER = 'date BETWEEN {since:Date} AND {end:Date}';

/** A summed row as ClickHouse returns it, before counts are converted to numbers. */
interface IRawSums {
    total_clicks: string | number;
    total_impressions: string | number;
    weighted_position: string | number;
}

/** Convert a raw summed row's counts to numbers under the archive's field names. */
function toSums(row: IRawSums): { clicks: number; impressions: number; weightedPosition: number } {
    return {
        clicks: Number(row.total_clicks),
        impressions: Number(row.total_impressions),
        weightedPosition: Number(row.weighted_position)
    };
}

/** The optional `LIMIT` clause, bound as a parameter when the caller sets a limit. */
function limitClause(limit: number | undefined): string {
    return limit && limit > 0 ? 'LIMIT {limit:UInt32}' : '';
}

/**
 * Add the `limit` parameter only when `limitClause` placed its placeholder,
 * so no unused or undefined value is sent with the query.
 *
 * @param params - The read's other parameters.
 * @param limit - The caller's limit, if any.
 * @returns The parameters to send.
 */
function withLimit(params: Record<string, unknown>, limit: number | undefined): Record<string, unknown> {
    return limit && limit > 0 ? { ...params, limit } : params;
}



/**
 * Stores Search Console rows permanently in ClickHouse.
 */
export class GscArchive implements IGscArchive {
    /**
     * @param clickhouse - The shared ClickHouse connection, or undefined when
     *   the deployment has none. Without it the archive reports itself
     *   disabled, every write throws, and every read returns nothing.
     * @param logger - Module logger, so prune results appear on the traffic
     *   module's log stream.
     */
    constructor(
        private readonly clickhouse: IClickHouseService | undefined,
        private readonly logger: ISystemLogService
    ) {}

    /**
     * Report whether a ClickHouse connection was supplied.
     *
     * @returns True when the archive can be written.
     */
    isEnabled(): boolean {
        return this.clickhouse !== undefined;
    }

    /**
     * Store keyword rows in `gsc_queries`.
     *
     * @param rows - Rows from one fetched page of Search Console results.
     */
    async writeQueries(rows: IGscQueryDocument[]): Promise<void> {
        await this.insert('gsc_queries', rows.map(row => ({
            date: toGscDayKey(row.date),
            query: row.query,
            page: row.page,
            country: row.country,
            device: row.device,
            clicks: row.clicks,
            impressions: row.impressions,
            ctr: row.ctr,
            position: row.position,
            fetched_at: formatClickHouseDateTime64Utc(row.fetchedAt)
        })));
    }

    /**
     * Store per-day site totals in `gsc_daily_totals`.
     *
     * @param rows - One row per fetched day.
     */
    async writeDailyTotals(rows: IGscDailyTotalDocument[]): Promise<void> {
        await this.insert('gsc_daily_totals', rows.map(row => ({
            date: toGscDayKey(row.date),
            clicks: row.clicks,
            impressions: row.impressions,
            fetched_at: formatClickHouseDateTime64Utc(row.fetchedAt)
        })));
    }

    /**
     * Store per-day page totals in `gsc_page_totals`.
     *
     * @param rows - Rows from one fetched page of Search Console results.
     */
    async writePageTotals(rows: IGscPageTotalDocument[]): Promise<void> {
        await this.insert('gsc_page_totals', rows.map(row => ({
            date: toGscDayKey(row.date),
            page: row.page,
            clicks: row.clicks,
            impressions: row.impressions,
            ctr: row.ctr,
            position: row.position,
            fetched_at: formatClickHouseDateTime64Utc(row.fetchedAt)
        })));
    }

    /**
     * Delete rows in a refetched window that carry an older fetch stamp than
     * the run that just wrote it. Rows the run wrote carry its own stamp and
     * are never matched, so the delete is safe whenever ClickHouse applies it.
     *
     * @param table - The table the fetch just wrote to.
     * @param start - First day of the window (YYYY-MM-DD), inclusive.
     * @param end - Last day of the window (YYYY-MM-DD), inclusive.
     * @param fetchedAt - The stamp the run wrote on every row.
     * @throws Error when a day is not a real `YYYY-MM-DD` day, before any SQL
     *   runs. The days are placed in the statement as text, because
     *   `IClickHouseService.exec` takes no bound parameters.
     */
    async prune(table: GscArchiveTable, start: string, end: string, fetchedAt: Date): Promise<void> {
        if (!parseGscDay(start) || !parseGscDay(end)) {
            throw new Error(`GSC archive prune needs YYYY-MM-DD days, got "${start}" to "${end}"`);
        }
        const stamp = formatClickHouseDateTime64Utc(fetchedAt);
        await this.requireClickHouse().exec(
            `DELETE FROM ${table} WHERE date BETWEEN toDate('${start}') AND toDate('${end}') ` +
            `AND fetched_at < toDateTime64('${stamp}', 3, 'UTC')`
        );
        this.logger.debug({ table, start, end }, 'GSC archive window pruned');
    }

    /**
     * Read the archived day range from `gsc_daily_totals`. Counts distinct
     * days rather than rows, so a refetched day not yet merged by ClickHouse
     * is not counted twice.
     *
     * @returns The earliest and latest archived day and the day count.
     */
    async getCoverage(): Promise<IGscArchiveCoverage> {
        const [row] = await this.select<{ firstDate: string; lastDate: string; days: string | number }>(
            'SELECT toString(min(date)) AS firstDate, toString(max(date)) AS lastDate, uniqExact(date) AS days FROM gsc_daily_totals',
            {}
        );
        const days = Number(row?.days ?? 0);
        return {
            firstDate: days > 0 ? row.firstDate : null,
            lastDate: days > 0 ? row.lastDate : null,
            days
        };
    }

    /**
     * Sum each query over the window, most clicks first, with ties broken by
     * the query so equal rows keep one order between calls.
     *
     * @param since - First day (YYYY-MM-DD), inclusive.
     * @param end - Last day (YYYY-MM-DD), inclusive.
     * @param limit - Most rows to return; omit for every query.
     * @returns One row per query.
     */
    async sumByKeyword(since: string, end: string, limit?: number): Promise<IGscArchiveKeywordSums[]> {
        const rows = await this.select<IRawSums & { keyword: string }>(
            `SELECT query AS keyword, ${SUM_COLUMNS} FROM gsc_queries FINAL WHERE ${WINDOW_FILTER} ` +
            `GROUP BY keyword ORDER BY total_clicks DESC, keyword ASC ${limitClause(limit)}`,
            withLimit({ since, end }, limit)
        );
        return rows.map(row => ({ keyword: row.keyword, ...toSums(row) }));
    }

    /**
     * Sum each landing page over the window from the page totals, most clicks
     * then impressions first, so pages shown without a click still rank.
     *
     * @param since - First day (YYYY-MM-DD), inclusive.
     * @param end - Last day (YYYY-MM-DD), inclusive.
     * @param limit - Most rows to return.
     * @returns One row per page.
     */
    async sumByPage(since: string, end: string, limit: number): Promise<IGscArchivePageSums[]> {
        const rows = await this.select<IRawSums & { page: string }>(
            `SELECT page, ${SUM_COLUMNS} FROM gsc_page_totals FINAL WHERE ${WINDOW_FILTER} ` +
            `GROUP BY page ORDER BY total_clicks DESC, total_impressions DESC, page ASC ${limitClause(limit)}`,
            withLimit({ since, end }, limit)
        );
        return rows.map(row => ({ page: row.page, ...toSums(row) }));
    }

    /**
     * Sum each query and page pair over the window, most clicks then
     * impressions first.
     *
     * @param since - First day (YYYY-MM-DD), inclusive.
     * @param end - Last day (YYYY-MM-DD), inclusive.
     * @param limit - Most rows to return; omit for every pair.
     * @returns One row per pair.
     */
    async sumByKeywordPage(since: string, end: string, limit?: number): Promise<IGscArchiveKeywordPageSums[]> {
        const rows = await this.select<IRawSums & { keyword: string; page: string }>(
            `SELECT query AS keyword, page, ${SUM_COLUMNS} FROM gsc_queries FINAL WHERE ${WINDOW_FILTER} ` +
            `GROUP BY keyword, page ORDER BY total_clicks DESC, total_impressions DESC, keyword ASC, page ASC ${limitClause(limit)}`,
            withLimit({ since, end }, limit)
        );
        return rows.map(row => ({ keyword: row.keyword, page: row.page, ...toSums(row) }));
    }

    /**
     * Sum the site's daily totals into buckets, oldest first.
     *
     * @param since - First day (YYYY-MM-DD), inclusive.
     * @param end - Last day (YYYY-MM-DD), inclusive.
     * @param granularity - Bucket size.
     * @returns One row per bucket that has data.
     */
    async sumTotalsByBucket(since: string, end: string, granularity: GscGranularity): Promise<IGscArchiveBucketTotals[]> {
        const rows = await this.select<{ bucket: string; total_clicks: string | number; total_impressions: string | number }>(
            `SELECT toString(${BUCKET_EXPRESSIONS[granularity]}) AS bucket, sum(clicks) AS total_clicks, sum(impressions) AS total_impressions ` +
            `FROM gsc_daily_totals FINAL WHERE ${WINDOW_FILTER} GROUP BY bucket ORDER BY bucket ASC`,
            { since, end }
        );
        return rows.map(row => ({ bucket: row.bucket, clicks: Number(row.total_clicks), impressions: Number(row.total_impressions) }));
    }

    /**
     * The top queries by clicks within each bucket, using `LIMIT n BY` so the
     * cut happens in ClickHouse rather than after every query is sent back.
     *
     * @param since - First day (YYYY-MM-DD), inclusive.
     * @param end - Last day (YYYY-MM-DD), inclusive.
     * @param granularity - Bucket size.
     * @param topN - Most queries per bucket.
     * @returns Rows ordered by bucket, then clicks descending.
     */
    async topKeywordsByBucket(since: string, end: string, granularity: GscGranularity, topN: number): Promise<IGscArchiveBucketKeywordSums[]> {
        const rows = await this.select<IRawSums & { bucket: string; keyword: string }>(
            `SELECT toString(${BUCKET_EXPRESSIONS[granularity]}) AS bucket, query AS keyword, ${SUM_COLUMNS} ` +
            `FROM gsc_queries FINAL WHERE ${WINDOW_FILTER} GROUP BY bucket, keyword ` +
            'ORDER BY bucket ASC, total_clicks DESC, keyword ASC LIMIT {topN:UInt32} BY bucket',
            { since, end, topN }
        );
        return rows.map(row => ({ bucket: row.bucket, keyword: row.keyword, ...toSums(row) }));
    }

    /**
     * Sum the queries matching one keyword per bucket and query. A `contains`
     * match uses a case-insensitive substring test with the keyword bound as
     * a parameter, so it is always literal text and never a pattern.
     *
     * @param keyword - The keyword, already trimmed and lower-cased.
     * @param match - `exact` or `contains`.
     * @param since - First day (YYYY-MM-DD), inclusive.
     * @param end - Last day (YYYY-MM-DD), inclusive.
     * @param granularity - Bucket size.
     * @returns One row per bucket and matching query.
     */
    async keywordSumsByBucket(
        keyword: string,
        match: GscKeywordMatch,
        since: string,
        end: string,
        granularity: GscGranularity
    ): Promise<IGscArchiveBucketKeywordSums[]> {
        const keywordFilter = match === 'contains'
            ? 'positionCaseInsensitiveUTF8(query, {keyword:String}) > 0'
            : 'query = {keyword:String}';
        const rows = await this.select<IRawSums & { bucket: string; keyword: string }>(
            `SELECT toString(${BUCKET_EXPRESSIONS[granularity]}) AS bucket, query AS keyword, ${SUM_COLUMNS} ` +
            `FROM gsc_queries FINAL WHERE ${WINDOW_FILTER} AND ${keywordFilter} GROUP BY bucket, keyword`,
            { since, end, keyword }
        );
        return rows.map(row => ({ bucket: row.bucket, keyword: row.keyword, ...toSums(row) }));
    }

    /**
     * Run a read, or return no rows when the deployment has no ClickHouse, so
     * a read degrades to an empty answer like the module's other
     * ClickHouse-backed reads instead of failing the request.
     *
     * @param sql - Statement with `{name:Type}` placeholders.
     * @param params - Values for the placeholders.
     * @returns The rows, or an empty array without ClickHouse.
     */
    private async select<T>(sql: string, params: Record<string, unknown>): Promise<T[]> {
        let rows: T[] = [];
        if (this.clickhouse) {
            rows = await this.clickhouse.query<T>(sql, params);
        }
        return rows;
    }

    /**
     * Insert already-batched rows, skipping the call when there are none.
     *
     * @param table - Target archive table.
     * @param rows - Rows shaped to the table's columns.
     */
    private async insert(table: GscArchiveTable, rows: Array<Record<string, unknown>>): Promise<void> {
        if (rows.length > 0) {
            await this.requireClickHouse().insert(table, rows, { synchronous: true });
        }
    }

    /**
     * Return the ClickHouse connection or fail loudly. Callers check
     * `isEnabled()` first, so reaching the throw means a caller skipped it.
     *
     * @returns The connection supplied at construction.
     */
    private requireClickHouse(): IClickHouseService {
        if (!this.clickhouse) {
            throw new Error('GSC archive is disabled: ClickHouse is not configured');
        }
        return this.clickhouse;
    }
}
