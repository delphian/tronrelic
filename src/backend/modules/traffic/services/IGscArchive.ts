/**
 * @fileoverview Contract for the permanent store of Google Search Console data.
 *
 * The archive keeps every fetched day for good, and every Search Console read
 * the dashboard and the AI tools make is served from it. `GscService` depends
 * on this interface rather than on ClickHouse, so its tests can supply a
 * double. Without ClickHouse the archive reports itself disabled: writes
 * throw and reads return nothing, matching how the module's other
 * ClickHouse-backed reads behave.
 */

import type { IGscDailyTotalDocument, IGscPageTotalDocument, IGscQueryDocument } from './gsc.service.js';

/** The archive tables, one per kind of Search Console request. */
export type GscArchiveTable = 'gsc_queries' | 'gsc_daily_totals' | 'gsc_page_totals';

/**
 * How a time series is bucketed. Long windows use weeks or months so a chart
 * and an AI tool response stay a readable size.
 */
export type GscGranularity = 'day' | 'week' | 'month';

/** How a keyword read matches stored queries: one query, or every query holding the text. */
export type GscKeywordMatch = 'exact' | 'contains';

/**
 * Which figure a ranked read orders its rows by: most clicks, most
 * impressions, or best (lowest) average position first.
 */
export type GscRankSort = 'clicks' | 'impressions' | 'position';

/**
 * Options that narrow, order, and page a ranked read.
 *
 * A capped read is only useful when the caller decides which rows it gets. On
 * a low-traffic site almost every query has zero clicks, so a fixed "most
 * clicks first" cap returns an arbitrary slice of them, while the rows worth
 * acting on are the ones with many impressions or a middling position. The
 * figure filters apply to totals summed over the whole window, so "at least
 * 10 impressions" means 10 across the window, not on any one day.
 */
export interface IGscRankedReadOptions {
    /** Figure to rank by. Defaults to `clicks`. */
    sort?: GscRankSort;
    /** Most rows to return; omit for every matching row. */
    limit?: number;
    /** Matching rows to skip before the returned ones, for paging. Applied only together with `limit`. */
    offset?: number;
    /** Keep only groups with at least this many impressions in the window. */
    minImpressions?: number;
    /** Keep only groups whose average position, rounded to one decimal as the reads report it, is at least this. */
    minPosition?: number;
    /** Keep only groups whose average position, rounded to one decimal, is at most this. */
    maxPosition?: number;
    /** Keep only rows whose landing page has exactly this path, such as `/resource-markets`. */
    pagePath?: string;
    /** Keep only rows whose landing page path starts with this, such as `/blog/`. */
    pathPrefix?: string;
}

/**
 * Ranked-read options for the reads over keyword rows, which can also filter
 * by the query text because those rows carry it.
 */
export interface IGscQueryRankedReadOptions extends IGscRankedReadOptions {
    /** Keep only queries matching this text, already trimmed and lower-cased. */
    keyword?: string;
    /** How `keyword` matches stored queries. Defaults to `exact`. */
    match?: GscKeywordMatch;
}

/**
 * One page of a ranked read and the number of rows that matched in all, so a
 * caller can tell whether more pages exist.
 */
export interface IGscRankedRows<T> {
    /** The requested rows, in rank order. */
    rows: T[];
    /** Rows matching the window and filters, before `limit` and `offset` were applied. */
    total: number;
}

/**
 * How much of the site's search history the archive holds, read from the
 * daily totals table because it carries exactly one row per fetched day.
 */
export interface IGscArchiveCoverage {
    /** Earliest archived day (YYYY-MM-DD), or null when the archive is empty. */
    firstDate: string | null;
    /** Latest archived day (YYYY-MM-DD), or null when the archive is empty. */
    lastDate: string | null;
    /** Number of distinct archived days. */
    days: number;
}

/**
 * Summed search figures for one group. Position is returned weighted by
 * impressions (sum of position × impressions), so the caller can average it
 * correctly across any grouping.
 */
export interface IGscArchiveSums {
    /** Total clicks. */
    clicks: number;
    /** Total impressions. */
    impressions: number;
    /** Sum of position × impressions. */
    weightedPosition: number;
}

/** Sums for one search query. */
export interface IGscArchiveKeywordSums extends IGscArchiveSums {
    /** The search query. */
    keyword: string;
}

/** Sums for one landing page. */
export interface IGscArchivePageSums extends IGscArchiveSums {
    /** Landing page URL. */
    page: string;
}

/** Sums for one query and the page it surfaced. */
export interface IGscArchiveKeywordPageSums extends IGscArchiveSums {
    /** The search query. */
    keyword: string;
    /** Landing page URL. */
    page: string;
}

/** Site totals for one time bucket, from the anonymization-immune daily totals. */
export interface IGscArchiveBucketTotals {
    /** First day of the bucket (YYYY-MM-DD). */
    bucket: string;
    /** Total clicks in the bucket. */
    clicks: number;
    /** Total impressions in the bucket. */
    impressions: number;
}

/** Sums for one query within one time bucket. */
export interface IGscArchiveBucketKeywordSums extends IGscArchiveKeywordSums {
    /** First day of the bucket (YYYY-MM-DD). */
    bucket: string;
}

/**
 * Write, prune, and read operations on the permanent Search Console archive.
 * Every read takes inclusive `YYYY-MM-DD` day bounds.
 */
export interface IGscArchive {
    /**
     * Whether ClickHouse is configured. When false, writes throw and reads
     * return empty results.
     */
    isEnabled(): boolean;

    /**
     * Store keyword rows. A row already archived for the same day, keyword,
     * page, country, and device is replaced by the newer fetch.
     *
     * @param rows - Rows from one fetched page of Search Console results.
     */
    writeQueries(rows: IGscQueryDocument[]): Promise<void>;

    /**
     * Store per-day site totals, replacing any earlier fetch of the same day.
     *
     * @param rows - One row per fetched day.
     */
    writeDailyTotals(rows: IGscDailyTotalDocument[]): Promise<void>;

    /**
     * Store per-day page totals, replacing any earlier fetch of the same day
     * and page.
     *
     * @param rows - Rows from one fetched page of Search Console results.
     */
    writePageTotals(rows: IGscPageTotalDocument[]): Promise<void>;

    /**
     * Delete the rows in a refetched window that the latest fetch did not
     * return, so a keyword Google stopped reporting for a day does not stay in
     * the history with an outdated figure.
     *
     * @param table - The table the fetch just wrote to.
     * @param start - First day of the refetched window (YYYY-MM-DD), inclusive.
     * @param end - Last day of the refetched window (YYYY-MM-DD), inclusive.
     * @param fetchedAt - The stamp the fetch wrote on every row; older rows in
     *   the window are the ones removed.
     */
    prune(table: GscArchiveTable, start: string, end: string, fetchedAt: Date): Promise<void>;

    /**
     * Report which days the archive holds. Reads use the newest day to end a
     * period window and the oldest to start an `all` window.
     *
     * @returns The archived day range and count.
     */
    getCoverage(): Promise<IGscArchiveCoverage>;

    /**
     * Sum each query over the window, ranked by `options.sort`. With a page
     * filter, each query is summed over the matching pages only.
     *
     * @param since - First day, inclusive.
     * @param end - Last day, inclusive.
     * @param options - Ranking, paging, and filters; omit for every query, most clicks first.
     * @returns The requested rows, one per query, and how many queries matched in all.
     */
    sumByKeyword(since: string, end: string, options?: IGscQueryRankedReadOptions): Promise<IGscRankedRows<IGscArchiveKeywordSums>>;

    /**
     * Sum each landing page over the window from the page totals, which
     * include clicks from anonymized queries, ranked by `options.sort`.
     *
     * @param since - First day, inclusive.
     * @param end - Last day, inclusive.
     * @param options - Ranking, paging, and filters; omit for every page, most clicks first.
     * @returns The requested rows, one per page, and how many pages matched in all.
     */
    sumByPage(since: string, end: string, options?: IGscRankedReadOptions): Promise<IGscRankedRows<IGscArchivePageSums>>;

    /**
     * Sum each query and page pair over the window, ranked by `options.sort`.
     *
     * @param since - First day, inclusive.
     * @param end - Last day, inclusive.
     * @param options - Ranking, paging, and filters; omit for every pair, most clicks first.
     * @returns The requested rows, one per pair, and how many pairs matched in all.
     */
    sumByKeywordPage(since: string, end: string, options?: IGscQueryRankedReadOptions): Promise<IGscRankedRows<IGscArchiveKeywordPageSums>>;

    /**
     * Sum the site's daily totals into time buckets. Buckets with no data
     * are absent; the caller zero-fills.
     *
     * @param since - First day, inclusive.
     * @param end - Last day, inclusive.
     * @param granularity - Bucket size.
     * @returns One row per bucket that has data, oldest first.
     */
    sumTotalsByBucket(since: string, end: string, granularity: GscGranularity): Promise<IGscArchiveBucketTotals[]>;

    /**
     * The top queries by clicks within each time bucket, ties broken by
     * impressions so a bucket of zero-click queries keeps its most-shown ones.
     *
     * @param since - First day, inclusive.
     * @param end - Last day, inclusive.
     * @param granularity - Bucket size.
     * @param topN - Most queries per bucket.
     * @returns Rows ordered by bucket, then clicks descending.
     */
    topKeywordsByBucket(since: string, end: string, granularity: GscGranularity, topN: number): Promise<IGscArchiveBucketKeywordSums[]>;

    /**
     * Sum the queries matching one keyword per time bucket and query, so the
     * caller can build both the series and the list of matched variants.
     *
     * @param keyword - The keyword, already trimmed and lower-cased.
     * @param match - `exact` for that query only, `contains` for every query
     *   holding it as literal text.
     * @param since - First day, inclusive.
     * @param end - Last day, inclusive.
     * @param granularity - Bucket size.
     * @returns One row per bucket and matching query.
     */
    keywordSumsByBucket(
        keyword: string,
        match: GscKeywordMatch,
        since: string,
        end: string,
        granularity: GscGranularity
    ): Promise<IGscArchiveBucketKeywordSums[]>;
}
