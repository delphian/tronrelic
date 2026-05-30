/**
 * Traffic events service — sibling of UserService.
 *
 * Captures cookieless and pre-session HTTP traffic in ClickHouse so it does
 * not pollute the Mongo `users` collection. Backs the traffic-events split
 * tracked in `PLAN-traffic-events.md`. Phase 0 lands the skeleton; later
 * phases add the callers.
 *
 * ## Why This Service Exists
 *
 * The 2026-04-27 identity-cookie change moved bootstrap from a JS-runtime
 * mutation into a Next.js middleware → backend path. That removed the
 * implicit "client must run JavaScript" filter that previously kept bot
 * traffic out of `users`. Every cookieless GET now writes an empty row.
 * We keep wanting to *track* that traffic — just not in the identity
 * collection. ClickHouse is the right tool for high-volume append-only
 * event data with rich dimensions.
 *
 * ## Design Decisions
 *
 * - **Singleton** matching `UserService` and `GscService` for consistent DI.
 *   `TrafficService` has no public `IXxxService` interface today; it is a
 *   user-module internal collaborator. If a plugin ever needs it, expose
 *   `ITrafficService` via the service registry as the user module already
 *   does for `UserService`.
 * - **Optional ClickHouse.** The `ClickHouseModule` skips initialization
 *   when `CLICKHOUSE_HOST` is unset. `TrafficService` mirrors that posture:
 *   when ClickHouse is unavailable every public method silently no-ops
 *   (writes drop, reads return `[]`). The orphan-row fix in later phases
 *   stays correct because Mongo writes are gated independently — losing
 *   the analytics is the only consequence of a missing CH host, not data
 *   corruption.
 * - **Async insert friendly.** `ClickHouseService` is configured with
 *   `wait_for_async_insert: 0`, so `recordEvent` returns once the row is
 *   buffered server-side. Errors surface via the async-insert error
 *   poller in `ClickHouseService` rather than the awaited promise. That
 *   matches what we want from a request-path call: never block the
 *   response on analytics persistence.
 */

import type { Request } from 'express';
import type { IClickHouseService, ISystemLogService } from '@/types';
import { getClientIP, getCountryFromIP, getDeviceCategory } from './geo.service.js';
import { classifyUserAgent, type BotClass } from './bot-classifier.js';

/**
 * Categorical event types written to `traffic_events.event_type`.
 *
 * Kept as a string union (not an enum) so the wire format is the bare
 * string and matches the ClickHouse `LowCardinality(String)` column. New
 * event types can be added without changing the migration; the column
 * stays variable-cardinality.
 */
export type TrafficEventType = 'bootstrap' | 'session_start' | 'session_end' | 'page';

/**
 * Single row written to `traffic_events`.
 *
 * Field names match column names exactly so the service can pass the
 * object straight to `ClickHouseService.insert()` without a remap. Every
 * non-required field is `null`-able to keep the contract honest about
 * what middleware will and will not forward in Phase 1.
 */
export interface ITrafficEvent {
    /** `'bootstrap'` (cookie minted) or `'session_start'` (cookie-validated). */
    event_type: TrafficEventType;
    /** Server-side wall clock at write time. */
    timestamp: Date;
    /**
     * Analytics visitor key — the `tronrelic_tid` UUID, decoupled from
     * identity. A UUID v4 stored in the `candidate_uid` column; the field
     * name stays `candidate_uid` to avoid retyping a sort-key column.
     */
    candidate_uid: string;
    /**
     * Better Auth user id when the event was recorded for a logged-in
     * visitor, else `null`. Additive Phase-5 column (migration 012) that
     * attributes traffic to an account without re-keying `candidate_uid`.
     */
    user_id: string | null;
    /**
     * Referral code captured first-touch from an inbound `?ref=` (the
     * `tronrelic_ref` cookie), else `null`. Additive Phase-5 column.
     */
    referral_code: string | null;

    /**
     * Session duration in milliseconds. Populated only for `session_end`
     * events; `null` for every other event type. Drives the engagement
     * panel's average-duration metric. Additive column (migration 013).
     */
    duration_ms: number | null;

    /** Request URL or middleware-supplied `landingPath`. */
    path: string;
    /** HTTP `Referer` header, when present. */
    referer: string | null;
    /** `document.referrer` reported by the client (Phase 1 JSON body). */
    original_referrer: string | null;

    user_agent: string | null;
    accept_language: string | null;

    /** ISO-3166-1 alpha-2 derived from request IP at write time. */
    country: string | null;
    /** `'desktop' | 'mobile' | 'tablet' | 'bot' | 'unknown'`. */
    device: string;
    /**
     * Closed enum produced by `classifyUserAgent` at write time. `null`
     * is reserved for legacy rows written before the classifier landed
     * (Phases 0-4 of the traffic-events split) and for ClickHouse reads
     * that materialize those rows back through `getEventsForUser`.
     */
    bot_class: BotClass | null;

    utm_source: string | null;
    utm_medium: string | null;
    utm_campaign: string | null;
    utm_term: string | null;
    utm_content: string | null;

    sec_ch_ua: string | null;
    /** `0` or `1`. ClickHouse stores as `Nullable(UInt8)`. */
    sec_ch_ua_mobile: number | null;
    sec_ch_ua_platform: string | null;
    sec_fetch_dest: string | null;
    sec_fetch_mode: string | null;
    sec_fetch_site: string | null;
}

/**
 * Options for `getEventsForUser`.
 */
export interface IGetEventsForUserOptions {
    /** Maximum rows to return. Default: 50 — Phase 3 only needs the earliest few. */
    limit?: number;
    /** Earliest event types to include. Default: all. */
    eventTypes?: TrafficEventType[];
}

/**
 * One bucket of an aggregate read. The `key` is the dimension value
 * (bot_class, country, path, user_agent), `count` is the row count.
 *
 * `key` is `string | null` because ClickHouse `Nullable(...)` columns
 * legitimately carry `null` for "not classified yet" / "not derivable
 * from request" — the dashboard distinguishes those from low-cardinality
 * known values, so the wire shape preserves the difference rather than
 * coercing to an empty string.
 */
export interface ITrafficAggregateBucket {
    key: string | null;
    count: number;
}

/**
 * Common params shared by every aggregate read. `sinceHours` defaults to
 * 24 because the Phase 5 admin dashboard tracks "what happened today" by
 * default; longer windows are explicitly chosen by the operator.
 */
export interface ITrafficAggregateOptions {
    /** Lookback window in hours. Clamped to `[1, 720]` (30 days) by the controller. */
    sinceHours?: number;
    /** Max rows for top-N reads. Clamped to `[1, 200]` by the controller. */
    limit?: number;
}

/**
 * Inclusive date window for the dashboard analytics reads.
 *
 * Defined locally (rather than imported from the user module) so the traffic
 * module owns its analytics surface and does not couple to the soon-to-be-
 * removed `UserService`. Structurally identical to the legacy `IDateRange`.
 */
export interface IAnalyticsDateRange {
    /** Start of the window (inclusive). */
    since: Date;
    /** End of the window (inclusive). Defaults to "now" when omitted. */
    until?: Date;
}

/** One day's distinct-visitor count. */
export interface IDailyVisitorPoint {
    day: string;
    visitors: number;
}

/** First-touch attribution for one analytics visitor (tid). */
export interface ITrafficVisitorOrigin {
    candidateUid: string;
    firstSeen: string;
    path: string;
    referer: string | null;
    utmSource: string | null;
    utmMedium: string | null;
    utmCampaign: string | null;
}

/** Referrer-domain (or `'direct'`) row count. */
export interface ITrafficSourceBucket {
    source: string;
    count: number;
}

/** Landing-path row count. */
export interface ILandingPageBucket {
    path: string;
    count: number;
}

/** Country (ISO-3166 alpha-2) row count. `null` excluded by the query. */
export interface IGeoBucket {
    country: string | null;
    count: number;
}

/** Device-category row count. */
export interface IDeviceBucket {
    device: string;
    count: number;
}

/** New-vs-returning split for one day, keyed off each tid's global first-seen. */
export interface IRetentionPoint {
    day: string;
    newVisitors: number;
    returningVisitors: number;
}

/**
 * Binary conversion funnel: distinct visitors (tids) vs. tids that ever carried
 * a non-null `user_id` (i.e. were logged in for at least one event).
 */
export interface IBinaryConversionFunnel {
    distinctVisitors: number;
    converted: number;
    conversionRate: number;
}

/** UTM-campaign aggregate joined to the binary conversion. */
export interface ICampaignPerformanceBucket {
    campaign: string;
    source: string;
    medium: string;
    visitors: number;
    conversions: number;
    conversionRate: number;
}

/**
 * Engagement metrics computed from `session_end` and `page` events. Reads near
 * zero until Phase D wires the session-event emission surface.
 */
export interface IEngagementMetrics {
    sessions: number;
    avgDurationMs: number;
    pagesPerSession: number;
    bounceRate: number;
}

/**
 * One row of the analytics new-arrivals table: a tid whose global first-seen
 * (across the full table) falls inside the window, with its first-touch
 * attribution and lifetime activity counts. Shaped to the frontend
 * `IVisitorOrigin` the `/system/users` panel renders directly. `searchKeyword`
 * is always null — `traffic_events` carries no keyword column.
 */
export interface INewVisitorOrigin {
    userId: string;
    firstSeen: string;
    lastSeen: string;
    country: string | null;
    referrerDomain: string | null;
    landingPage: string | null;
    device: string;
    utm: { source: string | null; medium: string | null; campaign: string | null; term: string | null; content: string | null } | null;
    searchKeyword: string | null;
    sessionsCount: number;
    pageViews: number;
}

/** A page of {@link INewVisitorOrigin} rows plus the unpaginated total. */
export interface INewVisitorsPage {
    visitors: INewVisitorOrigin[];
    total: number;
}

/**
 * Drill-down breakdown for a single referrer source. Shaped to the frontend
 * `ITrafficSourceDetails`. Percentages are each dimension's share of the
 * source's total pageviews. `searchKeywords` is always empty (no keyword
 * column) and `walletsConnected` / `walletsVerified` are always zero
 * (`traffic_events` has no wallet column — conversion is the binary
 * "ever logged in" proxy via `user_id`).
 */
export interface ITrafficSourceDetailsResult {
    source: string;
    visitors: number;
    landingPages: Array<{ path: string; count: number; percentage: number }>;
    countries: Array<{ country: string; count: number; percentage: number }>;
    devices: Array<{ device: string; count: number; percentage: number }>;
    utmCampaigns: Array<{ source: string; medium: string; campaign: string; count: number }>;
    searchKeywords: Array<{ keyword: string; count: number }>;
    engagement: { avgSessions: number; avgPageViews: number; avgDuration: number };
    conversion: { walletsConnected: number; walletsVerified: number; conversionRate: number };
}

/**
 * ClickHouse table backing every traffic event the user module records.
 *
 * Exported so module-internal collaborators (notably migration 011's
 * Phase 6 backfill) target the same table name without re-declaring the
 * literal — keeps the table name a single chokepoint rather than a
 * string scattered across files.
 */
export const TRAFFIC_EVENTS_TABLE_NAME = 'traffic_events';
const TABLE_NAME = TRAFFIC_EVENTS_TABLE_NAME;
const DEFAULT_AGGREGATE_HOURS = 24;
const DEFAULT_AGGREGATE_LIMIT = 20;

/**
 * ClickHouse-backed traffic events store.
 *
 * Acquire via `TrafficService.setDependencies(...)` once during
 * `TrafficModule.init()`, then `TrafficService.getInstance()` in callers.
 */
export class TrafficService {
    private static instance: TrafficService | null = null;

    private constructor(
        private readonly clickhouse: IClickHouseService | undefined,
        private readonly logger: ISystemLogService
    ) {}

    /**
     * Initialize the singleton with dependencies.
     *
     * `clickhouse` is `undefined` when the deployment did not configure
     * `CLICKHOUSE_HOST`. The service stays usable in that mode — every
     * write is dropped, every read returns `[]`. Operators see the
     * single info-level log on init and choose whether the missing
     * analytics matters for their environment.
     */
    public static setDependencies(
        clickhouse: IClickHouseService | undefined,
        logger: ISystemLogService
    ): void {
        if (!TrafficService.instance) {
            TrafficService.instance = new TrafficService(clickhouse, logger);
            if (!clickhouse) {
                logger.info(
                    'TrafficService initialized without ClickHouse — traffic events will not be recorded'
                );
            }
        }
    }

    /**
     * @throws Error if `setDependencies()` has not been called first.
     */
    public static getInstance(): TrafficService {
        if (!TrafficService.instance) {
            throw new Error('TrafficService.setDependencies() must be called before getInstance()');
        }
        return TrafficService.instance;
    }

    /**
     * Reset singleton instance. Tests only.
     */
    public static resetInstance(): void {
        TrafficService.instance = null;
    }

    /**
     * True when ClickHouse is available and writes will succeed.
     */
    public isEnabled(): boolean {
        return this.clickhouse !== undefined;
    }

    /**
     * Record one traffic event. Fire-and-forget: returns synchronously
     * once the insert is dispatched, never blocks the request handler.
     * Errors are logged via the attached `.catch()` and additionally
     * surface via the async-insert error poller in `ClickHouseService`.
     */
    recordEvent(event: ITrafficEvent): void {
        if (!this.clickhouse) {
            return;
        }

        this.clickhouse.insert(TABLE_NAME, [serializeEvent(event)]).catch((error) => {
            this.logger.warn({ error, eventType: event.event_type }, 'Failed to record traffic event');
        });
    }

    /**
     * Return the earliest events recorded for a candidate UUID, oldest
     * first. Used by Phase 3's first-touch backfill on `startSession`:
     * pull the cookieless rows that landed before the user's JS started
     * the session, prefer those values over the post-hydration payload.
     *
     * Returns `[]` when ClickHouse is unavailable so callers can simply
     * fall back to whatever data they were going to use anyway.
     */
    async getEventsForUser(
        candidateUid: string,
        options: IGetEventsForUserOptions = {}
    ): Promise<ITrafficEvent[]> {
        if (!this.clickhouse) {
            return [];
        }

        const { limit = 50, eventTypes } = options;

        const eventFilter = eventTypes && eventTypes.length > 0
            ? 'AND event_type IN ({eventTypes:Array(String)})'
            : '';

        // Explicit column list (rather than SELECT *) so a future schema
        // addition we don't intend to read won't auto-bleed into our type.
        const sql = `
            SELECT
                event_type,
                timestamp,
                candidate_uid,
                user_id,
                referral_code,
                duration_ms,
                path,
                referer,
                original_referrer,
                user_agent,
                accept_language,
                country,
                device,
                bot_class,
                utm_source,
                utm_medium,
                utm_campaign,
                utm_term,
                utm_content,
                sec_ch_ua,
                sec_ch_ua_mobile,
                sec_ch_ua_platform,
                sec_fetch_dest,
                sec_fetch_mode,
                sec_fetch_site
            FROM ${TABLE_NAME}
            WHERE candidate_uid = {candidateUid:UUID}
            ${eventFilter}
            ORDER BY timestamp ASC
            LIMIT {limit:UInt32}
        `;

        const params: Record<string, unknown> = { candidateUid, limit };
        if (eventTypes && eventTypes.length > 0) {
            params.eventTypes = eventTypes;
        }

        try {
            const rows = await this.clickhouse.query<TrafficEventRow>(sql, params);
            return rows.map(deserializeEvent);
        } catch (error) {
            this.logger.warn({ error, candidateUid }, 'Failed to read traffic events');
            return [];
        }
    }

    /**
     * Count rows grouped by `bot_class` over the lookback window. Powers
     * the headline panel of the Phase 5 admin dashboard. NULL counts are
     * preserved as a distinct bucket so operators can see classifier
     * coverage erode as pre-classifier rows roll off the window.
     *
     * Returns `[]` when ClickHouse is unavailable.
     */
    async getBotClassBreakdown(options: ITrafficAggregateOptions = {}): Promise<ITrafficAggregateBucket[]> {
        return this.aggregateByDimension('bot_class', options);
    }

    /**
     * Count rows grouped by `country` (ISO-3166 alpha-2) over the lookback
     * window. Drives the geo-distribution panel.
     */
    async getTopCountries(options: ITrafficAggregateOptions = {}): Promise<ITrafficAggregateBucket[]> {
        return this.aggregateByDimension('country', options, true);
    }

    /**
     * Count rows grouped by `path` (landing path) over the lookback
     * window. Drives the top-landing-paths panel.
     */
    async getTopPaths(options: ITrafficAggregateOptions = {}): Promise<ITrafficAggregateBucket[]> {
        return this.aggregateByDimension('path', options, true);
    }

    /**
     * Count rows grouped by `user_agent` for `bot_class = 'bot_other'`
     * only. Powers the classifier-gap panel — when a UA cluster appears
     * here, it's a candidate for an explicit rule in `bot-classifier.ts`.
     *
     * `bot_other` is the catch-all bucket where `isbot()` returned true
     * but no explicit fragment matched. Surfacing the raw UAs is the
     * operator's only feedback loop on classifier coverage.
     */
    async getBotOtherUserAgents(options: ITrafficAggregateOptions = {}): Promise<ITrafficAggregateBucket[]> {
        if (!this.clickhouse) {
            return [];
        }

        const sinceHours = options.sinceHours ?? DEFAULT_AGGREGATE_HOURS;
        const limit = options.limit ?? DEFAULT_AGGREGATE_LIMIT;

        // Clamp the user_agent column to a sane display width here rather
        // than at the controller — the dashboard never needs the full
        // 500-char raw value, and trimming saves wire bandwidth.
        const sql = `
            SELECT
                substring(user_agent, 1, 240) AS key,
                count() AS count
            FROM ${TABLE_NAME}
            WHERE timestamp > now() - INTERVAL {sinceHours:UInt32} HOUR
              AND bot_class = 'bot_other'
              AND user_agent IS NOT NULL
            GROUP BY key
            ORDER BY count DESC
            LIMIT {limit:UInt32}
        `;

        try {
            const rows = await this.clickhouse.query<{ key: string | null; count: string | number }>(
                sql,
                { sinceHours, limit }
            );
            return rows.map(r => ({ key: r.key, count: Number(r.count) }));
        } catch (error) {
            this.logger.warn({ error, sinceHours, limit }, 'Failed to read bot_other UA aggregate');
            return [];
        }
    }

    /**
     * Generic GROUP BY count for low-cardinality dimensions. `dimension`
     * is interpolated directly into the SQL because the column name
     * cannot be a parameter; callers MUST pass a hardcoded literal.
     * `excludeNull` is on for top-N reads where a `null` row would
     * dominate the chart with little analytic value (path/country are
     * mostly populated; bot_class is interesting precisely because of
     * its NULL bucket).
     */
    private async aggregateByDimension(
        dimension: 'bot_class' | 'country' | 'path',
        options: ITrafficAggregateOptions,
        excludeNull = false
    ): Promise<ITrafficAggregateBucket[]> {
        if (!this.clickhouse) {
            return [];
        }

        const sinceHours = options.sinceHours ?? DEFAULT_AGGREGATE_HOURS;
        const limit = options.limit ?? DEFAULT_AGGREGATE_LIMIT;
        const nullFilter = excludeNull ? `AND ${dimension} IS NOT NULL` : '';

        const sql = `
            SELECT
                ${dimension} AS key,
                count() AS count
            FROM ${TABLE_NAME}
            WHERE timestamp > now() - INTERVAL {sinceHours:UInt32} HOUR
            ${nullFilter}
            GROUP BY key
            ORDER BY count DESC
            LIMIT {limit:UInt32}
        `;

        try {
            const rows = await this.clickhouse.query<{ key: string | null; count: string | number }>(
                sql,
                { sinceHours, limit }
            );
            return rows.map(r => ({ key: r.key, count: Number(r.count) }));
        } catch (error) {
            this.logger.warn({ error, dimension, sinceHours, limit }, 'Failed to read traffic aggregate');
            return [];
        }
    }

    /**
     * Build the WHERE fragment + params for an inclusive date window.
     *
     * Timestamps are formatted in ClickHouse's native `DateTime64(3)` UTC form
     * and bound as `String` params, parsed back with `parseDateTimeBestEffort`
     * so the comparison is timezone-stable regardless of node.
     *
     * @param range - Inclusive window; `until` omitted means "to now".
     * @returns The SQL clause and its bound parameters.
     */
    private rangeParams(range: IAnalyticsDateRange): { clause: string; params: Record<string, unknown> } {
        const params: Record<string, unknown> = { since: formatClickHouseDateTime64Utc(range.since) };
        let clause = 'timestamp >= parseDateTimeBestEffort({since:String})';
        if (range.until) {
            params.until = formatClickHouseDateTime64Utc(range.until);
            clause += ' AND timestamp <= parseDateTimeBestEffort({until:String})';
        }
        return { clause, params };
    }

    /**
     * Distinct analytics visitors (tids) per calendar day over the window.
     *
     * @param range - Inclusive date window.
     * @returns One point per day with the distinct-visitor count, oldest first.
     */
    async getDailyVisitors(range: IAnalyticsDateRange): Promise<IDailyVisitorPoint[]> {
        if (!this.clickhouse) return [];
        const { clause, params } = this.rangeParams(range);
        const sql = `
            SELECT toDate(timestamp) AS day, uniqExact(candidate_uid) AS visitors
            FROM ${TABLE_NAME}
            WHERE ${clause}
            GROUP BY day
            ORDER BY day ASC
        `;
        try {
            const rows = await this.clickhouse.query<{ day: string; visitors: string | number }>(sql, params);
            return rows.map(r => ({ day: String(r.day), visitors: Number(r.visitors) }));
        } catch (error) {
            this.logger.warn({ error }, 'Failed to read daily visitors');
            return [];
        }
    }

    /**
     * First-touch attribution per tid: the path/referer/UTM of each visitor's
     * earliest event in the window, newest-first by first-seen.
     *
     * @param range - Inclusive date window.
     * @param limit - Page size.
     * @param skip - Pagination offset.
     * @returns First-touch origin rows.
     */
    async getVisitorOrigins(range: IAnalyticsDateRange, limit = 50, skip = 0): Promise<ITrafficVisitorOrigin[]> {
        if (!this.clickhouse) return [];
        const { clause, params } = this.rangeParams(range);
        const sql = `
            SELECT
                candidate_uid AS candidateUid,
                min(timestamp) AS firstSeen,
                argMin(path, timestamp) AS path,
                argMin(referer, timestamp) AS referer,
                argMin(utm_source, timestamp) AS utmSource,
                argMin(utm_medium, timestamp) AS utmMedium,
                argMin(utm_campaign, timestamp) AS utmCampaign
            FROM ${TABLE_NAME}
            WHERE ${clause}
            GROUP BY candidate_uid
            ORDER BY firstSeen DESC
            LIMIT {limit:UInt32} OFFSET {skip:UInt32}
        `;
        try {
            const rows = await this.clickhouse.query<{
                candidateUid: string; firstSeen: string; path: string;
                referer: string | null; utmSource: string | null;
                utmMedium: string | null; utmCampaign: string | null;
            }>(sql, { ...params, limit, skip });
            return rows.map(r => ({
                candidateUid: r.candidateUid,
                firstSeen: String(r.firstSeen),
                path: r.path,
                referer: r.referer,
                utmSource: r.utmSource,
                utmMedium: r.utmMedium,
                utmCampaign: r.utmCampaign
            }));
        } catch (error) {
            this.logger.warn({ error }, 'Failed to read visitor origins');
            return [];
        }
    }

    /**
     * Referrer-domain breakdown. Null/empty referers collapse to `'direct'`.
     *
     * @param range - Inclusive date window.
     * @returns Source-domain row counts, descending.
     */
    async getTrafficSources(range: IAnalyticsDateRange): Promise<ITrafficSourceBucket[]> {
        if (!this.clickhouse) return [];
        const { clause, params } = this.rangeParams(range);
        const sql = `
            SELECT
                multiIf(referer IS NULL OR referer = '', 'direct', domain(referer)) AS source,
                count() AS count
            FROM ${TABLE_NAME}
            WHERE ${clause}
            GROUP BY source
            ORDER BY count DESC
        `;
        try {
            const rows = await this.clickhouse.query<{ source: string; count: string | number }>(sql, params);
            return rows.map(r => ({ source: r.source, count: Number(r.count) }));
        } catch (error) {
            this.logger.warn({ error }, 'Failed to read traffic sources');
            return [];
        }
    }

    /**
     * Top landing paths by event count.
     *
     * @param range - Inclusive date window.
     * @param limit - Max rows.
     * @returns Path row counts, descending.
     */
    async getTopLandingPages(range: IAnalyticsDateRange, limit = 20): Promise<ILandingPageBucket[]> {
        if (!this.clickhouse) return [];
        const { clause, params } = this.rangeParams(range);
        const sql = `
            SELECT path AS path, count() AS count
            FROM ${TABLE_NAME}
            WHERE ${clause} AND path != ''
            GROUP BY path
            ORDER BY count DESC
            LIMIT {limit:UInt32}
        `;
        try {
            const rows = await this.clickhouse.query<{ path: string; count: string | number }>(sql, { ...params, limit });
            return rows.map(r => ({ path: r.path, count: Number(r.count) }));
        } catch (error) {
            this.logger.warn({ error }, 'Failed to read top landing pages');
            return [];
        }
    }

    /**
     * Geographic distribution (ISO-3166 alpha-2). Null country excluded.
     *
     * @param range - Inclusive date window.
     * @param limit - Max rows.
     * @returns Country row counts, descending.
     */
    async getGeoDistribution(range: IAnalyticsDateRange, limit = 30): Promise<IGeoBucket[]> {
        if (!this.clickhouse) return [];
        const { clause, params } = this.rangeParams(range);
        const sql = `
            SELECT country, count() AS count
            FROM ${TABLE_NAME}
            WHERE ${clause} AND country IS NOT NULL
            GROUP BY country
            ORDER BY count DESC
            LIMIT {limit:UInt32}
        `;
        try {
            const rows = await this.clickhouse.query<{ country: string | null; count: string | number }>(sql, { ...params, limit });
            return rows.map(r => ({ country: r.country, count: Number(r.count) }));
        } catch (error) {
            this.logger.warn({ error }, 'Failed to read geo distribution');
            return [];
        }
    }

    /**
     * Device-category breakdown.
     *
     * @param range - Inclusive date window.
     * @returns Device row counts, descending.
     */
    async getDeviceBreakdown(range: IAnalyticsDateRange): Promise<IDeviceBucket[]> {
        if (!this.clickhouse) return [];
        const { clause, params } = this.rangeParams(range);
        const sql = `
            SELECT device, count() AS count
            FROM ${TABLE_NAME}
            WHERE ${clause}
            GROUP BY device
            ORDER BY count DESC
        `;
        try {
            const rows = await this.clickhouse.query<{ device: string; count: string | number }>(sql, params);
            return rows.map(r => ({ device: r.device, count: Number(r.count) }));
        } catch (error) {
            this.logger.warn({ error }, 'Failed to read device breakdown');
            return [];
        }
    }

    /**
     * New-vs-returning visitors per day. A tid is "new" on the day its global
     * first-seen (across the full table) falls, "returning" otherwise. The
     * full-table first-seen is computed in a subquery and joined to in-window
     * day activity.
     *
     * @param range - Inclusive date window.
     * @returns Per-day new/returning split, oldest first.
     */
    async getRetention(range: IAnalyticsDateRange): Promise<IRetentionPoint[]> {
        if (!this.clickhouse) return [];
        const { clause, params } = this.rangeParams(range);
        const sql = `
            SELECT
                d.day AS day,
                countIf(f.first_day = d.day) AS newVisitors,
                countIf(f.first_day < d.day) AS returningVisitors
            FROM (
                SELECT candidate_uid, toDate(timestamp) AS day
                FROM ${TABLE_NAME}
                WHERE ${clause}
                GROUP BY candidate_uid, day
            ) AS d
            INNER JOIN (
                SELECT candidate_uid, min(toDate(timestamp)) AS first_day
                FROM ${TABLE_NAME}
                WHERE candidate_uid IN (
                    SELECT DISTINCT candidate_uid
                    FROM ${TABLE_NAME}
                    WHERE ${clause}
                )
                GROUP BY candidate_uid
            ) AS f USING (candidate_uid)
            GROUP BY day
            ORDER BY day ASC
        `;
        try {
            const rows = await this.clickhouse.query<{ day: string; newVisitors: string | number; returningVisitors: string | number }>(sql, params);
            return rows.map(r => ({ day: String(r.day), newVisitors: Number(r.newVisitors), returningVisitors: Number(r.returningVisitors) }));
        } catch (error) {
            this.logger.warn({ error }, 'Failed to read retention');
            return [];
        }
    }

    /**
     * Binary conversion funnel over the window: distinct visitors (tids) vs.
     * tids that ever carried a non-null `user_id`.
     *
     * @param range - Inclusive date window.
     * @returns Distinct/converted counts and the derived rate.
     */
    async getBinaryConversionFunnel(range: IAnalyticsDateRange): Promise<IBinaryConversionFunnel> {
        const empty: IBinaryConversionFunnel = { distinctVisitors: 0, converted: 0, conversionRate: 0 };
        if (!this.clickhouse) return empty;
        const { clause, params } = this.rangeParams(range);
        const sql = `
            SELECT
                uniqExact(candidate_uid) AS distinctVisitors,
                uniqExactIf(candidate_uid, user_id IS NOT NULL) AS converted
            FROM ${TABLE_NAME}
            WHERE ${clause}
        `;
        try {
            const rows = await this.clickhouse.query<{ distinctVisitors: string | number; converted: string | number }>(sql, params);
            const row = rows[0];
            if (!row) return empty;
            const distinctVisitors = Number(row.distinctVisitors);
            const converted = Number(row.converted);
            return { distinctVisitors, converted, conversionRate: distinctVisitors > 0 ? converted / distinctVisitors : 0 };
        } catch (error) {
            this.logger.warn({ error }, 'Failed to read conversion funnel');
            return empty;
        }
    }

    /**
     * UTM-campaign performance joined to the binary conversion. Only events
     * carrying a campaign are counted.
     *
     * @param range - Inclusive date window.
     * @param limit - Max campaigns.
     * @returns Per-campaign visitors, conversions, and rate, by visitors desc.
     */
    async getCampaignPerformance(range: IAnalyticsDateRange, limit = 20): Promise<ICampaignPerformanceBucket[]> {
        if (!this.clickhouse) return [];
        const { clause, params } = this.rangeParams(range);
        const sql = `
            SELECT
                coalesce(utm_campaign, '(none)') AS campaign,
                coalesce(utm_source, '(none)') AS source,
                coalesce(utm_medium, '(none)') AS medium,
                uniqExact(candidate_uid) AS visitors,
                uniqExactIf(candidate_uid, user_id IS NOT NULL) AS conversions
            FROM ${TABLE_NAME}
            WHERE ${clause} AND utm_campaign IS NOT NULL
            GROUP BY campaign, source, medium
            ORDER BY visitors DESC
            LIMIT {limit:UInt32}
        `;
        try {
            const rows = await this.clickhouse.query<{
                campaign: string; source: string; medium: string;
                visitors: string | number; conversions: string | number;
            }>(sql, { ...params, limit });
            return rows.map(r => {
                const visitors = Number(r.visitors);
                const conversions = Number(r.conversions);
                return {
                    campaign: r.campaign,
                    source: r.source,
                    medium: r.medium,
                    visitors,
                    conversions,
                    conversionRate: visitors > 0 ? conversions / visitors : 0
                };
            });
        } catch (error) {
            this.logger.warn({ error }, 'Failed to read campaign performance');
            return [];
        }
    }

    /**
     * Engagement metrics from `session_end` and `page` events: average session
     * duration, pages per session, and bounce rate (sessions under 10s or with
     * no recorded page activity). Reads near zero until Phase D wires session
     * emission.
     *
     * @param range - Inclusive date window.
     * @returns Aggregate engagement metrics.
     */
    async getEngagementMetrics(range: IAnalyticsDateRange): Promise<IEngagementMetrics> {
        const empty: IEngagementMetrics = { sessions: 0, avgDurationMs: 0, pagesPerSession: 0, bounceRate: 0 };
        if (!this.clickhouse) return empty;
        const { clause, params } = this.rangeParams(range);
        const sql = `
            SELECT
                countIf(event_type = 'session_start') AS sessions,
                countIf(event_type = 'page') AS pageEvents,
                avgIf(duration_ms, event_type = 'session_end' AND duration_ms IS NOT NULL) AS avgDurationMs,
                countIf(event_type = 'session_end' AND (duration_ms IS NULL OR duration_ms < 10000)) AS bounces
            FROM ${TABLE_NAME}
            WHERE ${clause}
        `;
        try {
            const rows = await this.clickhouse.query<{
                sessions: string | number; pageEvents: string | number;
                avgDurationMs: string | number | null; bounces: string | number;
            }>(sql, params);
            const row = rows[0];
            if (!row) return empty;
            const sessions = Number(row.sessions);
            const pageEvents = Number(row.pageEvents);
            const bounces = Number(row.bounces);
            return {
                sessions,
                avgDurationMs: Number(row.avgDurationMs ?? 0),
                pagesPerSession: sessions > 0 ? pageEvents / sessions : 0,
                bounceRate: sessions > 0 ? bounces / sessions : 0
            };
        } catch (error) {
            this.logger.warn({ error }, 'Failed to read engagement metrics');
            return empty;
        }
    }

    /**
     * Visitors whose global first-seen (across the full table) falls inside the
     * window — the "new arrivals" of the period — newest first, with first-touch
     * attribution and lifetime activity counts.
     *
     * The heavy per-tid grouping is bounded to tids active in the window (a new
     * tid has its first event in-window, so it is always in that set), then
     * `HAVING` keeps only those whose global min timestamp lands in the window.
     * The inner `IN` filters which tids participate, not which of their rows
     * count, so `min`/`max`/`argMin` still see each tid's full history.
     *
     * @param range - Inclusive date window.
     * @param limit - Page size.
     * @param skip - Pagination offset.
     * @returns A page of new-visitor origins plus the unpaginated total.
     */
    async getNewVisitors(range: IAnalyticsDateRange, limit = 50, skip = 0): Promise<INewVisitorsPage> {
        if (!this.clickhouse) return { visitors: [], total: 0 };
        const { clause, params } = this.rangeParams(range);
        let firstSeenClause = 'firstSeen >= parseDateTimeBestEffort({since:String})';
        if (range.until) {
            firstSeenClause += ' AND firstSeen <= parseDateTimeBestEffort({until:String})';
        }
        const activeInWindow = `candidate_uid IN (SELECT DISTINCT candidate_uid FROM ${TABLE_NAME} WHERE ${clause})`;
        const pageSql = `
            SELECT
                candidate_uid AS userId,
                min(timestamp) AS firstSeen,
                max(timestamp) AS lastSeen,
                argMin(country, timestamp) AS country,
                argMin(multiIf(referer IS NULL OR referer = '', NULL, domain(referer)), timestamp) AS referrerDomain,
                argMin(path, timestamp) AS landingPage,
                argMin(device, timestamp) AS device,
                argMin(utm_source, timestamp) AS utmSource,
                argMin(utm_medium, timestamp) AS utmMedium,
                argMin(utm_campaign, timestamp) AS utmCampaign,
                argMin(utm_term, timestamp) AS utmTerm,
                argMin(utm_content, timestamp) AS utmContent,
                count() AS pageViews,
                countIf(event_type = 'session_start') AS sessionsCount
            FROM ${TABLE_NAME}
            WHERE ${activeInWindow}
            GROUP BY candidate_uid
            HAVING ${firstSeenClause}
            ORDER BY firstSeen DESC
            LIMIT {limit:UInt32} OFFSET {skip:UInt32}
        `;
        const countSql = `
            SELECT count() AS total FROM (
                SELECT candidate_uid, min(timestamp) AS firstSeen
                FROM ${TABLE_NAME}
                WHERE ${activeInWindow}
                GROUP BY candidate_uid
                HAVING ${firstSeenClause}
            )
        `;
        try {
            const [rows, countRows] = await Promise.all([
                this.clickhouse.query<{
                    userId: string; firstSeen: string; lastSeen: string;
                    country: string | null; referrerDomain: string | null;
                    landingPage: string; device: string;
                    utmSource: string | null; utmMedium: string | null; utmCampaign: string | null;
                    utmTerm: string | null; utmContent: string | null;
                    pageViews: string | number; sessionsCount: string | number;
                }>(pageSql, { ...params, limit, skip }),
                this.clickhouse.query<{ total: string | number }>(countSql, params)
            ]);
            const visitors: INewVisitorOrigin[] = rows.map(r => {
                const hasUtm = Boolean(r.utmSource || r.utmMedium || r.utmCampaign || r.utmTerm || r.utmContent);
                return {
                    userId: r.userId,
                    firstSeen: String(r.firstSeen),
                    lastSeen: String(r.lastSeen),
                    country: r.country ?? null,
                    referrerDomain: r.referrerDomain ?? null,
                    landingPage: r.landingPage ?? null,
                    device: r.device,
                    utm: hasUtm
                        ? {
                              source: r.utmSource ?? null,
                              medium: r.utmMedium ?? null,
                              campaign: r.utmCampaign ?? null,
                              term: r.utmTerm ?? null,
                              content: r.utmContent ?? null
                          }
                        : null,
                    searchKeyword: null,
                    sessionsCount: Number(r.sessionsCount),
                    pageViews: Number(r.pageViews)
                };
            });
            return { visitors, total: Number(countRows[0]?.total ?? 0) };
        } catch (error) {
            this.logger.warn({ error }, 'Failed to read new visitors');
            return { visitors: [], total: 0 };
        }
    }

    /**
     * Drill-down breakdown for a single referrer source (a referrer domain or
     * `'direct'`): visitor count, top landing pages / countries / devices / UTM
     * campaigns, engagement, and the binary conversion proxy.
     *
     * Percentages are each row's share of the source's total pageviews. The
     * source is matched the same way {@link getTrafficSources} buckets it, so a
     * value returned there round-trips here.
     *
     * @param range - Inclusive date window.
     * @param source - Referrer domain (e.g. `'duckduckgo.com'`) or `'direct'`.
     * @returns The source breakdown, or an empty shell when the source has no
     *          events in the window.
     */
    async getTrafficSourceDetails(range: IAnalyticsDateRange, source: string): Promise<ITrafficSourceDetailsResult> {
        const empty: ITrafficSourceDetailsResult = {
            source,
            visitors: 0,
            landingPages: [],
            countries: [],
            devices: [],
            utmCampaigns: [],
            searchKeywords: [],
            engagement: { avgSessions: 0, avgPageViews: 0, avgDuration: 0 },
            conversion: { walletsConnected: 0, walletsVerified: 0, conversionRate: 0 }
        };
        if (!this.clickhouse) return empty;
        const { clause, params } = this.rangeParams(range);
        const sourceExpr = `multiIf(referer IS NULL OR referer = '', 'direct', domain(referer))`;
        const where = `${clause} AND ${sourceExpr} = {source:String}`;
        const p = { ...params, source };
        const round1 = (n: number): number => Math.round(n * 10) / 10;
        try {
            const summaryRows = await this.clickhouse.query<{
                visitors: string | number; sessions: string | number; events: string | number;
                avgDuration: string | number | null; converted: string | number;
            }>(`
                SELECT
                    uniqExact(candidate_uid) AS visitors,
                    countIf(event_type = 'session_start') AS sessions,
                    count() AS events,
                    avgIf(duration_ms, event_type = 'session_end' AND duration_ms IS NOT NULL) AS avgDuration,
                    uniqExactIf(candidate_uid, user_id IS NOT NULL) AS converted
                FROM ${TABLE_NAME}
                WHERE ${where}
            `, p);
            const summary = summaryRows[0];
            const visitors = summary ? Number(summary.visitors) : 0;
            if (!visitors) return empty;
            const events = Number(summary.events);
            const sessions = Number(summary.sessions);
            const converted = Number(summary.converted);
            const pct = (count: number): number => (events > 0 ? round1((count / events) * 100) : 0);

            const [landingRows, countryRows, deviceRows, utmRows] = await Promise.all([
                this.clickhouse.query<{ path: string; count: string | number }>(`
                    SELECT path, count() AS count FROM ${TABLE_NAME} WHERE ${where}
                    GROUP BY path ORDER BY count DESC LIMIT 10
                `, p),
                this.clickhouse.query<{ country: string; count: string | number }>(`
                    SELECT country, count() AS count FROM ${TABLE_NAME} WHERE ${where} AND country IS NOT NULL
                    GROUP BY country ORDER BY count DESC LIMIT 30
                `, p),
                this.clickhouse.query<{ device: string; count: string | number }>(`
                    SELECT device, count() AS count FROM ${TABLE_NAME} WHERE ${where}
                    GROUP BY device ORDER BY count DESC
                `, p),
                this.clickhouse.query<{ source: string | null; medium: string | null; campaign: string; count: string | number }>(`
                    SELECT
                        utm_source AS source, utm_medium AS medium, utm_campaign AS campaign,
                        count() AS count
                    FROM ${TABLE_NAME} WHERE ${where} AND utm_campaign IS NOT NULL
                    GROUP BY source, medium, campaign ORDER BY count DESC LIMIT 10
                `, p)
            ]);

            return {
                source,
                visitors,
                landingPages: landingRows.map(r => ({ path: r.path, count: Number(r.count), percentage: pct(Number(r.count)) })),
                countries: countryRows.map(r => ({ country: r.country, count: Number(r.count), percentage: pct(Number(r.count)) })),
                devices: deviceRows.map(r => ({ device: r.device, count: Number(r.count), percentage: pct(Number(r.count)) })),
                utmCampaigns: utmRows.map(r => ({
                    source: r.source ?? '(none)',
                    medium: r.medium ?? '(none)',
                    campaign: r.campaign,
                    count: Number(r.count)
                })),
                searchKeywords: [],
                engagement: {
                    avgSessions: round1(sessions / visitors),
                    avgPageViews: round1(events / visitors),
                    avgDuration: Number(summary.avgDuration ?? 0)
                },
                conversion: {
                    walletsConnected: 0,
                    walletsVerified: 0,
                    conversionRate: round1((converted / visitors) * 100)
                }
            };
        } catch (error) {
            this.logger.warn({ error }, 'Failed to read traffic source details');
            return empty;
        }
    }
}

/**
 * Inputs the controller can derive from the request body and cookie state
 * but the request headers cannot supply on their own.
 *
 * Phase 1 forwards a small JSON body alongside the inbound headers so the
 * backend has real visitor context (landing path, UTM params, original
 * referrer captured by the legacy-redirect middleware) on the bootstrap
 * call. The `startSession` payload supplies the same shape from the
 * frontend session-start fetch.
 */
export interface ITrafficEventBuilderInputs {
    /** Sanitized landing path; falls back to `req.path` when omitted. */
    landingPath?: string;
    /** UTM params parsed from the URL or session-start payload. */
    utm?: {
        source?: string | null;
        medium?: string | null;
        campaign?: string | null;
        term?: string | null;
        content?: string | null;
    };
    /** `document.referrer` reported by the client at landing. */
    originalReferrer?: string | null;
    /**
     * Better Auth user id when the visitor is logged in, else absent.
     * Populates the additive `user_id` column for account attribution.
     */
    userId?: string | null;
    /**
     * Referral code captured first-touch (`tronrelic_ref`), else absent.
     * Populates the additive `referral_code` column.
     */
    referralCode?: string | null;
    /**
     * Session duration in ms, populated for `session_end` events. Maps to the
     * `duration_ms` column; absent (→ null) for every other event type.
     */
    durationMs?: number | null;
}

/**
 * Build an `ITrafficEvent` from an Express request and a candidate UUID.
 *
 * Centralizes "request → ITrafficEvent" mapping so both the bootstrap
 * controller (Phase 2) and the session-start controller (Phase 3) emit
 * rows with the same shape. The geo / device helpers are reused from
 * `geo.service.ts` so the device-category and country-derivation rules
 * stay in one place.
 *
 * The builder never throws — every dimension is `Nullable` in the
 * ClickHouse schema, so missing or malformed input collapses to `null`
 * rather than failing the inbound request.
 *
 * @param eventType - Categorical kind of event (`'bootstrap'` or
 *   `'session_start'`). Future event types extend the union without a
 *   schema change since the column is `LowCardinality(String)`.
 * @param candidateUid - UUID v4 the cookie is anchored to. The caller is
 *   responsible for resolving merge tombstones to the canonical id
 *   before emitting; otherwise analytics split across stale/canonical
 *   ids and Phase 3's first-touch lookup misses.
 * @param req - Express request whose headers carry the visitor's
 *   browser context (UA, Referer, Sec-CH-UA*, Sec-Fetch-*) and whose IP
 *   resolves the country dimension. Headers default to `{}` when
 *   absent, keeping the builder safe to call with stub requests in
 *   tests.
 * @param inputs - Optional extra context the controller derived from
 *   the request body or cookie state and that headers cannot supply on
 *   their own (`landingPath`, `utm`, `originalReferrer`). See
 *   `ITrafficEventBuilderInputs` for per-field docs. Defaults to `{}`
 *   so callers that only have request-level context (none of the body
 *   payload) can call the builder without a sentinel object.
 */
export function buildTrafficEvent(
    eventType: TrafficEventType,
    candidateUid: string,
    req: Request,
    inputs: ITrafficEventBuilderInputs = {}
): ITrafficEvent {
    const headers = req.headers ?? {};
    const userAgent = readSingleHeader(headers['user-agent']);
    const referer = readSingleHeader(headers['referer']);
    const acceptLanguage = readSingleHeader(headers['accept-language']);
    const secChUa = readSingleHeader(headers['sec-ch-ua']);
    const secChUaMobile = readSingleHeader(headers['sec-ch-ua-mobile']);
    const secChUaPlatform = readSingleHeader(headers['sec-ch-ua-platform']);
    const secFetchDest = readSingleHeader(headers['sec-fetch-dest']);
    const secFetchMode = readSingleHeader(headers['sec-fetch-mode']);
    const secFetchSite = readSingleHeader(headers['sec-fetch-site']);

    const utm = inputs.utm ?? {};

    return {
        event_type: eventType,
        timestamp: new Date(),
        candidate_uid: candidateUid,
        user_id: inputs.userId ?? null,
        referral_code: inputs.referralCode ?? null,
        duration_ms: inputs.durationMs ?? null,

        path: inputs.landingPath ?? (typeof req.path === 'string' ? req.path : '/'),
        referer: referer ?? null,
        original_referrer: inputs.originalReferrer ?? null,

        user_agent: userAgent ?? null,
        accept_language: acceptLanguage ?? null,

        country: getCountryFromIP(getClientIP({ ip: req.ip, headers })),
        device: getDeviceCategory(userAgent),
        bot_class: classifyUserAgent(userAgent),

        utm_source: utm.source ?? null,
        utm_medium: utm.medium ?? null,
        utm_campaign: utm.campaign ?? null,
        utm_term: utm.term ?? null,
        utm_content: utm.content ?? null,

        sec_ch_ua: secChUa ?? null,
        sec_ch_ua_mobile: parseSecChUaMobile(secChUaMobile),
        sec_ch_ua_platform: secChUaPlatform ?? null,
        sec_fetch_dest: secFetchDest ?? null,
        sec_fetch_mode: secFetchMode ?? null,
        sec_fetch_site: secFetchSite ?? null
    };
}

/**
 * Express normalizes most headers to a single string but allows arrays
 * for ones that can repeat (e.g. `Set-Cookie`). For our forwarded set we
 * only care about the first occurrence; coercing the array form here
 * keeps the call site free of `Array.isArray` checks.
 */
function readSingleHeader(value: string | string[] | undefined): string | undefined {
    if (Array.isArray(value)) {
        return value[0];
    }
    return value;
}

/**
 * Parse the `Sec-CH-UA-Mobile` header (`"?0"` / `"?1"`) into the 0/1 form
 * the ClickHouse `Nullable(UInt8)` column expects. Anything else maps to
 * null so a malformed client header doesn't poison the row.
 */
function parseSecChUaMobile(value: string | undefined): number | null {
    if (value === '?1') return 1;
    if (value === '?0') return 0;
    return null;
}

/**
 * Wire-format row returned by ClickHouse. `timestamp` arrives as a UTC
 * `DateTime64(3)` string in `YYYY-MM-DD HH:MM:SS.mmm` form (ClickHouse's
 * native format under `JSONEachRow`); everything else lines up with
 * `ITrafficEvent` directly.
 */
interface TrafficEventRow extends Omit<ITrafficEvent, 'timestamp'> {
    timestamp: string;
}

function pad(value: number, length: number): string {
    return String(value).padStart(length, '0');
}

/**
 * Render a `Date` in ClickHouse's native `DateTime64(3)` form, in UTC.
 *
 * The default `date_time_input_format=basic` rejects `toISOString()`
 * output (the `T...Z` form) — inserts would fail in production. The
 * column is declared `DateTime64(3, 'UTC')` so emitting in UTC keeps
 * the wire format and the column tz aligned regardless of which
 * ClickHouse node the row lands on.
 */
function formatClickHouseDateTime64Utc(date: Date): string {
    return (
        `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1, 2)}-${pad(date.getUTCDate(), 2)} ` +
        `${pad(date.getUTCHours(), 2)}:${pad(date.getUTCMinutes(), 2)}:${pad(date.getUTCSeconds(), 2)}.${pad(date.getUTCMilliseconds(), 3)}`
    );
}

/**
 * Inverse of `formatClickHouseDateTime64Utc`. Falls back to `new Date(value)`
 * for any unrecognized form so a future ClickHouse driver upgrade that
 * normalizes timestamps to ISO doesn't break us silently.
 */
function parseClickHouseDateTime64Utc(value: string): Date {
    const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?Z?$/.exec(value);
    if (!match) {
        return new Date(value);
    }
    const [, year, month, day, hour, minute, second, milliseconds = '0'] = match;
    return new Date(Date.UTC(
        Number(year),
        Number(month) - 1,
        Number(day),
        Number(hour),
        Number(minute),
        Number(second),
        Number(milliseconds.padEnd(3, '0'))
    ));
}

/**
 * Convert an `ITrafficEvent` into the shape ClickHouse expects on insert.
 * `timestamp` becomes a UTC `DateTime64(3)` string in ClickHouse's native
 * form so inserts succeed under the default `date_time_input_format=basic`.
 *
 * Exported so migration 011 (Phase 6 backfill) can build synthetic events
 * from `IUserDocument.activity.origin` and feed them through the same
 * wire-format pipeline as live traffic. Internal callers (`recordEvent`)
 * use it via the `serializeEvent` alias to keep the original name local
 * to this file.
 */
export function serializeTrafficEventForClickHouse(event: ITrafficEvent): Record<string, unknown> {
    return { ...event, timestamp: formatClickHouseDateTime64Utc(event.timestamp) };
}

const serializeEvent = serializeTrafficEventForClickHouse;

/**
 * Inverse of `serializeEvent`. Re-hydrates the `Date` instance from
 * ClickHouse's native `DateTime64(3)` string form.
 */
function deserializeEvent(row: TrafficEventRow): ITrafficEvent {
    return { ...row, timestamp: parseClickHouseDateTime64Utc(row.timestamp) };
}

/**
 * Raw query input understood by {@link resolveAnalyticsRange}.
 *
 * The HTTP layer passes `req.query` straight in. Ported from the legacy
 * `UserService.resolveAnalyticsRange` so the traffic module owns its analytics
 * range vocabulary without depending on the soon-to-be-removed user module.
 */
export interface IAnalyticsRangeQuery {
    /** Preset window: `'24h'` | `'7d'` | `'30d'` | `'90d'`. */
    period?: string;
    /** ISO start for a custom range; both ends must be valid. */
    startDate?: string;
    /** ISO end for a custom range; both ends must be valid. */
    endDate?: string;
}

const HOURS_BY_PERIOD: Record<string, number> = {
    '24h': 24,
    '7d': 7 * 24,
    '30d': 30 * 24,
    '90d': 90 * 24
};

/**
 * Resolve a query's preset/custom window to an inclusive date range.
 *
 * A valid custom `(startDate, endDate)` pair wins; otherwise the named period
 * (default `'30d'`) is converted to a `since` offset from now. Lenient — a
 * malformed or inverted custom range falls through to the preset rather than
 * throwing, so a bad query param degrades to the default window.
 *
 * @param query - Raw `req.query`-shaped input.
 * @param defaultPeriod - Fallback preset when none is supplied.
 * @returns Inclusive analytics window.
 */
export function resolveAnalyticsRange(query: IAnalyticsRangeQuery, defaultPeriod = '30d'): IAnalyticsDateRange {
    const { startDate, endDate, period } = query;

    if (startDate && endDate) {
        const since = new Date(startDate);
        const until = new Date(endDate);
        if (!Number.isNaN(since.getTime()) && !Number.isNaN(until.getTime()) && since.getTime() <= until.getTime()) {
            return { since, until };
        }
    }

    const hours = HOURS_BY_PERIOD[period ?? defaultPeriod] ?? HOURS_BY_PERIOD[defaultPeriod] ?? 30 * 24;
    return { since: new Date(Date.now() - hours * 60 * 60 * 1000) };
}
