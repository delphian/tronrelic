/**
 * Google Search Console integration service.
 *
 * Fetches keyword performance data from the Google Search Console API
 * and stores it in MongoDB for enriching the analytics dashboard's
 * traffic source drill-down. Credentials are stored in the database
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
 * - **TTL-based cleanup** prevents unbounded data growth (120 days)
 * - **3-day offset** avoids incomplete recent GSC data
 */

import { google } from 'googleapis';
import type { Collection } from 'mongodb';
import type { IDatabaseService, ICacheService, ISystemLogService } from '@/types';

/**
 * Google Search Console query row stored in MongoDB.
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

/** Key-value store keys for GSC configuration. */
const KV_CREDENTIALS = 'gsc:credentials';
const KV_SITE_URL = 'gsc:siteUrl';
const KV_LAST_FETCH = 'gsc:lastFetch';

/** Collection name following module_{module-id}_{collection} convention. */
const COLLECTION_NAME = 'module_user_gsc_queries';

/** Maximum rows per GSC API request. */
const GSC_ROW_LIMIT = 5000;

/** Days to offset from today to avoid incomplete GSC data. */
const GSC_DATA_DELAY_DAYS = 3;

/** Default lookback period in days for GSC fetches. */
const GSC_DEFAULT_LOOKBACK_DAYS = 30;

/** Maximum pagination pages to prevent runaway fetches (100 × 5000 = 500k rows). */
const GSC_MAX_PAGES = 100;

/**
 * Google Search Console integration service.
 *
 * Singleton service that manages GSC credential storage, data fetching,
 * and keyword aggregation. Credentials are stored in the database _kv
 * collection, and fetched data is stored in the module_user_gsc_queries collection
 * with TTL-based auto-cleanup.
 */
export class GscService {
    private static instance: GscService;
    private readonly collection: Collection<IGscQueryDocument>;

    /**
     * Private constructor enforces singleton pattern. Use setDependencies()
     * and getInstance() for access.
     *
     * @param database - Database service for MongoDB operations
     * @param cacheService - Redis cache for data caching
     * @param logger - System log service for operations tracking
     */
    private constructor(
        private readonly database: IDatabaseService,
        private readonly cacheService: ICacheService,
        private readonly logger: ISystemLogService
    ) {
        this.collection = database.getCollection<IGscQueryDocument>(COLLECTION_NAME);
    }

    /**
     * Initialize the singleton instance with dependencies.
     *
     * Must be called before getInstance(). Typically invoked during
     * application bootstrap in the user module's init() phase.
     *
     * @param database - Database service
     * @param cacheService - Cache service
     * @param logger - System log service
     */
    public static setDependencies(
        database: IDatabaseService,
        cacheService: ICacheService,
        logger: ISystemLogService
    ): void {
        if (!GscService.instance) {
            GscService.instance = new GscService(database, cacheService, logger);
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
     * Create database indexes for the module_user_gsc_queries collection.
     *
     * Called once during module init() phase. Creates a compound unique
     * index for deduplication and a TTL index for automatic cleanup.
     */
    async createIndexes(): Promise<void> {
        await this.collection.createIndex(
            { date: 1, query: 1, page: 1, country: 1, device: 1 },
            { unique: true, name: 'gsc_dedup' }
        );
        await this.collection.createIndex(
            { query: 1, date: 1 },
            { name: 'gsc_keyword_lookup' }
        );
        await this.collection.createIndex(
            { fetchedAt: 1 },
            { expireAfterSeconds: 120 * 24 * 60 * 60, name: 'gsc_ttl' }
        );
        this.logger.info('GSC query indexes created');
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
     * credentials are configured, the site URL, and last fetch time.
     *
     * @returns Configuration status object
     */
    async getStatus(): Promise<IGscStatus> {
        const creds = await this.database.get<string>(KV_CREDENTIALS);
        const siteUrl = await this.database.get<string>(KV_SITE_URL);
        const lastFetch = await this.database.get<string>(KV_LAST_FETCH);

        return {
            configured: !!creds,
            siteUrl: siteUrl ?? undefined,
            lastFetch: lastFetch ?? undefined
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
     * Does not delete previously fetched query data — that expires
     * naturally via the TTL index.
     */
    async removeCredentials(): Promise<void> {
        await this.database.set(KV_CREDENTIALS, null);
        await this.database.set(KV_SITE_URL, null);
        await this.database.set(KV_LAST_FETCH, null);
        this.logger.info('GSC credentials removed');
    }

    /**
     * Fetch search analytics data from GSC and store in MongoDB.
     *
     * Requests data with dimensions [query, page, country, device, date]
     * for the specified date range. Defaults to fetching the last 30 days
     * (offset by 3 days to avoid incomplete data). Upserts rows using
     * the compound unique index for deduplication.
     *
     * @param startDate - ISO date string (YYYY-MM-DD), defaults to 33 days ago
     * @param endDate - ISO date string (YYYY-MM-DD), defaults to 3 days ago
     * @returns Number of rows fetched and upserted
     * @throws Error if not configured or API request fails
     */
    async fetchAndStore(startDate?: string, endDate?: string): Promise<{ rowsFetched: number }> {
        const credentialsJson = await this.database.get<string>(KV_CREDENTIALS);
        const siteUrl = await this.database.get<string>(KV_SITE_URL);

        if (!credentialsJson || !siteUrl) {
            throw new Error('GSC not configured: missing credentials or site URL');
        }

        const now = new Date();
        const defaultEnd = new Date(now);
        defaultEnd.setDate(defaultEnd.getDate() - GSC_DATA_DELAY_DAYS);
        const defaultStart = new Date(defaultEnd);
        defaultStart.setDate(defaultStart.getDate() - GSC_DEFAULT_LOOKBACK_DAYS);

        const start = startDate ?? defaultStart.toISOString().split('T')[0];
        const end = endDate ?? defaultEnd.toISOString().split('T')[0];

        const auth = new google.auth.GoogleAuth({
            credentials: JSON.parse(credentialsJson),
            scopes: ['https://www.googleapis.com/auth/webmasters.readonly']
        });

        const searchConsole = google.searchconsole({ version: 'v1', auth });

        this.logger.info({ siteUrl, start, end }, 'Fetching GSC search analytics');

        let totalRows = 0;
        let startRow = 0;
        let hasMore = true;
        let pageCount = 0;

        while (hasMore) {
            if (pageCount >= GSC_MAX_PAGES) {
                this.logger.warn({ totalRows, maxPages: GSC_MAX_PAGES }, 'GSC fetch hit pagination safety limit');
                break;
            }
            pageCount++;
            const response = await searchConsole.searchanalytics.query({
                siteUrl,
                requestBody: {
                    startDate: start,
                    endDate: end,
                    dimensions: ['query', 'page', 'country', 'device', 'date'],
                    rowLimit: GSC_ROW_LIMIT,
                    startRow
                }
            });

            const rows = response.data.rows ?? [];
            if (rows.length === 0) {
                hasMore = false;
                break;
            }

            const bulkOps = rows.reduce<Array<{ updateOne: { filter: Record<string, unknown>; update: { $set: IGscQueryDocument }; upsert: true } }>>((ops, row) => {
                const keys = row.keys ?? [];
                const [query, page, country, device, dateStr] = keys;

                // Skip rows with missing keys or unparseable dates
                if (!query || !page || !country || !device || !dateStr) {
                    return ops;
                }
                const date = new Date(dateStr);
                if (isNaN(date.getTime())) {
                    return ops;
                }

                const doc: IGscQueryDocument = {
                    query,
                    page,
                    country,
                    device,
                    date,
                    clicks: row.clicks ?? 0,
                    impressions: row.impressions ?? 0,
                    ctr: row.ctr ?? 0,
                    position: row.position ?? 0,
                    fetchedAt: now
                };

                ops.push({
                    updateOne: {
                        filter: {
                            date: doc.date,
                            query: doc.query,
                            page: doc.page,
                            country: doc.country,
                            device: doc.device
                        },
                        update: { $set: doc },
                        upsert: true
                    }
                });
                return ops;
            }, []);

            if (bulkOps.length > 0) {
                await this.collection.bulkWrite(bulkOps);
            }
            totalRows += rows.length;
            startRow += rows.length;

            if (rows.length < GSC_ROW_LIMIT) {
                hasMore = false;
            }
        }

        await this.database.set(KV_LAST_FETCH, now.toISOString());
        this.logger.info({ rowsFetched: totalRows, siteUrl }, 'GSC data fetch complete');

        return { rowsFetched: totalRows };
    }

    /**
     * Get aggregated keyword data for a given time period.
     *
     * Aggregates stored GSC query rows by keyword, summing clicks and
     * impressions, and averaging CTR and position. Results are sorted
     * by clicks descending.
     *
     * @param periodHours - Lookback period in hours
     * @param limit - Maximum keywords to return (default: 10)
     * @returns Aggregated keyword data sorted by clicks descending
     */
    /**
     * Get keyword data grouped by day for a configurable number of days.
     *
     * Aggregates stored GSC query rows into daily buckets, each containing
     * the top keywords ranked by clicks. Accounts for the 3-day GSC data
     * delay — the most recent bucket will be offset accordingly.
     *
     * @param days - Number of daily buckets to return (default: 14)
     * @param topN - Maximum keywords per bucket (default: 15)
     * @returns Daily keyword buckets ordered chronologically (oldest first)
     */
    async getKeywordsByDay(days: number = 14, topN: number = 15): Promise<{
        days: number;
        buckets: Array<{
            date: string;
            totalClicks: number;
            totalImpressions: number;
            keywords: Array<{ keyword: string; clicks: number; impressions: number; ctr: number; position: number }>;
        }>;
    }> {
        const delayMs = GSC_DATA_DELAY_DAYS * 24 * 60 * 60 * 1000;
        const end = new Date(Date.now() - delayMs);
        const since = new Date(end.getTime() - (days * 24 * 60 * 60 * 1000));

        const results = await this.collection.aggregate<{
            _id: { date: string; query: string };
            clicks: number;
            impressions: number;
            weightedPosition: number;
        }>([
            { $match: { date: { $gte: since, $lte: end } } },
            {
                $group: {
                    _id: {
                        date: { $dateToString: { format: '%Y-%m-%d', date: '$date' } },
                        query: '$query'
                    },
                    clicks: { $sum: '$clicks' },
                    impressions: { $sum: '$impressions' },
                    weightedPosition: { $sum: { $multiply: ['$position', '$impressions'] } }
                }
            },
            { $sort: { '_id.date': 1, clicks: -1 } }
        ]).toArray();

        const dayMap = new Map<string, Array<{ keyword: string; clicks: number; impressions: number; ctr: number; position: number }>>();

        for (const row of results) {
            const date = row._id.date;
            if (!dayMap.has(date)) {
                dayMap.set(date, []);
            }
            const bucket = dayMap.get(date)!;
            if (bucket.length < topN) {
                bucket.push({
                    keyword: row._id.query,
                    clicks: row.clicks,
                    impressions: row.impressions,
                    ctr: row.impressions > 0
                        ? Math.round((row.clicks / row.impressions) * 10000) / 10000
                        : 0,
                    position: row.impressions > 0
                        ? Math.round((row.weightedPosition / row.impressions) * 10) / 10
                        : 0
                });
            }
        }

        const buckets = Array.from(dayMap.entries())
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([date, keywords]) => ({
                date,
                totalClicks: keywords.reduce((sum, k) => sum + k.clicks, 0),
                totalImpressions: keywords.reduce((sum, k) => sum + k.impressions, 0),
                keywords
            }));

        return { days: buckets.length, buckets };
    }

    async getKeywordsForPeriod(periodHours: number, limit: number = 10): Promise<IGscKeyword[]> {
        // Shift window by the GSC ingestion delay so the period aligns
        // with available data (e.g. "last 7 days" queries the 7 days
        // ending at now - GSC_DATA_DELAY_DAYS, not ending at now).
        const delayMs = GSC_DATA_DELAY_DAYS * 24 * 60 * 60 * 1000;
        const end = new Date(Date.now() - delayMs);
        const since = new Date(end.getTime() - (periodHours * 60 * 60 * 1000));

        const results = await this.collection.aggregate<{
            _id: string;
            totalClicks: number;
            totalImpressions: number;
            weightedPosition: number;
        }>([
            { $match: { date: { $gte: since, $lte: end } } },
            {
                $group: {
                    _id: '$query',
                    totalClicks: { $sum: '$clicks' },
                    totalImpressions: { $sum: '$impressions' },
                    weightedPosition: { $sum: { $multiply: ['$position', '$impressions'] } }
                }
            },
            { $sort: { totalClicks: -1 } },
            { $limit: limit }
        ]).toArray();

        return results.map(r => ({
            keyword: r._id,
            clicks: r.totalClicks,
            impressions: r.totalImpressions,
            ctr: r.totalImpressions > 0
                ? Math.round((r.totalClicks / r.totalImpressions) * 10000) / 10000
                : 0,
            position: r.totalImpressions > 0
                ? Math.round((r.weightedPosition / r.totalImpressions) * 10) / 10
                : 0
        }));
    }
}
