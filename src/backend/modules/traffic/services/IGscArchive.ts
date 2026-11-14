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
     * Sum each query over the window, most clicks first.
     *
     * @param since - First day, inclusive.
     * @param end - Last day, inclusive.
     * @param limit - Most rows to return; omit for every query.
     * @returns One row per query.
     */
    sumByKeyword(since: string, end: string, limit?: number): Promise<IGscArchiveKeywordSums[]>;

    /**
     * Sum each landing page over the window from the page totals, which
     * include clicks from anonymized queries, most clicks then impressions first.
     *
     * @param since - First day, inclusive.
     * @param end - Last day, inclusive.
     * @param limit - Most rows to return.
     * @returns One row per page.
     */
    sumByPage(since: string, end: string, limit: number): Promise<IGscArchivePageSums[]>;

    /**
     * Sum each query and page pair over the window, most clicks then
     * impressions first.
     *
     * @param since - First day, inclusive.
     * @param end - Last day, inclusive.
     * @param limit - Most rows to return; omit for every pair.
     * @returns One row per pair.
     */
    sumByKeywordPage(since: string, end: string, limit?: number): Promise<IGscArchiveKeywordPageSums[]>;

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
     * The top queries by clicks within each time bucket.
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
