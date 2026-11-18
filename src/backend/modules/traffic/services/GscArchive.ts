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
 * - Ranked reads bind every filter value as a parameter and take their
 *   ORDER BY from a fixed map, so caller input never becomes SQL text.
 */

import type { IClickHouseService, ISystemLogService } from '@/types';
import { formatClickHouseDateTime64Utc } from '../../../lib/formatClickHouseDateTime64Utc.js';
import type { IGscDailyTotalDocument, IGscPageTotalDocument, IGscQueryDocument } from './gsc.service.js';
import { parseGscDay, toGscDayKey } from './parseGscDay.js';
import type {
    GscArchiveTable,
    GscGranularity,
    GscKeywordMatch,
    GscRankSort,
    IGscArchive,
    IGscArchiveBucketKeywordSums,
    IGscArchiveBucketTotals,
    IGscArchiveCoverage,
    IGscArchiveKeywordPageSums,
    IGscArchiveKeywordSums,
    IGscArchivePageSums,
    IGscQueryRankedReadOptions,
    IGscRankedReadOptions,
    IGscRankedRows
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

/**
 * The impression-weighted average position, rounded to one decimal so the
 * position filters and the position ranking work on the same figure the
 * reads report. A group with no impressions has no position, so every filter
 * on it also requires `total_impressions > 0`.
 */
const AVERAGE_POSITION = 'round(weighted_position / total_impressions, 1)';

/**
 * The leading ORDER BY terms for each ranking, taken from this fixed map and
 * never from caller text. Every ranking breaks ties on a second figure before
 * the row's own key, because on a low-traffic site most rows have zero
 * clicks, and an alphabetical tie-break would then decide which of them a
 * capped read returns.
 */
const RANK_ORDER: Readonly<Record<GscRankSort, string>> = {
    clicks: 'total_clicks DESC, total_impressions DESC',
    impressions: 'total_impressions DESC, total_clicks DESC',
    position: `${AVERAGE_POSITION} ASC, total_impressions DESC`
};

/**
 * What differs between the three ranked reads: the table, the grouping
 * columns, and the final tie-break that keeps rows equal on every figure in
 * one order, so consecutive pages neither repeat nor skip a row.
 */
interface IRankedReadSpec {
    /** Table to read. */
    table: 'gsc_queries' | 'gsc_page_totals';
    /** Grouping columns as selected, such as `query AS keyword`. */
    columns: string;
    /** GROUP BY list, naming the aliases in `columns`. */
    groupBy: string;
    /** Last ORDER BY terms. */
    tieBreak: string;
}

/** One row per search query, from the keyword rows. */
const KEYWORD_READ: IRankedReadSpec = { table: 'gsc_queries', columns: 'query AS keyword', groupBy: 'keyword', tieBreak: 'keyword ASC' };

/** One row per landing page, from the anonymization-immune page totals. */
const PAGE_READ: IRankedReadSpec = { table: 'gsc_page_totals', columns: 'page', groupBy: 'page', tieBreak: 'page ASC' };

/** One row per query and the page it surfaced, from the keyword rows. */
const KEYWORD_PAGE_READ: IRankedReadSpec = {
    table: 'gsc_queries',
    columns: 'query AS keyword, page',
    groupBy: 'keyword, page',
    tieBreak: 'keyword ASC, page ASC'
};

/**
 * The condition matching stored queries against the bound `{keyword:String}`
 * parameter. A `contains` match is a case-insensitive substring test, so the
 * keyword is always literal text and never a pattern.
 */
function keywordCondition(match: GscKeywordMatch): string {
    return match === 'contains'
        ? 'positionCaseInsensitiveUTF8(query, {keyword:String}) > 0'
        : 'query = {keyword:String}';
}

/**
 * Turn a ranked read's options into conditions on the stored rows, conditions
 * on the summed window totals, and the parameters both bind. Every value is
 * bound rather than placed in the statement, so caller text cannot change the
 * query's shape.
 *
 * Page filters compare the URL's path, because Search Console reports full
 * URLs while callers think in paths such as `/blog/`.
 *
 * @param options - The read's options. Only the reads over keyword rows set
 *   `keyword`, since only those rows carry a query.
 * @returns The WHERE and HAVING conditions and their parameters.
 */
function rankedConditions(options: IGscQueryRankedReadOptions): {
    where: string[];
    having: string[];
    params: Record<string, unknown>;
} {
    const where: string[] = [WINDOW_FILTER];
    const having: string[] = [];
    const params: Record<string, unknown> = {};
    if (options.keyword !== undefined) {
        where.push(keywordCondition(options.match ?? 'exact'));
        params.keyword = options.keyword;
    }
    if (options.pagePath !== undefined) {
        where.push('path(page) = {pagePath:String}');
        params.pagePath = options.pagePath;
    }
    if (options.pathPrefix !== undefined) {
        where.push('startsWith(path(page), {pathPrefix:String})');
        params.pathPrefix = options.pathPrefix;
    }
    if (options.minImpressions !== undefined) {
        having.push('total_impressions >= {minImpressions:UInt64}');
        params.minImpressions = options.minImpressions;
    }
    if (options.minPosition !== undefined || options.maxPosition !== undefined) {
        having.push('total_impressions > 0');
    }
    if (options.minPosition !== undefined) {
        having.push(`${AVERAGE_POSITION} >= {minPosition:Float64}`);
        params.minPosition = options.minPosition;
    }
    if (options.maxPosition !== undefined) {
        having.push(`${AVERAGE_POSITION} <= {maxPosition:Float64}`);
        params.maxPosition = options.maxPosition;
    }
    return { where, having, params };
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
     * Sum each query over the window, ranked by `options.sort`.
     *
     * @param since - First day (YYYY-MM-DD), inclusive.
     * @param end - Last day (YYYY-MM-DD), inclusive.
     * @param options - Ranking, paging, and filters; omit for every query, most clicks first.
     * @returns The requested rows and how many queries matched in all.
     */
    async sumByKeyword(since: string, end: string, options: IGscQueryRankedReadOptions = {}): Promise<IGscRankedRows<IGscArchiveKeywordSums>> {
        const result = await this.rankedRead<{ keyword: string }>(KEYWORD_READ, since, end, options);
        return { rows: result.rows.map(row => ({ keyword: row.keyword, ...toSums(row) })), total: result.total };
    }

    /**
     * Sum each landing page over the window from the page totals, ranked by
     * `options.sort`. Pages shown without a click still rank, on impressions.
     *
     * @param since - First day (YYYY-MM-DD), inclusive.
     * @param end - Last day (YYYY-MM-DD), inclusive.
     * @param options - Ranking, paging, and filters; omit for every page, most clicks first.
     * @returns The requested rows and how many pages matched in all.
     */
    async sumByPage(since: string, end: string, options: IGscRankedReadOptions = {}): Promise<IGscRankedRows<IGscArchivePageSums>> {
        const result = await this.rankedRead<{ page: string }>(PAGE_READ, since, end, options);
        return { rows: result.rows.map(row => ({ page: row.page, ...toSums(row) })), total: result.total };
    }

    /**
     * Sum each query and page pair over the window, ranked by `options.sort`.
     *
     * @param since - First day (YYYY-MM-DD), inclusive.
     * @param end - Last day (YYYY-MM-DD), inclusive.
     * @param options - Ranking, paging, and filters; omit for every pair, most clicks first.
     * @returns The requested rows and how many pairs matched in all.
     */
    async sumByKeywordPage(
        since: string,
        end: string,
        options: IGscQueryRankedReadOptions = {}
    ): Promise<IGscRankedRows<IGscArchiveKeywordPageSums>> {
        const result = await this.rankedRead<{ keyword: string; page: string }>(KEYWORD_PAGE_READ, since, end, options);
        return {
            rows: result.rows.map(row => ({ keyword: row.keyword, page: row.page, ...toSums(row) })),
            total: result.total
        };
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
     * Ties fall to impressions before the query text, so a bucket whose
     * queries all have zero clicks keeps its most-shown ones rather than the
     * alphabetically first.
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
            'ORDER BY bucket ASC, total_clicks DESC, total_impressions DESC, keyword ASC LIMIT {topN:UInt32} BY bucket',
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
        const rows = await this.select<IRawSums & { bucket: string; keyword: string }>(
            `SELECT toString(${BUCKET_EXPRESSIONS[granularity]}) AS bucket, query AS keyword, ${SUM_COLUMNS} ` +
            `FROM gsc_queries FINAL WHERE ${WINDOW_FILTER} AND ${keywordCondition(match)} GROUP BY bucket, keyword`,
            { since, end, keyword }
        );
        return rows.map(row => ({ bucket: row.bucket, keyword: row.keyword, ...toSums(row) }));
    }

    /**
     * Run one ranked read: the requested rows, and alongside them a count of
     * every group that matched, so a capped caller can tell whether more pages
     * exist. An uncapped read returns every row, so its length is the count
     * and no second statement runs.
     *
     * The count wraps the same grouped statement as the rows, so the two can
     * never disagree about which groups pass the filters.
     *
     * @param spec - The table and grouping the read uses.
     * @param since - First day (YYYY-MM-DD), inclusive.
     * @param end - Last day (YYYY-MM-DD), inclusive.
     * @param options - Ranking, paging, and filters.
     * @returns The raw rows and the matched total.
     */
    private async rankedRead<T>(
        spec: IRankedReadSpec,
        since: string,
        end: string,
        options: IGscQueryRankedReadOptions
    ): Promise<IGscRankedRows<IRawSums & T>> {
        const conditions = rankedConditions(options);
        const having = conditions.having.length > 0 ? ` HAVING ${conditions.having.join(' AND ')}` : '';
        const grouped =
            `SELECT ${spec.columns}, ${SUM_COLUMNS} FROM ${spec.table} FINAL ` +
            `WHERE ${conditions.where.join(' AND ')} GROUP BY ${spec.groupBy}${having}`;
        const ordered = `${grouped} ORDER BY ${RANK_ORDER[options.sort ?? 'clicks']}, ${spec.tieBreak}`;
        const params = { since, end, ...conditions.params };
        const capped = options.limit !== undefined && options.limit > 0;

        const [rows, counted] = await Promise.all([
            capped
                ? this.select<IRawSums & T>(
                    `${ordered} LIMIT {limit:UInt32} OFFSET {offset:UInt32}`,
                    { ...params, limit: options.limit, offset: options.offset ?? 0 }
                )
                : this.select<IRawSums & T>(ordered, params),
            capped
                ? this.select<{ total: string | number }>(`SELECT count() AS total FROM (${grouped})`, params)
                : Promise.resolve(null)
        ]);

        return { rows, total: counted ? Number(counted[0]?.total ?? 0) : rows.length };
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
