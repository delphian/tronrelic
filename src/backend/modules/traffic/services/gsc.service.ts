/**
 * Google Search Console integration service.
 *
 * Fetches keyword performance data from the Google Search Console API,
 * stores it, and serves every Search Console read the SEO tab and the AI
 * tools make. Reads come from the permanent ClickHouse archive, so they can
 * reach every day ever fetched. Credentials are stored in the database
 * key-value store, not environment variables.
 *
 * ## Why This Service Exists
 *
 * Google strips query parameters from referrer headers, leaving the
 * analytics dashboard's "Search Keywords" section empty for Google
 * traffic. This service fills that gap by fetching actual search
 * queries, clicks, impressions, CTR, and average position from the
 * Google Search Console API.
 *
 * ## Design Decisions
 *
 * - **Singleton pattern** matching UserService for consistent DI
 * - **Database credential storage** via IDatabaseService key-value API
 * - **Service account auth** for simplicity (no OAuth2 flow)
 * - **Permanent archive** in ClickHouse (`IGscArchive`): Google keeps only
 *   16 months, so every fetched day is kept, with no TTL, and every read is
 *   served from it. Without ClickHouse there is nowhere to store a fetch
 * - **3-day offset** keeps the window on days Google has mostly collected
 * - **Fresh data requested** (`dataState: 'all'`) so a day appears as soon
 *   as Google has it, rather than only once Google marks it final
 * - **Stale rows pruned** after each refetch, because fresh numbers change
 *   until the day is final and a row can disappear between fetches
 * - **Long windows are bucketed** by week or month, so a chart or an AI tool
 *   response over a year of history stays a readable size
 */

import { google } from 'googleapis';
import type { searchconsole_v1 } from 'googleapis';
import type { IDatabaseService, ICacheService, ISystemLogService } from '@/types';
import type { GscArchiveTable, GscGranularity, GscKeywordMatch, IGscArchive, IGscArchiveCoverage, IGscArchiveSums } from './IGscArchive.js';
import type { GscWindowRequest } from './GscWindowRequest.js';
import { parseGscDay, parseGscDayRange, toGscDayKey } from './parseGscDay.js';

/**
 * One keyword-request row from Search Console, as the archive stores it.
 */
export interface IGscQueryDocument {
    /** Search query string */
    query: string;
    /** Landing page URL */
    page: string;
    /** Three-letter country code */
    country: string;
    /** Device category (DESKTOP, MOBILE, TABLET) */
    device: string;
    /** Date this row represents */
    date: Date;
    /** Number of clicks */
    clicks: number;
    /** Number of impressions */
    impressions: number;
    /** Click-through rate (0-1) */
    ctr: number;
    /** Average position in search results */
    position: number;
    /** When this data was fetched from GSC */
    fetchedAt: Date;
}

/**
 * GSC configuration status returned to the frontend.
 * Never exposes the raw service account JSON key.
 */
export interface IGscStatus {
    /** Whether GSC credentials are configured */
    configured: boolean;
    /** The GSC property URL (e.g., "https://tronrelic.com") */
    siteUrl?: string;
    /** Timestamp of last successful data fetch */
    lastFetch?: string;
    /**
     * Which days the permanent archive holds — how far back every read can
     * reach. Null when the deployment has no ClickHouse.
     */
    history: IGscArchiveCoverage | null;
}

/**
 * Aggregated keyword data from stored GSC queries.
 */
export interface IGscKeyword {
    /** Search keyword */
    keyword: string;
    /** Total clicks for this keyword */
    clicks: number;
    /** Total impressions for this keyword */
    impressions: number;
    /** Average CTR across rows (0-1) */
    ctr: number;
    /** Average position across rows */
    position: number;
}

/**
 * True per-day site totals fetched with the date-only dimension.
 *
 * The GSC API silently drops anonymized (low-volume) queries from any
 * response that includes the `query` dimension, so summing keyword rows
 * systematically undercounts clicks — on a low-traffic property most days
 * return zero keyword rows even when GSC's own dashboard shows clicks.
 * A date-only request is not subject to query anonymization and returns
 * the property's real daily totals.
 */
export interface IGscDailyTotalDocument {
    /** Calendar day this total represents (UTC midnight). */
    date: Date;
    /** Total clicks across all queries, including anonymized ones. */
    clicks: number;
    /** Total impressions across all queries, including anonymized ones. */
    impressions: number;
    /** When this total was fetched from GSC. */
    fetchedAt: Date;
}

/**
 * Aggregated keywords for a period plus the actual (delay-shifted) window
 * the aggregation covered, so the UI can show true coverage instead of a
 * misleading "last 7 days" label.
 */
export interface IGscKeywordsPeriodResult {
    /** Inclusive window start (ISO-8601 UTC). */
    windowStart: string;
    /** Inclusive window end (ISO-8601 UTC) — the end of the newest day Google has delivered. */
    windowEnd: string;
    /**
     * First day in the window (YYYY-MM-DD) that Google has not finalized, or
     * null when every day in the window is final. Figures from that day on
     * can still change.
     */
    firstIncompleteDate: string | null;
    /** Aggregated keywords sorted by clicks descending. */
    keywords: IGscKeyword[];
}

/**
 * True per-day per-page site totals fetched with the [page, date] dimensions.
 *
 * Like the date-only daily totals, a request that omits the `query` dimension
 * is not subject to GSC's query anonymization — so these rows capture the
 * clicks and impressions each landing page earned across *all* queries,
 * including the anonymized low-volume ones that never appear in a keyword row.
 * This is what lets the "top pages" panel show where clicks actually landed
 * even when no keyword can be attributed to them.
 */
export interface IGscPageTotalDocument {
    /** Landing page URL. */
    page: string;
    /** Calendar day this row represents. */
    date: Date;
    /** Clicks the page earned this day across all queries (anonymized included). */
    clicks: number;
    /** Impressions the page earned this day across all queries. */
    impressions: number;
    /** Click-through rate for the day (0-1). */
    ctr: number;
    /** Average position of the page in search results this day. */
    position: number;
    /** When this row was fetched from GSC (drives the stale-row prune). */
    fetchedAt: Date;
}

/**
 * One aggregated landing page from the page totals: how much search
 * traffic the page drew over the window, immune to query anonymization.
 */
export interface IGscPage {
    /** Landing page URL. */
    page: string;
    /** Total clicks for this page (all queries, anonymized included). */
    clicks: number;
    /** Total impressions for this page. */
    impressions: number;
    /** Average CTR across rows (0-1). */
    ctr: number;
    /** Impression-weighted average position across rows. */
    position: number;
}

/**
 * Aggregated pages for a period plus the delay-shifted window covered — the
 * page-dimension counterpart to {@link IGscKeywordsPeriodResult}.
 */
export interface IGscPagesPeriodResult {
    /** Inclusive window start (ISO-8601 UTC). */
    windowStart: string;
    /** Inclusive window end (ISO-8601 UTC) — the end of the newest day Google has delivered. */
    windowEnd: string;
    /** First non-final day in the window (YYYY-MM-DD), or null when all are final. */
    firstIncompleteDate: string | null;
    /** Aggregated pages sorted by clicks descending. */
    pages: IGscPage[];
}

/**
 * One aggregated keyword→page pair: how much a single query drove a single
 * landing page over the window.
 *
 * The "Top keywords" and "Top pages" panels each collapse one of the two
 * dimensions away, so neither can answer "which page did this keyword
 * surface?". This pairing keeps both dimensions, aggregating the keyword
 * rows (which carry `query` and `page` together) by the `{query, page}`
 * couple. Because it reads the query-dimensioned rows it inherits GSC's
 * low-volume-query anonymization — the same
 * coverage gap the keyword panel already has — so its clicks will not fully
 * reconcile with the anonymization-immune page totals.
 */
export interface IGscKeywordPage {
    /** Search query. */
    keyword: string;
    /** Landing page URL the query surfaced. */
    page: string;
    /** Total clicks for this keyword→page pair. */
    clicks: number;
    /** Total impressions for this keyword→page pair. */
    impressions: number;
    /** Average CTR across rows (0-1). */
    ctr: number;
    /** Impression-weighted average position across rows. */
    position: number;
}

/**
 * Aggregated keyword→page pairs for a period plus the delay-shifted window
 * covered — the two-dimensional counterpart to {@link IGscKeywordsPeriodResult}
 * and {@link IGscPagesPeriodResult}.
 */
export interface IGscKeywordPagesPeriodResult {
    /** Inclusive window start (ISO-8601 UTC). */
    windowStart: string;
    /** Inclusive window end (ISO-8601 UTC) — the end of the newest day Google has delivered. */
    windowEnd: string;
    /** First non-final day in the window (YYYY-MM-DD), or null when all are final. */
    firstIncompleteDate: string | null;
    /** Aggregated pairs sorted by clicks descending. */
    pairs: IGscKeywordPage[];
}

/**
 * One bucket of a single keyword's search performance. A bucket is one day,
 * week, or month, depending on the result's `granularity`.
 */
export interface IGscKeywordHistoryPoint {
    /** First day of the bucket (YYYY-MM-DD, UTC). */
    date: string;
    /** Clicks the keyword earned in the bucket. */
    clicks: number;
    /** Impressions the keyword earned in the bucket. */
    impressions: number;
    /** Click-through rate for the bucket (0-1); 0 when there were no impressions. */
    ctr: number;
    /**
     * Impression-weighted average position, or null in a bucket with no
     * impressions. Null rather than 0, because 0 would plot as a position
     * better than first place.
     */
    position: number | null;
    /** True when any day in the bucket had not been finalized by Google at the last fetch. */
    preliminary: boolean;
}

/**
 * A single keyword's search performance over a window, with window totals —
 * the series behind a per-keyword chart.
 */
export interface IGscKeywordHistoryResult {
    /** The keyword as matched (trimmed and lower-cased). */
    keyword: string;
    /** How stored queries were matched against it. */
    match: GscKeywordMatch;
    /** Inclusive window start (ISO-8601 UTC). */
    windowStart: string;
    /** Inclusive window end (ISO-8601 UTC) — the end of the window's last day. */
    windowEnd: string;
    /** Bucket size of `days`. */
    granularity: GscGranularity;
    /** First non-final day in the window (YYYY-MM-DD), or null when all are final. */
    firstIncompleteDate: string | null;
    /** Window totals across every matched query. */
    totals: { clicks: number; impressions: number; ctr: number; position: number | null };
    /**
     * The distinct stored queries that matched, most impressions first and
     * capped at {@link KEYWORD_HISTORY_MATCHED_QUERY_LIMIT}. With `exact` this
     * is the keyword itself or empty; with `contains` it shows which variants
     * were summed.
     */
    matchedQueries: string[];
    /**
     * One point per bucket in the window, oldest first, zero-filled. Named
     * `days` because callers read it by that name; a point covers a week or a
     * month when `granularity` says so.
     */
    days: IGscKeywordHistoryPoint[];
}

/**
 * The site's click and impression trend over a window, each bucket listing
 * its top keywords.
 */
export interface IGscKeywordTrendResult {
    /** Inclusive window start (ISO-8601 UTC). */
    windowStart: string;
    /** Inclusive window end (ISO-8601 UTC) — the end of the window's last day. */
    windowEnd: string;
    /** Bucket size of `buckets`. */
    granularity: GscGranularity;
    /** First non-final day in the window (YYYY-MM-DD), or null when all are final. */
    firstIncompleteDate: string | null;
    /** One entry per bucket, oldest first, zero-filled. */
    buckets: Array<{
        /** First day of the bucket (YYYY-MM-DD, UTC). */
        date: string;
        /** Site clicks in the bucket, anonymized queries included. */
        totalClicks: number;
        /** Site impressions in the bucket, anonymized queries included. */
        totalImpressions: number;
        /** True when any day in the bucket was not final at the last fetch. */
        preliminary: boolean;
        /** The bucket's top keywords by clicks. */
        keywords: IGscKeyword[];
    }>;
}

/**
 * A window request turned into concrete days, which every read needs in both
 * Date and `YYYY-MM-DD` form.
 */
interface IResolvedGscWindow {
    /** First day, midnight UTC. */
    since: Date;
    /** Last day, midnight UTC. */
    lastDay: Date;
    /** Last millisecond of the last day, reported as `windowEnd`. */
    end: Date;
    /** First day as `YYYY-MM-DD`. */
    sinceKey: string;
    /** Last day as `YYYY-MM-DD`. */
    endKey: string;
    /** Days in the window, inclusive. */
    dayCount: number;
    /** First non-final day inside the window, or null when all are final. */
    firstIncompleteDate: string | null;
}

/** Most matched-query strings {@link GscService.getKeywordHistory} returns alongside the series. */
const KEYWORD_HISTORY_MATCHED_QUERY_LIMIT = 10;

/**
 * Longest window charted one point per day. Past it, a daily series is too
 * long for a chart to read and too large for an AI tool's response.
 */
const MAX_DAILY_BUCKET_DAYS = 92;

/** Longest window charted one point per week; past it, months are used. */
const MAX_WEEKLY_BUCKET_DAYS = 730;

/**
 * Pick a bucket size that keeps a series near a hundred points or fewer:
 * days up to three months, weeks up to two years, months beyond.
 *
 * @param dayCount - Days in the window.
 * @returns The bucket size to use when the caller did not choose one.
 */
export function pickGscGranularity(dayCount: number): GscGranularity {
    let granularity: GscGranularity = 'month';
    if (dayCount <= MAX_DAILY_BUCKET_DAYS) {
        granularity = 'day';
    } else if (dayCount <= MAX_WEEKLY_BUCKET_DAYS) {
        granularity = 'week';
    }
    return granularity;
}

/**
 * The first day of the bucket holding a day, matching the archive's SQL:
 * the day itself, its Monday (ClickHouse `toMonday`), or the first of its
 * month (`toStartOfMonth`).
 */
function bucketStartOf(day: Date, granularity: GscGranularity): Date {
    let start = day;
    if (granularity === 'week') {
        start = new Date(day.getTime() - ((day.getUTCDay() + 6) % 7) * DAY_MS);
    } else if (granularity === 'month') {
        start = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), 1));
    }
    return start;
}

/** The first day of the bucket after the one starting on `start`. */
function nextBucketStart(start: Date, granularity: GscGranularity): Date {
    let next = new Date(start.getTime() + DAY_MS);
    if (granularity === 'week') {
        next = new Date(start.getTime() + 7 * DAY_MS);
    } else if (granularity === 'month') {
        next = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
    }
    return next;
}

/**
 * List every bucket a window touches, so reads can zero-fill the buckets the
 * archive returned nothing for.
 *
 * The first week or month can start before the window, and its figures then
 * cover only the window's days; it is still labelled by its own first day so
 * the labels line up with the archive's bucket keys.
 *
 * @param since - First day of the window, midnight UTC.
 * @param lastDay - Last day of the window, midnight UTC.
 * @param granularity - Bucket size.
 * @returns Each bucket's first day and the last window day it covers, both
 *   `YYYY-MM-DD`, oldest first. `lastDay` decides whether a bucket holds a
 *   day Google has not finalized.
 */
function listGscBuckets(since: Date, lastDay: Date, granularity: GscGranularity): Array<{ start: string; lastDay: string }> {
    const buckets: Array<{ start: string; lastDay: string }> = [];
    for (let start = bucketStartOf(since, granularity); start.getTime() <= lastDay.getTime(); start = nextBucketStart(start, granularity)) {
        const bucketLast = Math.min(nextBucketStart(start, granularity).getTime() - DAY_MS, lastDay.getTime());
        buckets.push({ start: toGscDayKey(start), lastDay: toGscDayKey(new Date(bucketLast)) });
    }
    return buckets;
}

/**
 * Round a click-through rate (0-1) to four decimal places, or 0 with no
 * impressions. Shared by every read so a bucket and a window report CTR
 * identically.
 */
function roundedCtr(clicks: number, impressions: number): number {
    return impressions > 0 ? Math.round((clicks / impressions) * 10000) / 10000 : 0;
}

/**
 * Turn an impression-weighted position sum into an average rounded to one
 * decimal, or null when there were no impressions to weight.
 *
 * @param weightedPosition - Sum of position × impressions over the span.
 */
function roundedPosition(weightedPosition: number, impressions: number): number | null {
    return impressions > 0 ? Math.round((weightedPosition / impressions) * 10) / 10 : null;
}

/**
 * Turn archive sums into the figures the ranked reads return. Position is 0,
 * not null, with no impressions, because those reads have always returned a
 * number there and their rows always carry impressions in practice.
 *
 * @param sums - Summed clicks, impressions, and weighted position.
 * @returns Clicks, impressions, CTR, and average position.
 */
function toRates(sums: IGscArchiveSums): { clicks: number; impressions: number; ctr: number; position: number } {
    return {
        clicks: sums.clicks,
        impressions: sums.impressions,
        ctr: roundedCtr(sums.clicks, sums.impressions),
        position: roundedPosition(sums.weightedPosition, sums.impressions) ?? 0
    };
}

/** Key-value store keys for GSC configuration. */
const KV_CREDENTIALS = 'gsc:credentials';
const KV_SITE_URL = 'gsc:siteUrl';
const KV_LAST_FETCH = 'gsc:lastFetch';

/**
 * First day (YYYY-MM-DD) Google reported as not yet final on the latest
 * fetch, or null when the fetched window was entirely final. Every read
 * uses it to mark the days whose figures can still change.
 */
const KV_FIRST_INCOMPLETE_DATE = 'gsc:firstIncompleteDate';

/** Maximum rows per GSC API request. */
const GSC_ROW_LIMIT = 5000;

/**
 * Days to offset from today to avoid incomplete GSC data. Exported so the
 * archive backfill ends its default range on the same day the daily fetch does.
 */
export const GSC_DATA_DELAY_DAYS = 3;

/**
 * Which GSC data the API returns. The API default, `final`, omits every day
 * Google has not yet marked final, and Google sometimes takes four or more
 * days to do that. A daily fetch with the default then returns the same
 * newest day run after run, and the SEO tab stays on it. `all` also returns
 * fresh (not yet final) days, which is what the Search Console website shows
 * by default. Fresh numbers can still change, so every fetch re-reads the
 * whole lookback window and prunes rows the new response no longer contains.
 */
const GSC_DATA_STATE = 'all';

/** Default lookback period in days for GSC fetches. */
const GSC_DEFAULT_LOOKBACK_DAYS = 30;

/** Maximum pagination pages to prevent runaway fetches (100 × 5000 = 500k rows). */
const GSC_MAX_PAGES = 100;

/** Milliseconds in one day, used to step period windows in whole UTC days. */
const DAY_MS = 24 * 60 * 60 * 1000;

/** The authenticated Search Console client every fetch shares. */
type SearchConsoleClient = ReturnType<typeof google.searchconsole>;

/** One result row as the Search Console API returns it. */
type GscApiRow = searchconsole_v1.Schema$ApiDataRow;

/** Dimensions of the keyword request, in the order `toQueryDocument` reads the row keys. */
const QUERY_DIMENSIONS = ['query', 'page', 'country', 'device', 'date'];

/** Dimensions of the date-only request, the one shape exempt from query anonymization. */
const DAILY_TOTAL_DIMENSIONS = ['date'];

/** Dimensions of the page request, in the order `toPageTotalDocument` reads the row keys. */
const PAGE_TOTAL_DIMENSIONS = ['page', 'date'];

/**
 * What one paginated Search Console request returned, which callers need to
 * decide whether pruning the window is safe.
 */
interface IGscFetchResult {
    /** Rows Google returned across every page; zero means prune nothing. */
    rowsReturned: number;
    /** True when pagination stopped at the safety limit, leaving rows unread. */
    truncated: boolean;
    /** Google's first non-final day for the window, from the first response. */
    firstIncompleteDate: string | null;
}

/**
 * Parse a Search Console `YYYY-MM-DD` key into a UTC-midnight Date, or null
 * when the key is missing or unparseable, so callers can skip the row.
 */
function parseDay(dateStr: string | null | undefined): Date | null {
    let date: Date | null = null;
    if (dateStr) {
        const parsed = new Date(dateStr);
        if (!isNaN(parsed.getTime())) {
            date = parsed;
        }
    }
    return date;
}

/**
 * Convert a keyword-request row into a stored document, or null when any key
 * is missing, so a malformed row is skipped rather than stored.
 *
 * @param row - A row from a request with `QUERY_DIMENSIONS`.
 * @param fetchedAt - The run's stamp, which decides which rows the prune removes.
 * @returns The document, or null for a row to skip.
 */
function toQueryDocument(row: GscApiRow, fetchedAt: Date): IGscQueryDocument | null {
    const [query, page, country, device, dateStr] = row.keys ?? [];
    const date = parseDay(dateStr);
    let doc: IGscQueryDocument | null = null;
    if (query && page && country && device && date) {
        doc = {
            query,
            page,
            country,
            device,
            date,
            clicks: row.clicks ?? 0,
            impressions: row.impressions ?? 0,
            ctr: row.ctr ?? 0,
            position: row.position ?? 0,
            fetchedAt
        };
    }
    return doc;
}

/**
 * Convert a date-only row into a daily total, or null when the date is
 * missing.
 *
 * @param row - A row from a request with `DAILY_TOTAL_DIMENSIONS`.
 * @param fetchedAt - The run's stamp, which decides which rows the prune removes.
 * @returns The document, or null for a row to skip.
 */
function toDailyTotalDocument(row: GscApiRow, fetchedAt: Date): IGscDailyTotalDocument | null {
    const date = parseDay(row.keys?.[0]);
    let doc: IGscDailyTotalDocument | null = null;
    if (date) {
        doc = { date, clicks: row.clicks ?? 0, impressions: row.impressions ?? 0, fetchedAt };
    }
    return doc;
}

/**
 * Convert a page-request row into a page total, or null when a key is
 * missing.
 *
 * @param row - A row from a request with `PAGE_TOTAL_DIMENSIONS`.
 * @param fetchedAt - The run's stamp, which decides which rows the prune removes.
 * @returns The document, or null for a row to skip.
 */
function toPageTotalDocument(row: GscApiRow, fetchedAt: Date): IGscPageTotalDocument | null {
    const [page, dateStr] = row.keys ?? [];
    const date = parseDay(dateStr);
    let doc: IGscPageTotalDocument | null = null;
    if (page && date) {
        doc = {
            page,
            date,
            clicks: row.clicks ?? 0,
            impressions: row.impressions ?? 0,
            ctr: row.ctr ?? 0,
            position: row.position ?? 0,
            fetchedAt
        };
    }
    return doc;
}

/**
 * Convert a page of API rows with one of the converters above, dropping the
 * rows it rejects.
 *
 * @param rows - One page of Search Console rows.
 * @param convert - The converter matching the request's dimensions.
 * @param fetchedAt - The run's stamp, written on every document.
 * @returns The documents to store.
 */
function toDocuments<T>(rows: GscApiRow[], convert: (row: GscApiRow, fetchedAt: Date) => T | null, fetchedAt: Date): T[] {
    return rows.reduce<T[]>((docs, row) => {
        const doc = convert(row, fetchedAt);
        if (doc) {
            docs.push(doc);
        }
        return docs;
    }, []);
}

/**
 * Google Search Console integration service.
 *
 * Singleton service that manages GSC credential storage, data fetching,
 * and keyword aggregation. Credentials and fetch markers are stored in the
 * database _kv collection, and fetched data in the permanent ClickHouse
 * archive.
 */
export class GscService {
    private static instance: GscService;

    /**
     * Private constructor enforces singleton pattern. Use setDependencies()
     * and getInstance() for access.
     *
     * @param database - Key-value store for credentials and fetch markers
     * @param cacheService - Redis cache for data caching
     * @param logger - System log service for operations tracking
     * @param archive - Permanent store every fetch writes to and every read uses
     */
    private constructor(
        private readonly database: IDatabaseService,
        private readonly cacheService: ICacheService,
        private readonly logger: ISystemLogService,
        private readonly archive: IGscArchive
    ) {}

    /**
     * Initialize the singleton instance with dependencies.
     *
     * Must be called before getInstance(). Typically invoked during
     * application bootstrap in the user module's init() phase.
     *
     * @param database - Database service
     * @param cacheService - Cache service
     * @param logger - System log service
     * @param archive - Permanent ClickHouse store for fetched rows; reports
     *   itself disabled when the deployment has no ClickHouse
     */
    public static setDependencies(
        database: IDatabaseService,
        cacheService: ICacheService,
        logger: ISystemLogService,
        archive: IGscArchive
    ): void {
        if (!GscService.instance) {
            GscService.instance = new GscService(database, cacheService, logger, archive);
        }
    }

    /**
     * Get the singleton GSC service instance.
     *
     * @throws Error if setDependencies() has not been called first
     * @returns Singleton GSC service instance
     */
    public static getInstance(): GscService {
        if (!GscService.instance) {
            throw new Error('GscService.setDependencies() must be called before getInstance()');
        }
        return GscService.instance;
    }

    /**
     * Reset singleton instance (for testing only).
     */
    public static resetInstance(): void {
        GscService.instance = undefined as unknown as GscService;
    }

    /**
     * Whether fetched data has anywhere to go. Without ClickHouse there is no
     * archive, so the daily job skips the run instead of failing it every day.
     *
     * @returns True when the archive is enabled.
     */
    canStore(): boolean {
        return this.archive.isEnabled();
    }

    /**
     * Check whether GSC credentials are configured.
     *
     * @returns True if service account credentials exist in the database
     */
    async isConfigured(): Promise<boolean> {
        const creds = await this.database.get<string>(KV_CREDENTIALS);
        return !!creds;
    }

    /**
     * Get GSC configuration status for the admin UI.
     *
     * Never returns the raw service account JSON — only whether
     * credentials are configured, the site URL, the last fetch time, and how
     * far back the archive reaches, so a reader knows which windows can hold
     * data at all.
     *
     * @returns Configuration status object
     */
    async getStatus(): Promise<IGscStatus> {
        const creds = await this.database.get<string>(KV_CREDENTIALS);
        const siteUrl = await this.database.get<string>(KV_SITE_URL);
        const lastFetch = await this.database.get<string>(KV_LAST_FETCH);
        const history = this.archive.isEnabled() ? await this.archive.getCoverage() : null;

        return {
            configured: !!creds,
            siteUrl: siteUrl ?? undefined,
            lastFetch: lastFetch ?? undefined,
            history
        };
    }

    /**
     * Validate, test, and save GSC service account credentials.
     *
     * Parses the JSON key, authenticates against the GSC API to verify
     * access, then stores the credentials in the database. Throws on
     * invalid JSON, authentication failure, or missing site access.
     *
     * @param serviceAccountJson - JSON string of Google service account key
     * @param siteUrl - GSC property URL (e.g., "https://tronrelic.com")
     * @throws Error if credentials are invalid or site is not accessible
     */
    async saveCredentials(serviceAccountJson: string, siteUrl: string): Promise<void> {
        let parsed: Record<string, unknown>;
        try {
            parsed = JSON.parse(serviceAccountJson);
        } catch {
            throw new Error('Invalid JSON: could not parse service account key');
        }

        if (!parsed.client_email || !parsed.private_key) {
            throw new Error('Invalid service account key: missing client_email or private_key');
        }

        const auth = new google.auth.GoogleAuth({
            credentials: parsed as Parameters<typeof google.auth.GoogleAuth['prototype']['fromJSON']>[0],
            scopes: ['https://www.googleapis.com/auth/webmasters.readonly']
        });

        const searchConsole = google.searchconsole({ version: 'v1', auth });

        try {
            await searchConsole.sites.get({ siteUrl });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            throw new Error(`Cannot access site "${siteUrl}" in Search Console: ${message}`);
        }

        await this.database.set(KV_CREDENTIALS, serviceAccountJson);
        await this.database.set(KV_SITE_URL, siteUrl);
        this.logger.info({ siteUrl }, 'GSC credentials saved and verified');
    }

    /**
     * Remove stored GSC credentials and site URL.
     *
     * Does not delete previously fetched query data; the archive keeps it
     * permanently.
     */
    async removeCredentials(): Promise<void> {
        await this.database.set(KV_CREDENTIALS, null);
        await this.database.set(KV_SITE_URL, null);
        await this.database.set(KV_LAST_FETCH, null);
        await this.database.set(KV_FIRST_INCOMPLETE_DATE, null);
        this.logger.info('GSC credentials removed');
    }

    /**
     * Fetch the recent window from Search Console into the archive and save
     * the fetch markers the reads depend on. This is the daily job's run.
     *
     * Defaults to the last 30 days, ending 3 days ago. Every run refetches the
     * whole window, because Google's fresh figures change until a day is
     * final, so a run also repairs any day an earlier failed run missed.
     *
     * After the window is stored it saves `gsc:lastFetch` and, when Google
     * returned days, `gsc:firstIncompleteDate` — the first day still being
     * collected, which only the date-only request reports and which every
     * read uses to mark figures that can still change. An empty response
     * leaves the saved day alone, for the same reason it skips the prune.
     *
     * @param startDate - ISO date string (YYYY-MM-DD), defaults to 33 days ago
     * @param endDate - ISO date string (YYYY-MM-DD), defaults to 3 days ago
     * @returns Rows Google returned across the keyword, daily, and page requests
     * @throws Error if ClickHouse or credentials are missing, or an API request
     *   or archive write fails
     */
    async fetchAndStore(startDate?: string, endDate?: string): Promise<{ rowsFetched: number }> {
        if (!this.archive.isEnabled()) {
            throw new Error('GSC data needs ClickHouse to be stored, and ClickHouse is not configured');
        }
        const { searchConsole, siteUrl } = await this.openSearchConsole();

        const now = new Date();
        const defaultEnd = new Date(now);
        defaultEnd.setDate(defaultEnd.getDate() - GSC_DATA_DELAY_DAYS);
        const defaultStart = new Date(defaultEnd);
        defaultStart.setDate(defaultStart.getDate() - GSC_DEFAULT_LOOKBACK_DAYS);

        const start = startDate ?? defaultStart.toISOString().split('T')[0];
        const end = endDate ?? defaultEnd.toISOString().split('T')[0];

        this.logger.info({ siteUrl, start, end }, 'Fetching GSC search analytics');
        const result = await this.archiveWindowWith(searchConsole, siteUrl, start, end);

        if (result.dailyRowsReturned > 0) {
            await this.database.set(KV_FIRST_INCOMPLETE_DATE, result.firstIncompleteDate);
        }
        await this.database.set(KV_LAST_FETCH, now.toISOString());
        this.logger.info({ rowsFetched: result.rowsFetched, firstIncompleteDate: result.firstIncompleteDate, siteUrl }, 'GSC data fetch complete');

        return { rowsFetched: result.rowsFetched };
    }

    /**
     * Fetch a window from Search Console into the archive without touching
     * the saved fetch markers. This is the backfill's entry point.
     *
     * Writing old windows through `fetchAndStore` would overwrite
     * `gsc:lastFetch` and `gsc:firstIncompleteDate` with values describing an
     * old window, and the SEO tab would mark the wrong days as not final.
     *
     * @param start - First day of the window (YYYY-MM-DD), inclusive.
     * @param end - Last day of the window (YYYY-MM-DD), inclusive.
     * @returns Rows Google returned across the keyword, daily, and page requests.
     * @throws Error when the archive is disabled, credentials are missing, or
     *   a request or write fails.
     */
    async archiveWindow(start: string, end: string): Promise<{ rowsFetched: number }> {
        if (!this.archive.isEnabled()) {
            throw new Error('GSC archive is disabled: ClickHouse is not configured');
        }
        const { searchConsole, siteUrl } = await this.openSearchConsole();
        const result = await this.archiveWindowWith(searchConsole, siteUrl, start, end);
        return { rowsFetched: result.rowsFetched };
    }

    /**
     * Run the keyword, daily, and page requests for a window and write each
     * to its archive table, then delete rows in the window the fetch did not
     * return. Fresh figures change until Google finalizes a day, and a row
     * present in an earlier fetch can be missing from a later one; without the
     * prune that old row would stay and overstate the day. The prune is
     * skipped after an empty response, so an empty answer cannot wipe a window
     * that held data, and after pagination stopped at the safety limit,
     * because the rows past the limit were not refetched.
     *
     * @param searchConsole - Authenticated Search Console client.
     * @param siteUrl - GSC property URL.
     * @param start - First day of the window (YYYY-MM-DD), inclusive.
     * @param end - Last day of the window (YYYY-MM-DD), inclusive.
     * @returns Rows Google returned across the three requests, and the
     *   date-only request's row count and first non-final day, which the
     *   daily run saves.
     */
    private async archiveWindowWith(
        searchConsole: SearchConsoleClient,
        siteUrl: string,
        start: string,
        end: string
    ): Promise<{ rowsFetched: number; dailyRowsReturned: number; firstIncompleteDate: string | null }> {
        const fetchedAt = new Date();
        const datasets: Array<{ table: GscArchiveTable; dimensions: string[]; write: (rows: GscApiRow[]) => Promise<void> }> = [
            {
                table: 'gsc_queries',
                dimensions: QUERY_DIMENSIONS,
                /** Archive one page of keyword rows under this run's stamp. */
                write: rows => this.archive.writeQueries(toDocuments(rows, toQueryDocument, fetchedAt))
            },
            {
                table: 'gsc_daily_totals',
                dimensions: DAILY_TOTAL_DIMENSIONS,
                /** Archive the window's per-day site totals under this run's stamp. */
                write: rows => this.archive.writeDailyTotals(toDocuments(rows, toDailyTotalDocument, fetchedAt))
            },
            {
                table: 'gsc_page_totals',
                dimensions: PAGE_TOTAL_DIMENSIONS,
                /** Archive one page of per-page totals under this run's stamp. */
                write: rows => this.archive.writePageTotals(toDocuments(rows, toPageTotalDocument, fetchedAt))
            }
        ];

        let rowsFetched = 0;
        let dailyRowsReturned = 0;
        let firstIncompleteDate: string | null = null;
        for (const dataset of datasets) {
            const result = await this.fetchRowPages(searchConsole, siteUrl, start, end, dataset.dimensions, dataset.write);
            if (result.rowsReturned > 0 && !result.truncated) {
                await this.archive.prune(dataset.table, start, end, fetchedAt);
            }
            if (dataset.table === 'gsc_daily_totals') {
                dailyRowsReturned = result.rowsReturned;
                firstIncompleteDate = result.firstIncompleteDate;
            }
            rowsFetched += result.rowsReturned;
        }

        this.logger.info({ rowsFetched, start, end, siteUrl }, 'GSC archive window stored');
        return { rowsFetched, dailyRowsReturned, firstIncompleteDate };
    }

    /**
     * Build an authenticated Search Console client from the stored
     * credentials.
     *
     * @returns The client and the property URL every request names.
     * @throws Error when credentials or the site URL are not configured.
     */
    private async openSearchConsole(): Promise<{ searchConsole: SearchConsoleClient; siteUrl: string }> {
        const credentialsJson = await this.database.get<string>(KV_CREDENTIALS);
        const siteUrl = await this.database.get<string>(KV_SITE_URL);

        if (!credentialsJson || !siteUrl) {
            throw new Error('GSC not configured: missing credentials or site URL');
        }

        const auth = new google.auth.GoogleAuth({
            credentials: JSON.parse(credentialsJson),
            scopes: ['https://www.googleapis.com/auth/webmasters.readonly']
        });

        return { searchConsole: google.searchconsole({ version: 'v1', auth }), siteUrl };
    }

    /**
     * Run one Search Console request across every page of results, handing
     * each page to `onPage` as it arrives so a large window is never held in
     * memory at once.
     *
     * Stops at `GSC_MAX_PAGES` and reports `truncated`, because the rows past
     * the limit were not read and a prune would then delete rows Google still
     * reports. Google sends `metadata.firstIncompleteDate` only for a request
     * grouped by date alone, so it is null for every other shape.
     *
     * @param searchConsole - Authenticated Search Console client.
     * @param siteUrl - GSC property URL.
     * @param start - First day of the window (YYYY-MM-DD), inclusive.
     * @param end - Last day of the window (YYYY-MM-DD), inclusive.
     * @param dimensions - The request's dimensions, which fix each row's key order.
     * @param onPage - Stores one non-empty page of rows.
     * @returns The row count, whether pagination was cut short, and Google's
     *   first non-final day.
     */
    private async fetchRowPages(
        searchConsole: SearchConsoleClient,
        siteUrl: string,
        start: string,
        end: string,
        dimensions: string[],
        onPage: (rows: GscApiRow[]) => Promise<void>
    ): Promise<IGscFetchResult> {
        let rowsReturned = 0;
        let startRow = 0;
        let pageCount = 0;
        let truncated = false;
        let hasMore = true;
        let firstIncompleteDate: string | null = null;

        while (hasMore) {
            if (pageCount >= GSC_MAX_PAGES) {
                this.logger.warn({ rowsReturned, dimensions, maxPages: GSC_MAX_PAGES }, 'GSC fetch hit pagination safety limit');
                truncated = true;
                hasMore = false;
            } else {
                pageCount++;
                const response = await searchConsole.searchanalytics.query({
                    siteUrl,
                    requestBody: {
                        startDate: start,
                        endDate: end,
                        dimensions,
                        dataState: GSC_DATA_STATE,
                        rowLimit: GSC_ROW_LIMIT,
                        startRow
                    }
                });
                if (pageCount === 1) {
                    firstIncompleteDate = response.data.metadata?.firstIncompleteDate ?? null;
                }
                const rows = response.data.rows ?? [];
                if (rows.length > 0) {
                    await onPage(rows);
                    rowsReturned += rows.length;
                    startRow += rows.length;
                }
                hasMore = rows.length === GSC_ROW_LIMIT;
            }
        }

        return { rowsReturned, truncated, firstIncompleteDate };
    }

    /**
     * Get the site's click and impression trend, with the top keywords of each
     * bucket, over any window the archive holds.
     *
     * Totals come from the daily totals, which escape GSC's query
     * anonymization, so a bucket's clicks match what Google's own dashboard
     * reports even when no keyword row accounts for them. Every bucket in the
     * window is emitted, with zero totals where nothing was stored, so a
     * stalled `gsc:fetch` job or a quiet stretch renders as a flat line
     * instead of a gap the chart silently skips.
     *
     * Each bucket carries `preliminary: true` when any of its days had not
     * been finalized by Google at the last fetch, so the chart can say its
     * figures may still change.
     *
     * @param window - The span to chart.
     * @param topN - Most keywords listed per bucket.
     * @param granularity - Bucket size; omitted, it is picked from the
     *   window's length by {@link pickGscGranularity}.
     * @returns Buckets oldest first, with the window and bucket size covered.
     */
    async getKeywordTrend(window: GscWindowRequest, topN: number = 15, granularity?: GscGranularity): Promise<IGscKeywordTrendResult> {
        const resolved = await this.resolveWindow(window);
        const bucketSize = granularity ?? pickGscGranularity(resolved.dayCount);

        const [totals, keywords] = await Promise.all([
            this.archive.sumTotalsByBucket(resolved.sinceKey, resolved.endKey, bucketSize),
            this.archive.topKeywordsByBucket(resolved.sinceKey, resolved.endKey, bucketSize, topN)
        ]);

        const totalsByBucket = new Map(totals.map(row => [row.bucket, row]));
        const keywordsByBucket = new Map<string, IGscKeyword[]>();
        for (const row of keywords) {
            const list = keywordsByBucket.get(row.bucket) ?? [];
            list.push({
                keyword: row.keyword,
                clicks: row.clicks,
                impressions: row.impressions,
                ctr: roundedCtr(row.clicks, row.impressions),
                position: roundedPosition(row.weightedPosition, row.impressions) ?? 0
            });
            keywordsByBucket.set(row.bucket, list);
        }

        const buckets = listGscBuckets(resolved.since, resolved.lastDay, bucketSize).map(bucket => ({
            date: bucket.start,
            totalClicks: totalsByBucket.get(bucket.start)?.clicks ?? 0,
            totalImpressions: totalsByBucket.get(bucket.start)?.impressions ?? 0,
            preliminary: resolved.firstIncompleteDate !== null && bucket.lastDay >= resolved.firstIncompleteDate,
            keywords: keywordsByBucket.get(bucket.start) ?? []
        }));

        return {
            windowStart: resolved.since.toISOString(),
            windowEnd: resolved.end.toISOString(),
            granularity: bucketSize,
            firstIncompleteDate: resolved.firstIncompleteDate,
            buckets
        };
    }

    /**
     * Read the first non-final day from the latest fetch, clamped to a window.
     *
     * Every read needs to tell the caller which of its days may still change,
     * and each read promises a day inside its own window. Google often leaves
     * several recent days non-final while still delivering them, so the saved
     * day can fall before a short window's first day, as in a 24-hour view of
     * the newest delivered day. In that case every day in the window can still
     * change, so the window's first day is returned instead of a date outside
     * it. A saved day after the window's last day means every day in the
     * window is final. The saved value is a `YYYY-MM-DD` string, and stored
     * days use the same calendar date at midnight UTC, so plain string
     * comparison decides both bounds.
     *
     * @param windowStart - Any instant on the window's first day; only its UTC
     *   calendar date is used, as the earliest day the answer may name.
     * @param windowEnd - Any instant on the window's last day; only its UTC
     *   calendar date is used, to decide whether the window reaches the
     *   saved day at all.
     * @returns The first non-final day inside the window, or null when every
     *   day in the window is final.
     */
    private async readFirstIncompleteDate(windowStart: Date, windowEnd: Date): Promise<string | null> {
        const stored = await this.database.get<string>(KV_FIRST_INCOMPLETE_DATE);
        const firstDayKey = windowStart.toISOString().split('T')[0];
        const lastDayKey = windowEnd.toISOString().split('T')[0];
        let firstIncompleteDate: string | null = null;
        if (stored && stored <= lastDayKey) {
            firstIncompleteDate = stored < firstDayKey ? firstDayKey : stored;
        }
        return firstIncompleteDate;
    }

    /**
     * Turn a window request into the whole UTC days a read covers.
     *
     * A `period` ends on the newest day Google has actually delivered, not on
     * a fixed "now minus 3 days". Google finalizes a day on its own schedule,
     * often later than GSC_DATA_DELAY_DAYS, so a fixed offset often lands on
     * days Google has not returned yet and the "24h" view shows nothing even
     * though data exists one day earlier. The newest archived daily total is
     * the anchor, because every fetch writes one per delivered day. An `all`
     * window starts on the oldest archived day. With nothing archived, both
     * fall back to the fixed delay so callers still get sensible bounds.
     *
     * @param window - What the caller asked for.
     * @returns The first and last day at midnight UTC, the last millisecond
     *   of the last day, both days as `YYYY-MM-DD`, the day count, and the
     *   first non-final day inside the window (null when all are final).
     * @throws Error when a `range` is malformed or reversed.
     */
    private async resolveWindow(window: GscWindowRequest): Promise<IResolvedGscWindow> {
        let since: Date;
        let lastDay: Date;
        if (window.kind === 'range') {
            const range = parseGscDayRange(window.startDate, window.endDate);
            since = parseGscDay(range.startDate) as Date;
            lastDay = parseGscDay(range.endDate) as Date;
        } else {
            const coverage = await this.archive.getCoverage();
            const now = new Date();
            const fallbackDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - GSC_DATA_DELAY_DAYS));
            lastDay = coverage.lastDate ? parseGscDay(coverage.lastDate) ?? fallbackDay : fallbackDay;
            if (window.kind === 'all') {
                since = coverage.firstDate ? parseGscDay(coverage.firstDate) ?? lastDay : lastDay;
            } else {
                const days = Math.max(1, Math.ceil(window.hours / 24));
                since = new Date(lastDay.getTime() - (days - 1) * DAY_MS);
            }
        }
        const end = new Date(lastDay.getTime() + DAY_MS - 1);
        const firstIncompleteDate = await this.readFirstIncompleteDate(since, end);
        return {
            since,
            lastDay,
            end,
            sinceKey: toGscDayKey(since),
            endKey: toGscDayKey(lastDay),
            dayCount: Math.round((lastDay.getTime() - since.getTime()) / DAY_MS) + 1,
            firstIncompleteDate
        };
    }

    /**
     * Get the top search queries over a window, with clicks, impressions,
     * click-through rate, and impression-weighted position, most clicks first.
     *
     * The returned `windowStart`/`windowEnd` carry the days actually covered
     * (see {@link resolveWindow}), so the UI can show true coverage.
     *
     * @param window - The span to aggregate.
     * @param limit - Most keywords to return (default: 10).
     * @returns The covered window and its aggregated keywords.
     */
    async getKeywords(window: GscWindowRequest, limit: number = 10): Promise<IGscKeywordsPeriodResult> {
        const resolved = await this.resolveWindow(window);
        const rows = await this.archive.sumByKeyword(resolved.sinceKey, resolved.endKey, limit);
        return {
            windowStart: resolved.since.toISOString(),
            windowEnd: resolved.end.toISOString(),
            firstIncompleteDate: resolved.firstIncompleteDate,
            keywords: rows.map(row => ({ keyword: row.keyword, ...toRates(row) }))
        };
    }

    /**
     * Get the landing pages search surfaced over a window, most clicks then
     * impressions first.
     *
     * The page-dimension counterpart to {@link getKeywords}, read from the
     * page totals, which escape query anonymization. Because impressions are
     * included, pages Google surfaced that drew no click still appear with
     * zero clicks.
     *
     * @param window - The span to aggregate.
     * @param limit - Most pages to return (default: 10).
     * @returns The covered window and its aggregated pages.
     */
    async getPages(window: GscWindowRequest, limit: number = 10): Promise<IGscPagesPeriodResult> {
        const resolved = await this.resolveWindow(window);
        const rows = await this.archive.sumByPage(resolved.sinceKey, resolved.endKey, limit);
        return {
            windowStart: resolved.since.toISOString(),
            windowEnd: resolved.end.toISOString(),
            firstIncompleteDate: resolved.firstIncompleteDate,
            pages: rows.map(row => ({ page: row.page, ...toRates(row) }))
        };
    }

    /**
     * Get which pages each keyword surfaced over a window, most clicks then
     * impressions first, so impression-only pairs still appear.
     *
     * Answers "which pages did each keyword surface?", the join the separate
     * keyword and page panels cannot express because each drops one dimension.
     * Read from the keyword rows, so it inherits GSC's low-volume query
     * anonymization exactly as the keyword panel does: anonymized queries
     * never produced a row, so their clicks are absent and will not reconcile
     * with the anonymization-immune page totals.
     *
     * @param window - The span to aggregate.
     * @param limit - Most pairs to return; omit (or pass 0) for all pairs.
     *   The admin view is meant to be exhaustive, so it passes none.
     * @returns The covered window and its aggregated keyword→page pairs.
     */
    async getKeywordPagePairs(window: GscWindowRequest, limit?: number): Promise<IGscKeywordPagesPeriodResult> {
        const resolved = await this.resolveWindow(window);
        const rows = await this.archive.sumByKeywordPage(resolved.sinceKey, resolved.endKey, limit);
        return {
            windowStart: resolved.since.toISOString(),
            windowEnd: resolved.end.toISOString(),
            firstIncompleteDate: resolved.firstIncompleteDate,
            pairs: rows.map(row => ({ keyword: row.keyword, page: row.page, ...toRates(row) }))
        };
    }

    /**
     * Get one keyword's search performance over a window, one point per bucket.
     *
     * The other reads rank many keywords, so none of them can chart a single
     * keyword over time: the trend keeps only each bucket's top rows, and a
     * keyword missing from those rows is indistinguishable from a keyword with
     * no impressions. This read filters to the requested keyword first and
     * then groups by bucket, so every bucket reports that keyword's own
     * figures, and buckets with nothing read as zero.
     *
     * Google stores queries in lower case, so the keyword is lower-cased to
     * match. `contains` sums every query holding the keyword as literal text,
     * which suits a low-volume site where any one phrasing earns an impression
     * or two.
     *
     * Read from the keyword rows, so it inherits GSC's low-volume query
     * anonymization: a keyword too rare for Google to report never appears
     * here even in buckets it was searched.
     *
     * @param keyword - The search query to chart. Trimmed and lower-cased
     *   before matching; the caller validates it is non-empty.
     * @param window - The span to chart.
     * @param match - `exact` for one query, `contains` for every query holding
     *   the keyword.
     * @param granularity - Bucket size; omitted, it is picked from the
     *   window's length by {@link pickGscGranularity}.
     * @returns The keyword's zero-filled series, window totals, and the
     *   stored queries that matched.
     */
    async getKeywordHistory(
        keyword: string,
        window: GscWindowRequest,
        match: GscKeywordMatch = 'exact',
        granularity?: GscGranularity
    ): Promise<IGscKeywordHistoryResult> {
        const normalized = keyword.trim().toLowerCase();
        const resolved = await this.resolveWindow(window);
        const bucketSize = granularity ?? pickGscGranularity(resolved.dayCount);

        // Grouped by bucket and query together, so one read yields both the
        // series and the per-query totals that rank `matchedQueries`.
        const rows = await this.archive.keywordSumsByBucket(normalized, match, resolved.sinceKey, resolved.endKey, bucketSize);

        const bucketSums = new Map<string, { clicks: number; impressions: number; weightedPosition: number }>();
        const queryImpressions = new Map<string, number>();
        const totals = { clicks: 0, impressions: 0, weightedPosition: 0 };
        for (const row of rows) {
            const sums = bucketSums.get(row.bucket) ?? { clicks: 0, impressions: 0, weightedPosition: 0 };
            sums.clicks += row.clicks;
            sums.impressions += row.impressions;
            sums.weightedPosition += row.weightedPosition;
            bucketSums.set(row.bucket, sums);
            totals.clicks += row.clicks;
            totals.impressions += row.impressions;
            totals.weightedPosition += row.weightedPosition;
            queryImpressions.set(row.keyword, (queryImpressions.get(row.keyword) ?? 0) + row.impressions);
        }

        const days = listGscBuckets(resolved.since, resolved.lastDay, bucketSize).map(bucket => {
            const sums = bucketSums.get(bucket.start) ?? { clicks: 0, impressions: 0, weightedPosition: 0 };
            return {
                date: bucket.start,
                clicks: sums.clicks,
                impressions: sums.impressions,
                ctr: roundedCtr(sums.clicks, sums.impressions),
                position: roundedPosition(sums.weightedPosition, sums.impressions),
                preliminary: resolved.firstIncompleteDate !== null && bucket.lastDay >= resolved.firstIncompleteDate
            };
        });

        const matchedQueries = Array.from(queryImpressions.entries())
            .sort(([qa, a], [qb, b]) => b - a || qa.localeCompare(qb))
            .slice(0, KEYWORD_HISTORY_MATCHED_QUERY_LIMIT)
            .map(([query]) => query);

        return {
            keyword: normalized,
            match,
            windowStart: resolved.since.toISOString(),
            windowEnd: resolved.end.toISOString(),
            granularity: bucketSize,
            firstIncompleteDate: resolved.firstIncompleteDate,
            totals: {
                clicks: totals.clicks,
                impressions: totals.impressions,
                ctr: roundedCtr(totals.clicks, totals.impressions),
                position: roundedPosition(totals.weightedPosition, totals.impressions)
            },
            matchedQueries,
            days
        };
    }
}
