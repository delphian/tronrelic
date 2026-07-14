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
import { getIpHash, getSubnetHash } from './ip-hash.js';
import { classifyTrafficRequest, type BotClass } from './bot-classifier.js';
import { classifyChannel, refererDomainFromUrl, type TrafficChannel } from './channel-classifier.js';
import { UUID_V4_REGEX } from '../api/traffic-cookies.js';

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

    /**
     * Cloudflare ray id (`CF-Ray` header) when the request traversed the
     * Cloudflare proxy, else `null`. A `null` here on production traffic
     * means the request hit the origin directly, bypassing Cloudflare —
     * the signal that distinguishes proxied scanners (a WAF-tuning
     * problem) from direct-to-origin scanners (a firewall problem).
     * Additive column (migration 014).
     */
    cf_ray: string | null;
    /**
     * Cloudflare's authoritative edge-derived country (`CF-IPCountry`
     * header, ISO-3166 alpha-2), else `null`. Kept alongside the local
     * GeoIP-derived `country` so the two sources can be compared.
     * Additive column (migration 014).
     */
    cf_ipcountry: string | null;

    /**
     * Keyed SHA-256 (16 hex chars) of the client IP, salted server-side —
     * see `services/ip-hash.ts`. Correlates events from the same client
     * without storing the address. Additive column (migration 015).
     */
    ip_hash: string | null;
    /**
     * Keyed SHA-256 (16 hex chars) of the client's containing network
     * (/24 IPv4, /48 IPv6). Groups address rotation within one provider
     * block — the signal that distinguishes one noisy source from a
     * distributed scanner fleet. Additive column (migration 015).
     */
    subnet_hash: string | null;

    /**
     * Acquisition channel classified at write time from the referrer, UTM
     * parameters, and paid click-IDs — see `services/channel-classifier.ts`.
     * Populated on `bootstrap` rows only: `page` rows carry the site's own
     * origin as referrer, so a per-row classification would be noise; they
     * store `null`, as do rows written before migration 016. Reads fall
     * back to classifying the referrer domain. Additive column (016).
     */
    channel: TrafficChannel | null;
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

/**
 * One day's per-bot-class row counts. `counts` is keyed by the `BotClass`
 * value (`human`, `search_engine`, `ai_crawler`, ...), with rows whose
 * `bot_class` is NULL folded into an `'unclassified'` bucket so pre-classifier
 * data stays visible on the trend chart.
 */
export interface IBotClassDailyPoint {
    /** Calendar day in `YYYY-MM-DD`. */
    day: string;
    /** Row count per bot class for the day. */
    counts: Record<string, number>;
}

/**
 * Referrer-domain (or `'direct'`) bucket. `visitors` (distinct tids) is the
 * primary measure — the convention every analytics platform leads with —
 * while `count` keeps the raw event rows for diagnostic context.
 */
export interface ITrafficSourceBucket {
    source: string;
    /** Distinct visitors (tids) — the primary measure. */
    visitors: number;
    /** Raw event rows. */
    count: number;
    /**
     * Acquisition channel for the bucket — the most frequent stored
     * write-time value among the bucket's rows, else classified server-side
     * from the referrer domain when no row carries one (pre-migration-016
     * data). A mixed bucket (google.com serving both organic and cpc) badges
     * with its dominant channel.
     */
    channel: TrafficChannel;
}

/** Landing-path bucket: distinct visitors primary, raw event rows secondary. */
export interface ILandingPageBucket {
    path: string;
    /** Distinct visitors (tids) — the primary measure. */
    visitors: number;
    /** Raw event rows. */
    count: number;
}

/** Country (ISO-3166 alpha-2) bucket. `null` excluded by the query. */
export interface IGeoBucket {
    country: string | null;
    /** Distinct visitors (tids) — the primary measure. */
    visitors: number;
    /** Raw event rows. */
    count: number;
}

/** Device-category bucket. */
export interface IDeviceBucket {
    device: string;
    /** Distinct visitors (tids) — the primary measure. */
    visitors: number;
    /** Raw event rows. */
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
 *
 * `converted` counts *any* logged-in visitor — including long-standing account
 * holders returning — so it measures login attribution, not acquisition. The
 * acquisition stage is composed by the controller from this funnel plus the
 * identity module's account-creation dates — see {@link IConversionFunnelResponse}.
 */
export interface IBinaryConversionFunnel {
    distinctVisitors: number;
    converted: number;
    conversionRate: number;
}

/**
 * Wire shape of `GET /analytics/conversion-funnel`: the ClickHouse funnel plus
 * the acquisition stage the controller composes against Better Auth account
 * `createdAt` — the creation-date ground truth, immune to both re-login noise
 * and the traffic table's 18-month TTL (a first-*event* proxy would re-mint
 * long-standing accounts as "new" once their earliest rows expire).
 */
export interface IConversionFunnelResponse extends IBinaryConversionFunnel {
    /**
     * Distinct in-window visitors (tids) attributed to accounts *created*
     * during the window. Counted in visitor units so the funnel stages nest
     * (always a subset of `converted`); an account created outside traffic
     * tracking contributes no tids and is not counted.
     */
    newAccountVisitors: number;
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
 * Headline KPIs for one window of the overview trend. `sessions`,
 * `avgDurationMs`, and `bounceRate` read zero until session-event emission
 * ships (Phase D) — consumers should treat `sessions === 0` as
 * "instrumentation not available", not as a measured zero.
 */
export interface IOverviewKpis {
    /**
     * Distinct Unique Visitors — tids that emitted a `page` event (ran JS) in
     * the window, per the request's bot filter. Cookieless bots never run JS,
     * so this excludes them by construction, not by classification. See the
     * canonical-visitor note by {@link SESSION_GAP_SECONDS}.
     */
    visitors: number;
    /**
     * Visitors (page-event tids) whose page rows are human-classified or
     * unclassified. With bots excluded this equals `visitors`; with bots
     * included it separates real people from JS-running bots that slipped past
     * the classifier. Non-JS bots are already absent from both sides.
     */
    humanVisitors: number;
    /**
     * Visitors (page-event tids) whose page rows are bot-classified — a
     * JavaScript-running bot (headless scraper) the classifier caught. 0 when
     * the request excludes bots. Cookieless non-JS bots never reach this count.
     */
    botVisitors: number;
    /** Interactive `page` events in the window. */
    pageviews: number;
    /** Derived sessions attributed to the window by their start. */
    sessions: number;
    /** Average derived-session duration in ms. */
    avgDurationMs: number;
    /** Bounced sessions / sessions (0-1). */
    bounceRate: number;
}

/** One landing path and its interactive hit count within a trend bucket. */
export interface IOverviewTrendPath {
    /** The `page`-event path (URL) hit. */
    path: string;
    /** Interactive `page` events on this path in the bucket. */
    hits: number;
}

/** One country and its distinct-visitor count within a trend bucket. */
export interface IOverviewTrendCountry {
    /** ISO-3166 alpha-2 country of the `page`-viewing visitors. */
    country: string;
    /** Distinct visitors (tids) located in this country in the bucket. */
    visitors: number;
}

/** One acquisition source and its distinct-visitor count within a trend bucket. */
export interface IOverviewTrendSource {
    /** First-touch referrer domain (or `direct`) the bucket's visitors are attributed to. */
    source: string;
    /** Distinct visitors (tids) whose first touch came from this source. */
    visitors: number;
}

/** One time bucket of the overview trend series. */
export interface IOverviewTrendPoint {
    /** Bucket start — ISO-8601 UTC for hour buckets, `YYYY-MM-DD` for days. */
    bucket: string;
    /** Distinct visitors (tids) in the bucket. */
    visitors: number;
    /** Interactive `page` events in the bucket. */
    pageviews: number;
    /**
     * The bucket's most-hit paths (top 3 by `page`-event count, descending) so
     * the chart tooltip can answer "what did they hit?" without a drill-down
     * request. Empty for zero-traffic buckets. Page-hit counts, not distinct
     * visitors — a path is the URL a `page` beacon reported.
     */
    topPaths: IOverviewTrendPath[];
    /**
     * The bucket's most-active countries (top 3 by distinct visitors,
     * descending). Measured in DISTINCT VISITORS, not page views — a country is
     * a property of the visitor, so a single person refreshing must not inflate
     * it. Shares the visitor unit with the Unique-Visitors bar and the Geo panel;
     * intentionally does not sum to the bucket's total visitors (a bucket can
     * span several countries). Empty for zero-traffic buckets.
     */
    topCountries: IOverviewTrendCountry[];
    /**
     * The bucket's top acquisition sources (top 3 by distinct visitors,
     * descending). Measured in DISTINCT VISITORS by each visitor's first-touch
     * origin — "where did this bucket's visitors come from?", matching
     * {@link topCountries} and the visitor bar rather than {@link topPaths}'
     * page-view unit. Source can only come from the first-touch `bootstrap` row
     * (a `page` row's referrer is the site's own domain), so this is a join, not
     * a plain group-by. Empty for zero-traffic buckets.
     */
    topSources: IOverviewTrendSource[];
}

/**
 * The unified dashboard headline: current-window KPIs, the equal-length
 * previous window for delta rendering, and the zero-filled time series.
 */
export interface IOverviewTrend {
    /** Bucket size — hourly for windows ≤ 48h, daily otherwise. */
    granularity: 'hour' | 'day';
    /** KPIs for the requested window. */
    current: IOverviewKpis;
    /** KPIs for the equal-length window immediately before it. */
    previous: IOverviewKpis;
    /** Zero-filled per-bucket visitors/pageviews, oldest first. */
    series: IOverviewTrendPoint[];
}

/**
 * One row of the analytics new-arrivals table: a tid whose global first-seen
 * (across the full table) falls inside the window, with its first-touch
 * attribution, lifetime page-view count (`page` events only — bootstrap
 * first touches are not views), and in-window derived-session count.
 * Shaped to the frontend `IVisitorOrigin` the `/system/traffic` panel renders
 * directly. `searchKeyword` is always null — `traffic_events` carries no
 * keyword column.
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
    /**
     * First-touch salted subnet hash (16 hex chars, migration 015) — the
     * "same source?" correlation key. Identical values across rows mean the
     * same /24 (IPv4) or /48 (IPv6); `null` for rows written before the
     * column existed.
     */
    subnetHash: string | null;
}

/** A page of {@link INewVisitorOrigin} rows plus the unpaginated total. */
export interface INewVisitorsPage {
    visitors: INewVisitorOrigin[];
    total: number;
}

/**
 * One high-volume source network surfaced by {@link TrafficService.getHighVolumeSubnets}.
 * `subnetHash` is the same salted /24 (IPv4) or /48 (IPv6) hash the New Visitors
 * "Source" column shows, so the dashboard can flag matching rows. An annotation,
 * never an exclusion — see {@link HIGH_VOLUME_SUBNET_MIN_REQUESTS}. `visitors`
 * counts every tid from the network; `pageVisitors` the subset that ran JS
 * (emitted a page event) — a network whose `visitors` far exceeds its
 * `pageVisitors` is the cookieless-bot signature.
 */
export interface IHighVolumeSubnet {
    /** Salted subnet hash (16 hex chars) — matches {@link INewVisitorOrigin.subnetHash}. */
    subnetHash: string;
    /** Total events from the network in the window. */
    requests: number;
    /** Distinct tids (candidate_uids) from the network in the window. */
    visitors: number;
    /** Distinct tids that emitted a `page` event (ran JS) — the human-leaning subset. */
    pageVisitors: number;
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
 * One row of a page-activity clickstream summary: a subject (a tid for
 * anonymous visitors, a Better Auth user id for registered ones) with the
 * lifetime-in-window counts of its `page` events. Powers the per-tid and
 * per-user activity tables on the traffic dashboard. `firstPath`/`lastPath`
 * bound the visit; `distinctPaths` separates a deep explorer from a refresher.
 */
export interface IPageActivityRow {
    /** Subject key — the `candidate_uid` (tid) or `user_id`, depending on the read. */
    id: string;
    /** Earliest in-window `page` event for the subject. */
    firstSeen: string;
    /** Latest in-window `page` event for the subject. */
    lastSeen: string;
    /** Total `page` events in the window. */
    pageViews: number;
    /** Distinct paths the subject hit in the window. */
    distinctPaths: number;
    /** Path of the earliest in-window `page` event. */
    firstPath: string | null;
    /** Path of the latest in-window `page` event. */
    lastPath: string | null;
    /** Country of the latest in-window event (ISO-3166 alpha-2), or `null`. */
    country: string | null;
    /** Device category of the latest in-window event. */
    device: string;
}

/** A page of {@link IPageActivityRow} rows plus the unpaginated subject total. */
export interface IPageActivityPage {
    rows: IPageActivityRow[];
    total: number;
}

/** Which subject column a page-hit drill-down keys on. */
export type PageHitSubject = 'tid' | 'user';

/**
 * One `page` event in a subject's clickstream drill-down. The ordered list of
 * these is the literal "every page they hit" answer the dashboard renders when
 * an operator expands a {@link IPageActivityRow}.
 */
export interface IPageHit {
    /** Server-side wall clock the page event was recorded at. */
    timestamp: string;
    /** The page path. */
    path: string;
    /** HTTP `Referer` at the time, or `null`. */
    referer: string | null;
    /** Device category. */
    device: string;
    /** Country (ISO-3166 alpha-2), or `null`. */
    country: string | null;
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
 * WHERE fragment selecting human traffic for the `excludeBots` analytics
 * reads. The `Referer` header is client-supplied and commonly spoofed by
 * crawlers (google.com referrers on scanner traffic are routine), so
 * visitor/source counts that ignore `bot_class` overstate real audiences.
 * NULL rows are kept: they predate the classifier and cannot be assumed
 * to be bots.
 */
const HUMAN_ROWS_FILTER = "(bot_class = 'human' OR bot_class IS NULL)";

/**
 * Inactivity gap that closes a derived session, in seconds. Thirty minutes
 * is the industry-default session definition (GA4, Matomo, Plausible), so
 * TronRelic's session counts stay comparable to external tooling. Sessions
 * are *derived* in ClickHouse from the `page` event stream (see
 * {@link TrafficService.derivedSessionsSql}) rather than emitted by client
 * beacons — beacon-based session ends are lossy (tab kills, mobile
 * backgrounding), and a derived model recomputes retroactively over the
 * table's full history.
 */
const SESSION_GAP_SECONDS = 30 * 60;

/**
 * Canonical Unique Visitor rule: a visitor is a tid that emitted at least one
 * `page` event in the window — a client that ran JavaScript. Cookieless bots
 * mint a fresh tid on every request but never run JS, so they never emit a
 * `page` event; requiring one removes them from every visitor metric without
 * depending on User-Agent classification, and it is simultaneously the "no-JS"
 * bot signal for visitor counts. Bootstrap-only tids (no page event) still
 * appear in the raw `bot_class` breakdowns on the Crawlers tab — they are
 * simply not *visitors*. Reads that scan `page` rows express the rule inline as
 * `uniqExactIf(candidate_uid, event_type = 'page')`; reads restricted to
 * non-`page` rows (the `bootstrap`-only source/landing/campaign reads) AND in
 * {@link TrafficService.pageVisitorMembership}.
 */

/**
 * Minimum in-window request count from a single /24 (IPv4) or /48 (IPv6)
 * network for {@link TrafficService.getHighVolumeSubnets} to flag it as a
 * possible automated source. This is an *annotation* threshold only — flagged
 * networks are surfaced to the operator, never auto-excluded from human visitor
 * counts, because legitimate shared egress points (offices, VPNs, universities,
 * mobile carriers) also concentrate many real visitors behind one network.
 * Deliberately high so the flag reads as "worth a look", not "definitely a bot".
 */
const HIGH_VOLUME_SUBNET_MIN_REQUESTS = 500;

/**
 * ClickHouse-backed traffic events store.
 *
 * Acquire via `TrafficService.setDependencies(...)` once during
 * `TrafficModule.init()`, then `TrafficService.getInstance()` in callers.
 */
export class TrafficService {
    private static instance: TrafficService | null = null;

    /**
     * The operator ignore list, in two cached forms. `ignoredUserIds` is the raw
     * Better Auth account list from Mongo; `ignoredCandidateUids` is the resolved
     * "whole person" tid set — every `candidate_uid` that has ever logged in as
     * one of those accounts. The exclusion injects the *resolved tid set* as a
     * literal, never a subquery: `candidate_uid` is the second column of the
     * table's `ORDER BY (timestamp, candidate_uid)` sort key (migration 010), so
     * a literal `candidate_uid NOT IN (…)` is index-friendly, whereas the old
     * `WHERE user_id IN (…)` subquery scanned unindexed `user_id` on *every* read.
     * Both empty means "exclude nobody".
     */
    private ignoredUserIds: string[] = [];
    private ignoredCandidateUids: string[] = [];

    private constructor(
        private readonly clickhouse: IClickHouseService | undefined,
        private readonly logger: ISystemLogService
    ) {}

    /**
     * Replace the ignore list and resolve its whole-person tid set once. Called
     * by the traffic module at bootstrap and by the admin controller after an
     * add/remove — the *only* moments the list changes — so the expensive
     * `user_id`-keyed scan runs here (once per mutation) instead of inside every
     * dashboard read. Reads then filter against the cached literal tid set,
     * which prunes on the sort key. The tradeoff is bounded staleness: a login as
     * an ignored account between refreshes is not excluded until the next refresh
     * (a re-save of the list, or the next boot) rather than instantly — an
     * accepted cost for collapsing ~18 subquery scans per dashboard load plus the
     * 30s live-counter poll into one scan per list change. On a resolution error
     * the previous tid set is kept (best-effort), matching the "re-syncs on next
     * boot" contract of the controller cache refresh.
     *
     * @param ids - The full set of Better Auth account ids to exclude.
     */
    public async setIgnoredUserIds(ids: string[]): Promise<void> {
        this.ignoredUserIds = ids;
        if (!this.clickhouse || ids.length === 0) {
            this.ignoredCandidateUids = [];
            return;
        }
        // Unwindowed by design — a tid that logged in as an ignored account at
        // ANY point must be excluded, so this resolution cannot be time-bounded.
        // It runs once per list change, not once per read, which is what makes
        // the unindexed user_id scan affordable.
        const sql = `SELECT DISTINCT candidate_uid FROM ${TABLE_NAME} WHERE user_id IN ({ignoredUserIds:Array(String)})`;
        try {
            const rows = await this.clickhouse.query<{ candidate_uid: string }>(sql, { ignoredUserIds: ids });
            this.ignoredCandidateUids = rows.map(r => r.candidate_uid);
        } catch (error) {
            this.logger.warn({ error }, 'Failed to resolve ignored candidate_uids; keeping previous exclusion set');
        }
    }

    /**
     * The always-on "whole person" exclusion for the ignore list. Filters out
     * every row of any resolved ignored tid — including that tid's anonymous,
     * pre-login rows — via a literal `candidate_uid NOT IN (…)` against the
     * cached set (see {@link setIgnoredUserIds} for how it is resolved and why a
     * literal beats the previous per-read subquery). Returns an empty fragment
     * when nobody is ignored (an `IN ()` would be invalid SQL), so the common
     * path adds no cost.
     *
     * @returns The ` AND candidate_uid NOT IN (…)` fragment and its bound param,
     *   ready to append to any `traffic_events` WHERE clause.
     */
    private ignoredUsersExclusion(): { fragment: string; params: Record<string, unknown> } {
        if (this.ignoredCandidateUids.length === 0) {
            return { fragment: '', params: {} };
        }
        return {
            fragment: ' AND candidate_uid NOT IN ({ignoredCandidateUids:Array(String)})',
            params: { ignoredCandidateUids: this.ignoredCandidateUids }
        };
    }

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
                sec_fetch_site,
                cf_ray,
                cf_ipcountry,
                ip_hash,
                subnet_hash,
                channel
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
     * Daily row counts per `bot_class` over the lookback window. Powers the
     * crawler-trend chart: one point per day, each carrying a per-class count
     * map. NULL classes are folded into `'unclassified'` (matching the
     * breakdown panel's NULL bucket) so classifier coverage gaps stay visible.
     *
     * The pivot from `(day, klass, count)` rows into per-day maps happens in
     * JS — keeping the SQL a plain two-dimension GROUP BY mirrors the other
     * aggregate reads and avoids ClickHouse map functions.
     *
     * Returns `[]` when ClickHouse is unavailable or the query fails.
     *
     * @param options - Lookback window (`sinceHours`).
     * @returns One point per day with per-bot-class counts, oldest first.
     */
    async getBotClassTimeSeries(options: ITrafficAggregateOptions = {}): Promise<IBotClassDailyPoint[]> {
        if (!this.clickhouse) {
            return [];
        }

        const sinceHours = options.sinceHours ?? DEFAULT_AGGREGATE_HOURS;

        const sql = `
            SELECT
                toDate(timestamp) AS day,
                coalesce(bot_class, 'unclassified') AS klass,
                count() AS count
            FROM ${TABLE_NAME}
            WHERE timestamp > now() - INTERVAL {sinceHours:UInt32} HOUR
            GROUP BY day, klass
            ORDER BY day ASC
        `;

        try {
            const rows = await this.clickhouse.query<{ day: string; klass: string; count: string | number }>(
                sql,
                { sinceHours }
            );

            const byDay = new Map<string, Record<string, number>>();
            for (const row of rows) {
                const day = String(row.day);
                const counts = byDay.get(day) ?? {};
                counts[row.klass] = Number(row.count);
                byDay.set(day, counts);
            }
            return Array.from(byDay.entries()).map(([day, counts]) => ({ day, counts }));
        } catch (error) {
            this.logger.warn({ error, sinceHours }, 'Failed to read bot_class time series');
            return [];
        }
    }

    /**
     * Top paths hit by one specific `bot_class` over the lookback window.
     * Powers the "which pages do AI crawlers actually fetch" panel.
     *
     * `botClass` is bound as a query parameter — it originates from the
     * request and must never be interpolated. The controller additionally
     * validates it against the known `BotClass` set before calling. NULL
     * rows are folded to `'unclassified'` in the comparison (mirroring
     * `getBotClassTimeSeries`) so the synthetic bucket the trend chart
     * surfaces is drillable here too.
     *
     * Returns `[]` when ClickHouse is unavailable or the query fails.
     *
     * @param botClass - Bot class to filter on (e.g. `'ai_crawler'`).
     * @param options - Lookback window and row limit.
     * @returns Path buckets ordered by hit count, highest first.
     */
    async getPathsByBotClass(
        botClass: string,
        options: ITrafficAggregateOptions = {}
    ): Promise<ITrafficAggregateBucket[]> {
        if (!this.clickhouse) {
            return [];
        }

        const sinceHours = options.sinceHours ?? DEFAULT_AGGREGATE_HOURS;
        const limit = options.limit ?? DEFAULT_AGGREGATE_LIMIT;

        const sql = `
            SELECT
                path AS key,
                count() AS count
            FROM ${TABLE_NAME}
            WHERE timestamp > now() - INTERVAL {sinceHours:UInt32} HOUR
              AND coalesce(bot_class, 'unclassified') = {botClass:String}
              AND path != ''
            GROUP BY key
            ORDER BY count DESC
            LIMIT {limit:UInt32}
        `;

        try {
            const rows = await this.clickhouse.query<{ key: string | null; count: string | number }>(
                sql,
                { sinceHours, limit, botClass }
            );
            return rows.map(r => ({ key: r.key, count: Number(r.count) }));
        } catch (error) {
            this.logger.warn({ error, botClass, sinceHours, limit }, 'Failed to read per-bot-class paths');
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
        // The ignore-list exclusion rides on every read that funnels through
        // rangeParams — the whole analytics/visitors surface — so ignored
        // accounts vanish from all of it in one place. The membership subquery
        // in pageVisitorMembership inherits it too: it reuses this clause, so a
        // tid excluded here cannot re-qualify as a visitor there.
        const excluded = this.ignoredUsersExclusion();
        clause += excluded.fragment;
        Object.assign(params, excluded.params);
        return { clause, params };
    }

    /**
     * Membership WHERE fragment enforcing the canonical Unique Visitor rule:
     * `candidate_uid` must have emitted a `page` event in the window (ran JS).
     * AND this into a read whose scan is restricted to non-`page` rows — the
     * `bootstrap`-only source/landing/campaign/source-details reads — so their
     * visitor counts still drop cookieless bots. Reads that already scan `page`
     * rows express the same rule inline as
     * `uniqExactIf(candidate_uid, event_type = 'page')` and need no membership.
     *
     * The subquery reuses the caller's already-bound window params
     * (`{since}`/`{until}`) and the same bot filter, so with bots excluded a
     * visitor must have a *human* page event. See the canonical-visitor note by
     * {@link SESSION_GAP_SECONDS} and {@link HUMAN_ROWS_FILTER}.
     *
     * @param windowClause - The timestamp window clause from {@link rangeParams}.
     * @param botFilter - The pre-built bot-filter fragment (may be empty).
     * @returns A `candidate_uid IN (…)` fragment (no leading AND).
     */
    private pageVisitorMembership(windowClause: string, botFilter: string): string {
        return `candidate_uid IN (
            SELECT DISTINCT candidate_uid FROM ${TABLE_NAME}
            WHERE ${windowClause}${botFilter} AND event_type = 'page'
        )`;
    }

    /**
     * Build the WHERE fragment, session-start HAVING, and params that scope
     * derived sessions to a window with start-attribution semantics.
     *
     * The scan's lower bound is widened by one session gap so a session
     * already running at the window boundary is seen with its true start —
     * which the HAVING then excludes, attributing the session to the window
     * containing its start (GA4's rule). Without the widening, the same
     * boundary-straddling session would count once in each adjacent KPI
     * window; without the HAVING, the widened rows would leak in.
     *
     * @param range - Inclusive date window.
     * @param botFilter - Pre-built bot-filter fragment (may be empty).
     * @returns WHERE for {@link derivedSessionsSql}, the HAVING fragment,
     *   and the bound params (`sinceWidened` + the normal range params).
     */
    private sessionRangeParams(range: IAnalyticsDateRange, botFilter: string): { where: string; having: string; params: Record<string, unknown> } {
        const { params } = this.rangeParams(range);
        params.sinceWidened = formatClickHouseDateTime64Utc(new Date(range.since.getTime() - SESSION_GAP_SECONDS * 1000));
        let where = 'timestamp >= parseDateTimeBestEffort({sinceWidened:String})';
        if (range.until) {
            where += ' AND timestamp <= parseDateTimeBestEffort({until:String})';
        }
        // Derived sessions build a fresh window instead of reusing rangeParams'
        // clause, so the ignore-list exclusion must be re-applied here — without
        // it session KPIs (count, duration, bounce) keep counting ignored
        // operators even though visitor/pageview counts drop them. The param is
        // already bound in `params` (rangeParams set it); only the fragment needs
        // appending, so no per-read subquery returns.
        const excluded = this.ignoredUsersExclusion();
        // session_start <= until holds automatically — the scan admits no row
        // past the upper bound — so only the lower bound needs the HAVING.
        return { where: `${where}${botFilter}${excluded.fragment}`, having: 'session_start >= parseDateTimeBestEffort({since:String})', params };
    }

    /**
     * Build the derived-session subquery: one row per (visitor, session)
     * with page count and duration, sessionized from the `page` event
     * stream by the {@link SESSION_GAP_SECONDS} inactivity rule.
     *
     * Sessions are derived at read time — never stored — so the definition
     * lives in exactly one place and recomputes over historical rows. A
     * session's duration is last-hit minus first-hit (a single-page session
     * is 0s); a bounce is a single-page session, the standard definition.
     *
     * The window-function `lagInFrame` yields the type default (epoch) for
     * each visitor's first row, which the gap test reads as "new session".
     *
     * @param where - WHERE fragment scoping which rows sessionize (range,
     *   bot filter, cohort). The `event_type = 'page'` restriction is
     *   appended here — only interactive navigations form sessions.
     *   Windowed callers should pass {@link sessionRangeParams}'s widened
     *   fragment so boundary sessions carry their true start.
     * @param havingSessionStart - Optional HAVING fragment on the aggregated
     *   `session_start`, used with the widened scan to attribute each
     *   session to the window containing its start.
     * @returns SELECT statement usable as a FROM subquery.
     */
    private derivedSessionsSql(where: string, havingSessionStart?: string): string {
        return `
            SELECT
                candidate_uid,
                session_seq,
                min(timestamp) AS session_start,
                max(timestamp) AS session_end,
                count() AS page_count,
                dateDiff('second', min(timestamp), max(timestamp)) AS duration_s
            FROM (
                SELECT
                    candidate_uid,
                    timestamp,
                    sum(is_new) OVER (PARTITION BY candidate_uid ORDER BY timestamp ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS session_seq
                FROM (
                    SELECT
                        candidate_uid,
                        timestamp,
                        if(dateDiff('second', lagInFrame(timestamp) OVER (PARTITION BY candidate_uid ORDER BY timestamp ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW), timestamp) >= ${SESSION_GAP_SECONDS}, 1, 0) AS is_new
                    FROM ${TABLE_NAME}
                    WHERE ${where} AND event_type = 'page'
                )
            )
            GROUP BY candidate_uid, session_seq
            ${havingSessionStart ? `HAVING ${havingSessionStart}` : ''}
        `;
    }

    /**
     * Distinct analytics visitors (tids) per calendar day over the window.
     *
     * @param range - Inclusive date window.
     * @param excludeBots - Restrict to human-classified rows (NULL kept).
     * @returns One point per day with the distinct-visitor count, oldest first.
     */
    async getDailyVisitors(range: IAnalyticsDateRange, excludeBots = false): Promise<IDailyVisitorPoint[]> {
        if (!this.clickhouse) return [];
        const { clause, params } = this.rangeParams(range);
        const botFilter = excludeBots ? ` AND ${HUMAN_ROWS_FILTER}` : '';
        const sql = `
            SELECT toDate(timestamp) AS day, uniqExactIf(candidate_uid, event_type = 'page') AS visitors
            FROM ${TABLE_NAME}
            WHERE ${clause}${botFilter}
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
     * Referrer-domain breakdown. Null/empty referers collapse to `'direct'`.
     * Distinct visitors lead; raw event counts ride along.
     *
     * Restricted to `bootstrap` rows so attribution is first-touch only.
     * `page` events carry `document.referrer`, which after the first internal
     * navigation is this site's own domain — without the restriction the site
     * appears as its own referral source, internal navigations inflate the
     * buckets, and one visitor lands in several source rows at once.
     *
     * @param range - Inclusive date window.
     * @param excludeBots - Restrict to human-classified rows (NULL kept).
     * @returns Source-domain buckets, by visitors descending.
     */
    async getTrafficSources(range: IAnalyticsDateRange, excludeBots = false): Promise<ITrafficSourceBucket[]> {
        if (!this.clickhouse) return [];
        const { clause, params } = this.rangeParams(range);
        const botFilter = excludeBots ? ` AND ${HUMAN_ROWS_FILTER}` : '';
        const sql = `
            SELECT
                multiIf(referer IS NULL OR referer = '', 'direct', domain(referer)) AS source,
                uniqExact(candidate_uid) AS visitors,
                count() AS count,
                if(countIf(channel IS NOT NULL) = 0, NULL, arrayReduce('argMax',
                    ['direct', 'organic', 'paid', 'social', 'email', 'ai', 'referral'],
                    [countIf(channel = 'direct'), countIf(channel = 'organic'),
                     countIf(channel = 'paid'), countIf(channel = 'social'),
                     countIf(channel = 'email'), countIf(channel = 'ai'),
                     countIf(channel = 'referral')])) AS storedChannel
            FROM ${TABLE_NAME}
            WHERE ${clause}${botFilter} AND event_type = 'bootstrap' AND ${this.pageVisitorMembership(clause, botFilter)}
            GROUP BY source
            ORDER BY visitors DESC, count DESC
        `;
        // Exact most-frequent channel per source bucket. topK(1) was wrong
        // here: it reserves only N*load_factor = 3 counter cells, so a bucket
        // spanning more than three of the seven channels (google.com split
        // across organic/paid/social/email) can evict and badge an approximate
        // heavy-hitter. topK(1, 7) would reserve enough cells, but the
        // load_factor argument postdates ClickHouse 24.3 (the pinned version)
        // and would throw — silently blanking the panel via the catch below.
        // Instead each of the seven channels is tallied with countIf and the
        // max picked via argMax — exact on every version. The
        // countIf(channel IS NOT NULL) guard returns NULL for an all-NULL
        // (pre-migration-016) bucket so the domain-only fallback below still
        // fires; without it argMax would return 'direct' at weight 0 and
        // suppress the fallback.
        try {
            const rows = await this.clickhouse.query<{
                source: string; visitors: string | number; count: string | number; storedChannel: string | null;
            }>(sql, params);
            return rows.map(r => ({
                source: r.source,
                visitors: Number(r.visitors),
                count: Number(r.count),
                // Prefer the stored write-time classification; fall back to
                // domain-only classification for pre-migration-016 rows. The
                // falsy check (not ??) also covers a non-Nullable '' default
                // should the array-element type ever lose its Nullable wrap.
                channel: r.storedChannel
                    ? (r.storedChannel as TrafficChannel)
                    : classifyChannel({ refererDomain: r.source === 'direct' ? null : r.source })
            }));
        } catch (error) {
            this.logger.warn({ error }, 'Failed to read traffic sources');
            return [];
        }
    }

    /**
     * Top landing paths. Distinct visitors lead; raw event counts ride along.
     *
     * Restricted to `bootstrap` rows so "landing" means the entry page of a
     * first touch. Without the restriction every `page` navigation counts and
     * the table silently becomes "most-viewed pages", not landing pages.
     *
     * @param range - Inclusive date window.
     * @param limit - Max rows.
     * @param excludeBots - Restrict to human-classified rows (NULL kept).
     * @returns Path buckets, by visitors descending.
     */
    async getTopLandingPages(range: IAnalyticsDateRange, limit = 20, excludeBots = false): Promise<ILandingPageBucket[]> {
        if (!this.clickhouse) return [];
        const { clause, params } = this.rangeParams(range);
        const botFilter = excludeBots ? ` AND ${HUMAN_ROWS_FILTER}` : '';
        const sql = `
            SELECT path AS path, uniqExact(candidate_uid) AS visitors, count() AS count
            FROM ${TABLE_NAME}
            WHERE ${clause}${botFilter} AND event_type = 'bootstrap' AND path != '' AND ${this.pageVisitorMembership(clause, botFilter)}
            GROUP BY path
            ORDER BY visitors DESC, count DESC
            LIMIT {limit:UInt32}
        `;
        try {
            const rows = await this.clickhouse.query<{ path: string; visitors: string | number; count: string | number }>(sql, { ...params, limit });
            return rows.map(r => ({ path: r.path, visitors: Number(r.visitors), count: Number(r.count) }));
        } catch (error) {
            this.logger.warn({ error }, 'Failed to read top landing pages');
            return [];
        }
    }

    /**
     * Geographic distribution (ISO-3166 alpha-2). Null country excluded.
     * Distinct visitors lead; raw event counts ride along.
     *
     * Scoped to `page` rows so the panel only surfaces countries that produced
     * a real visitor (a client that ran JavaScript). Without the restriction,
     * grouping runs over `bootstrap` first-touches too — cookieless bots,
     * crawlers, unfurlers, and probes that carry an IP-derived country but
     * never emit a `page` event — so a bot-only country forms a group whose
     * `uniqExactIf(candidate_uid, event_type = 'page')` visitor measure is 0,
     * cluttering the visitor-sorted table with 0-visitor rows. Every `page`
     * row carries a country ({@link buildTrafficEvent} sets it identically for
     * both event types), so the restriction loses no real visitor.
     *
     * @param range - Inclusive date window.
     * @param limit - Max rows.
     * @param excludeBots - Restrict to human-classified rows (NULL kept).
     * @returns Country buckets, by visitors descending.
     */
    async getGeoDistribution(range: IAnalyticsDateRange, limit = 30, excludeBots = false): Promise<IGeoBucket[]> {
        if (!this.clickhouse) return [];
        const { clause, params } = this.rangeParams(range);
        const botFilter = excludeBots ? ` AND ${HUMAN_ROWS_FILTER}` : '';
        const sql = `
            SELECT country, uniqExactIf(candidate_uid, event_type = 'page') AS visitors, count() AS count
            FROM ${TABLE_NAME}
            WHERE ${clause}${botFilter} AND country IS NOT NULL AND event_type = 'page'
            GROUP BY country
            ORDER BY visitors DESC, count DESC
            LIMIT {limit:UInt32}
        `;
        try {
            const rows = await this.clickhouse.query<{ country: string | null; visitors: string | number; count: string | number }>(sql, { ...params, limit });
            return rows.map(r => ({ country: r.country, visitors: Number(r.visitors), count: Number(r.count) }));
        } catch (error) {
            this.logger.warn({ error }, 'Failed to read geo distribution');
            return [];
        }
    }

    /**
     * Device-category breakdown. Distinct visitors lead; raw event counts
     * ride along.
     *
     * Scoped to `page` rows for the same reason as {@link getGeoDistribution}:
     * grouping over `bootstrap` first-touches surfaces device categories that
     * exist only for cookieless bots (which still carry a UA-derived device but
     * never run JavaScript), producing 0-visitor rows in this visitor-sorted
     * panel. Every `page` row carries a device, so the restriction loses no
     * real visitor.
     *
     * @param range - Inclusive date window.
     * @param excludeBots - Restrict to human-classified rows (NULL kept).
     * @returns Device buckets, by visitors descending.
     */
    async getDeviceBreakdown(range: IAnalyticsDateRange, excludeBots = false): Promise<IDeviceBucket[]> {
        if (!this.clickhouse) return [];
        const { clause, params } = this.rangeParams(range);
        const botFilter = excludeBots ? ` AND ${HUMAN_ROWS_FILTER}` : '';
        const sql = `
            SELECT device, uniqExactIf(candidate_uid, event_type = 'page') AS visitors, count() AS count
            FROM ${TABLE_NAME}
            WHERE ${clause}${botFilter} AND event_type = 'page'
            GROUP BY device
            ORDER BY visitors DESC, count DESC
        `;
        try {
            const rows = await this.clickhouse.query<{ device: string; visitors: string | number; count: string | number }>(sql, params);
            return rows.map(r => ({ device: r.device, visitors: Number(r.visitors), count: Number(r.count) }));
        } catch (error) {
            this.logger.warn({ error }, 'Failed to read device breakdown');
            return [];
        }
    }

    /**
     * New-vs-returning visitors per day. Only page-event days count (a visitor
     * is a tid that ran JS), so bootstrap-only bot noise never appears here. A
     * tid is "new" on the day its global first *page* event (across the full
     * table) falls, "returning" otherwise. That full-table first-page day is
     * computed in a subquery and joined to in-window day activity.
     *
     * @param range - Inclusive date window.
     * @param excludeBots - Restrict to human-classified rows (NULL kept).
     * @returns Per-day new/returning split, oldest first.
     */
    async getRetention(range: IAnalyticsDateRange, excludeBots = false): Promise<IRetentionPoint[]> {
        if (!this.clickhouse) return [];
        const { clause, params } = this.rangeParams(range);
        const botFilter = excludeBots ? ` AND ${HUMAN_ROWS_FILTER}` : '';
        const sql = `
            SELECT
                d.day AS day,
                countIf(f.first_day = d.day) AS newVisitors,
                countIf(f.first_day < d.day) AS returningVisitors
            FROM (
                SELECT candidate_uid, toDate(timestamp) AS day
                FROM ${TABLE_NAME}
                WHERE ${clause}${botFilter} AND event_type = 'page'
                GROUP BY candidate_uid, day
            ) AS d
            INNER JOIN (
                SELECT candidate_uid, min(toDate(timestamp)) AS first_day
                FROM ${TABLE_NAME}
                WHERE candidate_uid IN (
                    SELECT DISTINCT candidate_uid
                    FROM ${TABLE_NAME}
                    WHERE ${clause}${botFilter} AND event_type = 'page'
                )${botFilter} AND event_type = 'page'
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
     * `converted` alone conflates a returning account holder logging back in
     * with a genuinely acquired account. The acquisition stage is composed by
     * the controller: {@link getActiveAccountIds} → identity `createdAt`
     * filter → {@link countTidsForUsers}. Account creation dates live in
     * MongoDB, not here — ClickHouse only knows login events.
     *
     * @param range - Inclusive date window.
     * @param excludeBots - Restrict to human-classified rows (NULL kept).
     * @returns Distinct/converted counts and the derived rate.
     */
    async getBinaryConversionFunnel(range: IAnalyticsDateRange, excludeBots = false): Promise<IBinaryConversionFunnel> {
        const empty: IBinaryConversionFunnel = { distinctVisitors: 0, converted: 0, conversionRate: 0 };
        if (!this.clickhouse) return empty;
        const { clause, params } = this.rangeParams(range);
        const botFilter = excludeBots ? ` AND ${HUMAN_ROWS_FILTER}` : '';
        const sql = `
            SELECT
                uniqExactIf(candidate_uid, event_type = 'page') AS distinctVisitors,
                uniqExactIf(candidate_uid, user_id IS NOT NULL AND ${this.pageVisitorMembership(clause, botFilter)}) AS converted
            FROM ${TABLE_NAME}
            WHERE ${clause}${botFilter}
        `;
        try {
            const rows = await this.clickhouse.query<{ distinctVisitors: string | number; converted: string | number }>(sql, params);
            const row = rows[0];
            if (!row) return empty;
            const distinctVisitors = Number(row.distinctVisitors);
            const converted = Number(row.converted);
            return {
                distinctVisitors,
                converted,
                conversionRate: distinctVisitors > 0 ? converted / distinctVisitors : 0
            };
        } catch (error) {
            this.logger.warn({ error }, 'Failed to read conversion funnel');
            return empty;
        }
    }

    /**
     * Distinct Better Auth account ids that appeared logged-in on any row in
     * the window. First leg of the acquisition-stage composition: the
     * controller filters these ids by account `createdAt` (identity module
     * ground truth) and hands the survivors to {@link countTidsForUsers}.
     *
     * @param range - Inclusive date window.
     * @param excludeBots - Restrict to human-classified rows (NULL kept),
     *   mirroring the funnel's `converted` so the composed stage nests.
     * @returns Opaque BA user-id hex strings, empty when ClickHouse is off.
     */
    async getActiveAccountIds(range: IAnalyticsDateRange, excludeBots = false): Promise<string[]> {
        if (!this.clickhouse) return [];
        const { clause, params } = this.rangeParams(range);
        const botFilter = excludeBots ? ` AND ${HUMAN_ROWS_FILTER}` : '';
        const sql = `
            SELECT DISTINCT user_id
            FROM ${TABLE_NAME}
            WHERE ${clause}${botFilter} AND user_id IS NOT NULL AND ${this.pageVisitorMembership(clause, botFilter)}
        `;
        try {
            const rows = await this.clickhouse.query<{ user_id: string }>(sql, params);
            return rows.map(r => r.user_id);
        } catch (error) {
            this.logger.warn({ error }, 'Failed to read active account ids');
            return [];
        }
    }

    /**
     * Distinct visitors (tids) in the window attributed to any of the given
     * accounts. One query across the whole id set so a tid shared by two
     * accounts is not double-counted — summing per-account uniques would be.
     *
     * @param range - Inclusive date window.
     * @param userIds - Opaque BA user-id hex strings (typically the
     *   created-in-window survivors of {@link getActiveAccountIds}).
     * @param excludeBots - Restrict to human-classified rows (NULL kept).
     * @returns Distinct tid count; 0 for an empty id set or no ClickHouse.
     */
    async countTidsForUsers(range: IAnalyticsDateRange, userIds: string[], excludeBots = false): Promise<number> {
        if (!this.clickhouse || userIds.length === 0) return 0;
        const { clause, params } = this.rangeParams(range);
        const botFilter = excludeBots ? ` AND ${HUMAN_ROWS_FILTER}` : '';
        const sql = `
            SELECT uniqExactIf(candidate_uid, event_type = 'page') AS tids
            FROM ${TABLE_NAME}
            WHERE ${clause}${botFilter} AND user_id IN ({userIds:Array(String)})
        `;
        try {
            const rows = await this.clickhouse.query<{ tids: string | number }>(sql, { ...params, userIds });
            return Number(rows[0]?.tids ?? 0);
        } catch (error) {
            this.logger.warn({ error }, 'Failed to count tids for users');
            return 0;
        }
    }

    /**
     * UTM-campaign performance joined to the binary conversion.
     *
     * First-touch attributed, matching the Metrics Contract and the sources /
     * landing-pages reads: a campaign's visitors are the tids whose
     * `bootstrap` row carried it. Conversion still reads the cohort's full
     * in-window clickstream (the login usually happens on a later `page`
     * row, never on the first touch), via the IN-subquery of logged-in tids.
     *
     * @param range - Inclusive date window.
     * @param limit - Max campaigns.
     * @param excludeBots - Restrict to human-classified rows (NULL kept).
     * @returns Per-campaign visitors, conversions, and rate, by visitors desc.
     */
    async getCampaignPerformance(range: IAnalyticsDateRange, limit = 20, excludeBots = false): Promise<ICampaignPerformanceBucket[]> {
        if (!this.clickhouse) return [];
        const { clause, params } = this.rangeParams(range);
        const botFilter = excludeBots ? ` AND ${HUMAN_ROWS_FILTER}` : '';
        const sql = `
            SELECT
                coalesce(utm_campaign, '(none)') AS campaign,
                coalesce(utm_source, '(none)') AS source,
                coalesce(utm_medium, '(none)') AS medium,
                uniqExact(candidate_uid) AS visitors,
                uniqExactIf(candidate_uid, candidate_uid IN (
                    SELECT DISTINCT candidate_uid FROM ${TABLE_NAME}
                    WHERE ${clause}${botFilter} AND user_id IS NOT NULL
                )) AS conversions
            FROM ${TABLE_NAME}
            WHERE ${clause}${botFilter} AND event_type = 'bootstrap' AND utm_campaign IS NOT NULL AND ${this.pageVisitorMembership(clause, botFilter)}
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
     * Engagement metrics over derived sessions (see
     * {@link derivedSessionsSql}): session count, average session duration,
     * pages per session, and bounce rate (single-page sessions / sessions).
     *
     * @param range - Inclusive date window.
     * @param excludeBots - Restrict to human-classified rows (NULL kept).
     * @returns Aggregate engagement metrics.
     */
    async getEngagementMetrics(range: IAnalyticsDateRange, excludeBots = false): Promise<IEngagementMetrics> {
        const empty: IEngagementMetrics = { sessions: 0, avgDurationMs: 0, pagesPerSession: 0, bounceRate: 0 };
        if (!this.clickhouse) return empty;
        const botFilter = excludeBots ? ` AND ${HUMAN_ROWS_FILTER}` : '';
        const { where, having, params } = this.sessionRangeParams(range, botFilter);
        const sql = `
            SELECT
                count() AS sessions,
                sum(page_count) AS pageEvents,
                avg(duration_s) AS avgDurationS,
                countIf(page_count = 1) AS bounces
            FROM (${this.derivedSessionsSql(where, having)})
        `;
        try {
            const rows = await this.clickhouse.query<{
                sessions: string | number; pageEvents: string | number;
                avgDurationS: string | number | null; bounces: string | number;
            }>(sql, params);
            const row = rows[0];
            if (!row) return empty;
            const sessions = Number(row.sessions);
            const pageEvents = Number(row.pageEvents);
            const bounces = Number(row.bounces);
            return {
                sessions,
                avgDurationMs: Math.round(Number(row.avgDurationS ?? 0) * 1000),
                pagesPerSession: sessions > 0 ? pageEvents / sessions : 0,
                bounceRate: sessions > 0 ? bounces / sessions : 0
            };
        } catch (error) {
            this.logger.warn({ error }, 'Failed to read engagement metrics');
            return empty;
        }
    }

    /**
     * The unified dashboard headline: KPIs for the window and the
     * equal-length window before it (for period-over-period deltas), plus a
     * zero-filled visitors/pageviews time series.
     *
     * Buckets are hourly when the window is ≤ 48 hours — a "24 Hours" view
     * bucketed by day is one bar and carries no information — and daily
     * otherwise. Days/hours with no rows are emitted as explicit zeros so
     * gaps read as "no traffic", not as missing chart segments.
     *
     * @param range - Inclusive date window.
     * @param excludeBots - Restrict to human-classified rows (NULL kept).
     * @returns Granularity, current/previous KPIs, and the bucket series.
     */
    async getOverviewTrend(range: IAnalyticsDateRange, excludeBots = false): Promise<IOverviewTrend> {
        const emptyKpis = (): IOverviewKpis => ({ visitors: 0, humanVisitors: 0, botVisitors: 0, pageviews: 0, sessions: 0, avgDurationMs: 0, bounceRate: 0 });
        if (!this.clickhouse) {
            return { granularity: 'day', current: emptyKpis(), previous: emptyKpis(), series: [] };
        }

        const HOUR_MS = 60 * 60 * 1000;
        const DAY_MS = 24 * HOUR_MS;
        const until = range.until ?? new Date();
        // Guard against degenerate/inverted ranges so the previous window
        // and the zero-fill loop stay finite.
        const windowMs = Math.max(until.getTime() - range.since.getTime(), HOUR_MS);
        const granularity: 'hour' | 'day' = windowMs <= 48 * HOUR_MS ? 'hour' : 'day';

        const currentRange: IAnalyticsDateRange = { since: range.since, until };
        const previousRange: IAnalyticsDateRange = {
            since: new Date(range.since.getTime() - windowMs),
            until: range.since
        };

        const botFilter = excludeBots ? ` AND ${HUMAN_ROWS_FILTER}` : '';

        /**
         * Build and run the KPI aggregate for one window. Session-derived
         * KPIs (sessions, duration, bounce rate) come from the derived
         * session model — bounce = single-page session.
         *
         * @param r - The window to aggregate.
         * @returns The window's headline KPIs.
         */
        const fetchKpis = async (r: IAnalyticsDateRange): Promise<IOverviewKpis> => {
            const { clause, params } = this.rangeParams(r);
            // The human/bot split rides along regardless of the bot filter:
            // with bots excluded the split is trivially (visitors, 0), and
            // with bots included the UI renders the split so the headline
            // "visitors" number cannot be mistaken for a people count.
            const sql = `
                SELECT
                    uniqExactIf(candidate_uid, event_type = 'page') AS visitors,
                    uniqExactIf(candidate_uid, event_type = 'page' AND ${HUMAN_ROWS_FILTER}) AS humanVisitors,
                    uniqExactIf(candidate_uid, event_type = 'page' AND bot_class IS NOT NULL AND bot_class != 'human') AS botVisitors,
                    countIf(event_type = 'page') AS pageviews
                FROM ${TABLE_NAME}
                WHERE ${clause}${botFilter}
            `;
            const sessionWindow = this.sessionRangeParams(r, botFilter);
            const sessionsSql = `
                SELECT
                    count() AS sessions,
                    avg(duration_s) AS avgDurationS,
                    countIf(page_count = 1) AS bounces
                FROM (${this.derivedSessionsSql(sessionWindow.where, sessionWindow.having)})
            `;
            const [rows, sessionRows] = await Promise.all([
                this.clickhouse!.query<{
                    visitors: string | number; humanVisitors: string | number;
                    botVisitors: string | number; pageviews: string | number;
                }>(sql, params),
                this.clickhouse!.query<{
                    sessions: string | number; avgDurationS: string | number | null; bounces: string | number;
                }>(sessionsSql, sessionWindow.params)
            ]);
            const row = rows[0];
            if (!row) return emptyKpis();
            const sessionRow = sessionRows[0];
            const sessions = Number(sessionRow?.sessions ?? 0);
            const bounces = Number(sessionRow?.bounces ?? 0);
            return {
                visitors: Number(row.visitors),
                humanVisitors: Number(row.humanVisitors),
                botVisitors: Number(row.botVisitors),
                pageviews: Number(row.pageviews),
                sessions,
                avgDurationMs: Math.round(Number(sessionRow?.avgDurationS ?? 0) * 1000),
                bounceRate: sessions > 0 ? bounces / sessions : 0
            };
        };

        const bucketExpr = granularity === 'hour' ? 'toStartOfHour(timestamp)' : 'toDate(timestamp)';
        const { clause, params } = this.rangeParams(currentRange);
        const seriesSql = `
            SELECT
                ${bucketExpr} AS bucket,
                uniqExact(candidate_uid) AS visitors,
                count() AS pageviews
            FROM ${TABLE_NAME}
            WHERE ${clause}${botFilter} AND event_type = 'page'
            GROUP BY bucket
            ORDER BY bucket ASC
        `;
        // Top 3 paths per bucket for the tooltip. `LIMIT 3 BY bucket` keeps the
        // three highest-hit paths of each bucket server-side, so the payload is
        // bounded (3 × bucket count) regardless of how many distinct URLs a
        // bucket saw — no client-side trimming of an unbounded path list.
        const pathsSql = `
            SELECT ${bucketExpr} AS bucket, path, count() AS hits
            FROM ${TABLE_NAME}
            WHERE ${clause}${botFilter} AND event_type = 'page'
            GROUP BY bucket, path
            ORDER BY bucket ASC, hits DESC, path ASC
            LIMIT 3 BY bucket
        `;
        // Top 3 countries per bucket for the tooltip, measured as DISTINCT
        // VISITORS (`uniqExact(candidate_uid)`) — a country is an attribute of the
        // visitor, so a single person refreshing a page must not inflate their
        // country's count. This matches the module's primary-measure convention
        // (visitors, not raw hits) used by the Geo panel and every other
        // dashboard read; only "Most viewed" (topPaths) stays a page-view count,
        // because a view is the thing being counted there. Scoped to `page` rows
        // so bot-only bootstrap countries never surface; NULL country is dropped
        // so a hover lists only nameable origins. `LIMIT 3 BY bucket` bounds the
        // payload to 3 × bucket count.
        const countriesSql = `
            SELECT ${bucketExpr} AS bucket, country, uniqExact(candidate_uid) AS visitors
            FROM ${TABLE_NAME}
            WHERE ${clause}${botFilter} AND event_type = 'page' AND country IS NOT NULL
            GROUP BY bucket, country
            ORDER BY bucket ASC, visitors DESC, country ASC
            LIMIT 3 BY bucket
        `;
        // Top 3 sources per bucket, measured as DISTINCT VISITORS by first-touch
        // origin — "where did this bucket's visitors come from?", not "how many
        // page views arrived from each origin". A source is a property of the
        // visitor (their first touch), so one person browsing several pages counts
        // once for their origin, matching topCountries and the module's
        // visitor-primary convention. Source lives only on the first-touch
        // `bootstrap` row (a `page` row's referrer is the site's own domain), so
        // each bucket's page-viewing visitor is LEFT-joined to their earliest
        // bootstrap source — `argMin(domain, timestamp)`, matching
        // getTrafficSources' `domain(referer)`/`direct` derivation. The join is
        // LEFT (not INNER) so a visitor whose tid has no retained bootstrap row
        // still counts: the middleware bootstrap is best-effort and swallows
        // failures, so outages/deploys and pre-feature tids leave page-only tids
        // permanently. Those unmatched visitors bucket to '(unattributed)' — a
        // distinct sentinel, never folded into 'direct' (which means "no
        // referrer", not "no record"). `candidate_uid` is carried out of the page
        // subquery so the outer `uniqExact` can dedupe a visitor's many page rows
        // to one per source. Under this codebase's join_use_nulls=0 an unmatched
        // source fills as '' (not NULL); if that ever flips, the guard must also
        // test IS NULL. `LIMIT 3 BY bucket` bounds the payload.
        const sourcesSql = `
            SELECT bucket, source, uniqExact(candidate_uid) AS visitors
            FROM (
                SELECT
                    pv.bucket AS bucket,
                    pv.candidate_uid AS candidate_uid,
                    if(src.source = '', '(unattributed)', src.source) AS source
                FROM (
                    SELECT ${bucketExpr} AS bucket, candidate_uid
                    FROM ${TABLE_NAME}
                    WHERE ${clause}${botFilter} AND event_type = 'page'
                ) AS pv
                LEFT JOIN (
                    SELECT candidate_uid,
                        argMin(multiIf(referer IS NULL OR referer = '', 'direct', domain(referer)), timestamp) AS source
                    FROM ${TABLE_NAME}
                    WHERE event_type = 'bootstrap' AND ${this.pageVisitorMembership(clause, botFilter)}
                    GROUP BY candidate_uid
                ) AS src USING (candidate_uid)
            )
            GROUP BY bucket, source
            ORDER BY bucket ASC, visitors DESC, source ASC
            LIMIT 3 BY bucket
        `;

        try {
            const [current, previous, seriesRows, pathRows, countryRows, sourceRows] = await Promise.all([
                fetchKpis(currentRange),
                fetchKpis(previousRange),
                this.clickhouse.query<{ bucket: string; visitors: string | number; pageviews: string | number }>(seriesSql, params),
                this.clickhouse.query<{ bucket: string; path: string; hits: string | number }>(pathsSql, params),
                this.clickhouse.query<{ bucket: string; country: string; visitors: string | number }>(countriesSql, params),
                this.clickhouse.query<{ bucket: string; source: string; visitors: string | number }>(sourcesSql, params)
            ]);

            // Zero-fill every bucket in the window, then overlay the rows.
            const stepMs = granularity === 'hour' ? HOUR_MS : DAY_MS;
            const since = range.since;
            const floorUtc = granularity === 'hour'
                ? Date.UTC(since.getUTCFullYear(), since.getUTCMonth(), since.getUTCDate(), since.getUTCHours())
                : Date.UTC(since.getUTCFullYear(), since.getUTCMonth(), since.getUTCDate());
            const keyFor = (ms: number): string => granularity === 'hour'
                ? new Date(ms).toISOString()
                : new Date(ms).toISOString().split('T')[0];

            const buckets = new Map<string, IOverviewTrendPoint>();
            for (let ms = floorUtc; ms <= until.getTime(); ms += stepMs) {
                const key = keyFor(ms);
                buckets.set(key, { bucket: key, visitors: 0, pageviews: 0, topPaths: [], topCountries: [], topSources: [] });
            }
            for (const row of seriesRows) {
                const key = granularity === 'hour'
                    ? clickHouseDateToIso(String(row.bucket))
                    : String(row.bucket);
                const point = buckets.get(key);
                if (point) {
                    point.visitors = Number(row.visitors);
                    point.pageviews = Number(row.pageviews);
                }
            }
            // Overlay the per-bucket top paths. Rows arrive pre-sorted
            // (hits desc) and appending preserves that order, so each point's
            // topPaths stays ranked.
            for (const row of pathRows) {
                const key = granularity === 'hour'
                    ? clickHouseDateToIso(String(row.bucket))
                    : String(row.bucket);
                const point = buckets.get(key);
                if (point) {
                    point.topPaths.push({ path: String(row.path), hits: Number(row.hits) });
                }
            }
            // Overlay the per-bucket top countries — same ordering guarantee as
            // paths (rows arrive visitors-desc, appending preserves rank).
            for (const row of countryRows) {
                const key = granularity === 'hour'
                    ? clickHouseDateToIso(String(row.bucket))
                    : String(row.bucket);
                const point = buckets.get(key);
                if (point) {
                    point.topCountries.push({ country: String(row.country), visitors: Number(row.visitors) });
                }
            }
            // Overlay the per-bucket top sources — same ordering guarantee.
            for (const row of sourceRows) {
                const key = granularity === 'hour'
                    ? clickHouseDateToIso(String(row.bucket))
                    : String(row.bucket);
                const point = buckets.get(key);
                if (point) {
                    point.topSources.push({ source: String(row.source), visitors: Number(row.visitors) });
                }
            }

            return { granularity, current, previous, series: Array.from(buckets.values()) };
        } catch (error) {
            this.logger.warn({ error }, 'Failed to read overview trend');
            return { granularity, current: emptyKpis(), previous: emptyKpis(), series: [] };
        }
    }

    /**
     * Distinct visitors active in the last five minutes — the "online now"
     * counter every analytics platform headlines.
     *
     * @param excludeBots - Restrict to human-classified rows (NULL kept).
     * @returns The live visitor count (0 when ClickHouse is unavailable).
     */
    async getLiveVisitorCount(excludeBots = false): Promise<number> {
        if (!this.clickhouse) return 0;
        const botFilter = excludeBots ? ` AND ${HUMAN_ROWS_FILTER}` : '';
        // "Online now" builds its own 5-minute window rather than going through
        // rangeParams, so apply the ignore-list exclusion directly — otherwise
        // an ignored operator refreshing the dashboard shows up in the counter.
        const excluded = this.ignoredUsersExclusion();
        const sql = `
            SELECT uniqExactIf(candidate_uid, event_type = 'page') AS visitors
            FROM ${TABLE_NAME}
            WHERE timestamp > now() - INTERVAL 5 MINUTE${botFilter}${excluded.fragment}
        `;
        try {
            const rows = await this.clickhouse.query<{ visitors: string | number }>(sql, { ...excluded.params });
            return Number(rows[0]?.visitors ?? 0);
        } catch (error) {
            this.logger.warn({ error }, 'Failed to read live visitor count');
            return 0;
        }
    }

    /**
     * Source networks (salted /24 or /48 hashes) whose in-window request volume
     * exceeds {@link HIGH_VOLUME_SUBNET_MIN_REQUESTS}. Surfaced to the operator
     * as an annotation on the Visitors tab — a "this network looks automated"
     * hint the admin can act on — never used to drop visitors, because busy
     * shared egress points (offices, VPNs, carriers) legitimately concentrate
     * many real people. Not bot-filtered: the flag is about raw source volume,
     * independent of any `bot_class` guess.
     *
     * @param range - Inclusive date window.
     * @param limit - Max networks to return, highest volume first.
     * @returns Flagged networks with request / visitor / page-visitor counts.
     */
    async getHighVolumeSubnets(range: IAnalyticsDateRange, limit = 20): Promise<IHighVolumeSubnet[]> {
        if (!this.clickhouse) return [];
        const { clause, params } = this.rangeParams(range);
        const sql = `
            SELECT
                subnet_hash AS subnetHash,
                count() AS requests,
                uniqExact(candidate_uid) AS visitors,
                uniqExactIf(candidate_uid, event_type = 'page') AS pageVisitors
            FROM ${TABLE_NAME}
            WHERE ${clause} AND subnet_hash IS NOT NULL
            GROUP BY subnet_hash
            HAVING requests >= ${HIGH_VOLUME_SUBNET_MIN_REQUESTS}
            ORDER BY requests DESC
            LIMIT {limit:UInt32}
        `;
        try {
            const rows = await this.clickhouse.query<{
                subnetHash: string; requests: string | number;
                visitors: string | number; pageVisitors: string | number;
            }>(sql, { ...params, limit });
            return rows.map(r => ({
                subnetHash: r.subnetHash,
                requests: Number(r.requests),
                visitors: Number(r.visitors),
                pageVisitors: Number(r.pageVisitors)
            }));
        } catch (error) {
            this.logger.warn({ error }, 'Failed to read high-volume subnets');
            return [];
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
     * A tid only qualifies once it has emitted a `page` event *inside the
     * window* (the canonical Unique Visitor rule — see the note by
     * {@link SESSION_GAP_SECONDS}); the `HAVING countIf(event_type = 'page' AND
     * <window>) > 0` guard enforces it on both the page and count queries. The
     * window predicate matters for custom past-dated ranges: the outer scan is
     * full-history (so `argMin` sees each tid's earliest event), so an unscoped
     * page count would wrongly qualify a tid whose bootstrap is in-window but
     * whose only page beacon arrives after the range end. First-touch
     * attribution (referrer/landing/country) still reads each tid's earliest
     * event, which is its `bootstrap` row.
     *
     * With `excludeBots`, both the participating-tid set and the grouped rows
     * are restricted to human-classified rows, so crawlers spoofing referrers
     * neither appear as visitors nor contribute attribution.
     *
     * @param range - Inclusive date window.
     * @param limit - Page size.
     * @param skip - Pagination offset.
     * @param excludeBots - Restrict to human-classified rows (NULL kept).
     * @returns A page of new-visitor origins plus the unpaginated total.
     */
    async getNewVisitors(range: IAnalyticsDateRange, limit = 50, skip = 0, excludeBots = false): Promise<INewVisitorsPage> {
        if (!this.clickhouse) return { visitors: [], total: 0 };
        const { clause, params } = this.rangeParams(range);
        const botFilter = excludeBots ? ` AND ${HUMAN_ROWS_FILTER}` : '';
        let firstSeenClause = 'firstSeen >= parseDateTimeBestEffort({since:String})';
        if (range.until) {
            firstSeenClause += ' AND firstSeen <= parseDateTimeBestEffort({until:String})';
        }
        const activeInWindow = `candidate_uid IN (SELECT DISTINCT candidate_uid FROM ${TABLE_NAME} WHERE ${clause}${botFilter})`;
        const sessionWindow = this.sessionRangeParams(range, botFilter);
        // In-window derived-session count per tid (see derivedSessionsSql,
        // start-attributed via sessionRangeParams). The join's right side is
        // time-bounded by the window clause rather than keyed off the paged
        // rows: ClickHouse does not push join-key predicates into a joined
        // subquery (it materializes the right side in full), so bounding by
        // time is what actually caps the scan. For this view the semantics
        // match — every listed visitor was first seen inside the window, so
        // their sessions are in-window anyway.
        const pageSql = `
            SELECT base.*, s.sessionsCount AS sessionsCount
            FROM (
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
                    argMin(tuple(subnet_hash), timestamp).1 AS subnetHash, -- tuple() preserves a NULL first-touch value; plain argMin skips NULL args
                    countIf(event_type = 'page') AS pageViews -- views are page events only: a bootstrap row is the same navigation as the first page beacon, so count() would add a phantom view per visit-start
                FROM ${TABLE_NAME}
                WHERE ${activeInWindow}${botFilter}
                GROUP BY candidate_uid
                HAVING ${firstSeenClause} AND countIf(event_type = 'page' AND ${clause}) > 0
                ORDER BY firstSeen DESC
                LIMIT {limit:UInt32} OFFSET {skip:UInt32}
            ) AS base
            LEFT JOIN (
                SELECT candidate_uid AS userId, count() AS sessionsCount
                FROM (${this.derivedSessionsSql(sessionWindow.where, sessionWindow.having)})
                GROUP BY candidate_uid
            ) AS s USING (userId)
            ORDER BY firstSeen DESC
        `;
        const countSql = `
            SELECT count() AS total FROM (
                SELECT candidate_uid, min(timestamp) AS firstSeen
                FROM ${TABLE_NAME}
                WHERE ${activeInWindow}${botFilter}
                GROUP BY candidate_uid
                HAVING ${firstSeenClause} AND countIf(event_type = 'page' AND ${clause}) > 0
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
                    subnetHash: string | null;
                    pageViews: string | number; sessionsCount: string | number;
                }>(pageSql, { ...params, ...sessionWindow.params, limit, skip }),
                this.clickhouse.query<{ total: string | number }>(countSql, params)
            ]);
            const visitors: INewVisitorOrigin[] = rows.map(r => {
                const hasUtm = Boolean(r.utmSource || r.utmMedium || r.utmCampaign || r.utmTerm || r.utmContent);
                return {
                    userId: r.userId,
                    firstSeen: clickHouseDateToIso(String(r.firstSeen)),
                    lastSeen: clickHouseDateToIso(String(r.lastSeen)),
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
                    pageViews: Number(r.pageViews),
                    subnetHash: r.subnetHash ?? null
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
     * The cohort is first-touch attributed: visitors whose `bootstrap` row's
     * referrer matches the source. Attribution sections (landing pages,
     * countries, devices, UTM) read the cohort's bootstrap rows; engagement
     * and conversion read the cohort's full in-window clickstream. Matching
     * mirrors {@link getTrafficSources}, so a value returned there round-trips
     * here. Percentages are each row's share of the cohort's first touches.
     *
     * @param range - Inclusive date window.
     * @param source - Referrer domain (e.g. `'duckduckgo.com'`) or `'direct'`.
     * @param excludeBots - Restrict to human-classified rows (NULL kept).
     * @returns The source breakdown, or an empty shell when the source has no
     *          events in the window.
     */
    async getTrafficSourceDetails(range: IAnalyticsDateRange, source: string, excludeBots = false): Promise<ITrafficSourceDetailsResult> {
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
        const botFilter = excludeBots ? ` AND ${HUMAN_ROWS_FILTER}` : '';
        const sourceExpr = `multiIf(referer IS NULL OR referer = '', 'direct', domain(referer))`;
        // First-touch rows for this source — the attribution ground truth.
        const firstTouchWhere = `${clause}${botFilter} AND event_type = 'bootstrap' AND ${sourceExpr} = {source:String} AND ${this.pageVisitorMembership(clause, botFilter)}`;
        // The cohort's full in-window clickstream (all event types) — the
        // engagement/conversion ground truth.
        const where = `${clause}${botFilter} AND candidate_uid IN (
            SELECT DISTINCT candidate_uid FROM ${TABLE_NAME} WHERE ${firstTouchWhere}
        )`;
        // Session scan: same cohort restriction, but time-widened by one gap
        // with start-attribution (see sessionRangeParams) so boundary
        // sessions land in exactly one window, matching the overview KPIs.
        const sessionWindow = this.sessionRangeParams(range, botFilter);
        const sessionsWhere = `${sessionWindow.where} AND candidate_uid IN (
            SELECT DISTINCT candidate_uid FROM ${TABLE_NAME} WHERE ${firstTouchWhere}
        )`;
        const p = { ...params, ...sessionWindow.params, source };
        const round1 = (n: number): number => Math.round(n * 10) / 10;
        try {
            const [summaryRows, sessionRows] = await Promise.all([
                this.clickhouse.query<{
                    visitors: string | number; pageEvents: string | number;
                    firstTouches: string | number; converted: string | number;
                }>(`
                    SELECT
                        uniqExact(candidate_uid) AS visitors,
                        countIf(event_type = 'page') AS pageEvents,
                        countIf(event_type = 'bootstrap') AS firstTouches,
                        uniqExactIf(candidate_uid, user_id IS NOT NULL) AS converted
                    FROM ${TABLE_NAME}
                    WHERE ${where}
                `, p),
                // Derived sessions over the cohort's clickstream — bounce and
                // duration semantics identical to the overview KPIs.
                this.clickhouse.query<{
                    sessions: string | number; avgDurationS: string | number | null;
                }>(`
                    SELECT count() AS sessions, avg(duration_s) AS avgDurationS
                    FROM (${this.derivedSessionsSql(sessionsWhere, sessionWindow.having)})
                `, p)
            ]);
            const summary = summaryRows[0];
            const visitors = summary ? Number(summary.visitors) : 0;
            if (!visitors) return empty;
            const pageEvents = Number(summary.pageEvents);
            const firstTouches = Number(summary.firstTouches);
            const sessions = Number(sessionRows[0]?.sessions ?? 0);
            const avgDurationS = Number(sessionRows[0]?.avgDurationS ?? 0);
            const converted = Number(summary.converted);
            const pct = (count: number): number => (firstTouches > 0 ? round1((count / firstTouches) * 100) : 0);

            const [landingRows, countryRows, deviceRows, utmRows] = await Promise.all([
                this.clickhouse.query<{ path: string; count: string | number }>(`
                    SELECT path, count() AS count FROM ${TABLE_NAME} WHERE ${firstTouchWhere}
                    GROUP BY path ORDER BY count DESC LIMIT 10
                `, p),
                this.clickhouse.query<{ country: string; count: string | number }>(`
                    SELECT country, count() AS count FROM ${TABLE_NAME} WHERE ${firstTouchWhere} AND country IS NOT NULL
                    GROUP BY country ORDER BY count DESC LIMIT 30
                `, p),
                this.clickhouse.query<{ device: string; count: string | number }>(`
                    SELECT device, count() AS count FROM ${TABLE_NAME} WHERE ${firstTouchWhere}
                    GROUP BY device ORDER BY count DESC
                `, p),
                this.clickhouse.query<{ source: string | null; medium: string | null; campaign: string; count: string | number }>(`
                    SELECT
                        utm_source AS source, utm_medium AS medium, utm_campaign AS campaign,
                        count() AS count
                    FROM ${TABLE_NAME} WHERE ${firstTouchWhere} AND utm_campaign IS NOT NULL
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
                    avgPageViews: round1(pageEvents / visitors),
                    avgDuration: Math.round(avgDurationS)
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

    /**
     * Per-subject `page`-event clickstream summary over the window, newest
     * activity first. The subject is the analytics tid (`candidate_uid`) for
     * anonymous browsing or the Better Auth `user_id` for registered browsing;
     * the two reads are the same shape so the dashboard renders them through one
     * table component. Only `page` events count — `bootstrap` first-touch rows
     * (which include bots) are deliberately excluded so this surface reflects
     * real interactive navigation, not scanner noise.
     *
     * @param subject - `'tid'` groups anonymous page hits by `candidate_uid`
     *   (rows where `user_id IS NULL`); `'user'` groups by `user_id`
     *   (`user_id IS NOT NULL`).
     * @param range - Inclusive date window.
     * @param limit - Page size.
     * @param skip - Pagination offset.
     * @returns A page of activity rows plus the unpaginated subject total.
     */
    async getPageActivity(subject: PageHitSubject, range: IAnalyticsDateRange, limit = 50, skip = 0): Promise<IPageActivityPage> {
        if (!this.clickhouse) return { rows: [], total: 0 };
        const { clause, params } = this.rangeParams(range);
        // `subject` is a closed union, never user input, so interpolating the
        // grouping column and its NULL predicate is injection-safe.
        const idColumn = subject === 'tid' ? 'candidate_uid' : 'user_id';
        const subjectFilter = subject === 'tid' ? 'user_id IS NULL' : 'user_id IS NOT NULL';
        const where = `${clause} AND event_type = 'page' AND ${subjectFilter}`;
        const rowsSql = `
            SELECT
                ${idColumn} AS id,
                min(timestamp) AS firstSeen,
                max(timestamp) AS lastSeen,
                count() AS pageViews,
                uniqExact(path) AS distinctPaths,
                argMin(path, timestamp) AS firstPath,
                argMax(path, timestamp) AS lastPath,
                argMax(country, timestamp) AS country,
                argMax(device, timestamp) AS device
            FROM ${TABLE_NAME}
            WHERE ${where}
            GROUP BY ${idColumn}
            ORDER BY lastSeen DESC
            LIMIT {limit:UInt32} OFFSET {skip:UInt32}
        `;
        const countSql = `
            SELECT uniqExact(${idColumn}) AS total
            FROM ${TABLE_NAME}
            WHERE ${where}
        `;
        try {
            const [rows, countRows] = await Promise.all([
                this.clickhouse.query<{
                    id: string; firstSeen: string; lastSeen: string;
                    pageViews: string | number; distinctPaths: string | number;
                    firstPath: string | null; lastPath: string | null;
                    country: string | null; device: string;
                }>(rowsSql, { ...params, limit, skip }),
                this.clickhouse.query<{ total: string | number }>(countSql, params)
            ]);
            return {
                rows: rows.map(r => ({
                    id: r.id,
                    firstSeen: clickHouseDateToIso(String(r.firstSeen)),
                    lastSeen: clickHouseDateToIso(String(r.lastSeen)),
                    pageViews: Number(r.pageViews),
                    distinctPaths: Number(r.distinctPaths),
                    firstPath: r.firstPath ?? null,
                    lastPath: r.lastPath ?? null,
                    country: r.country ?? null,
                    device: r.device
                })),
                total: Number(countRows[0]?.total ?? 0)
            };
        } catch (error) {
            this.logger.warn({ error, subject }, 'Failed to read page activity');
            return { rows: [], total: 0 };
        }
    }

    /**
     * The ordered `page`-event clickstream for a single subject — literally
     * every page the tid or account hit in the window, newest first. Backs the
     * drill-down an operator opens from a {@link IPageActivityRow}.
     *
     * @param subject - `'tid'` matches `candidate_uid` (a UUID); `'user'`
     *   matches `user_id` (an opaque Better Auth id string).
     * @param id - The subject key. For `'tid'` it must be a UUID; a malformed
     *   value yields `[]` rather than a ClickHouse type error.
     * @param range - Inclusive date window.
     * @param limit - Max page hits to return.
     * @returns The subject's page hits, newest first.
     */
    async getPageHits(subject: PageHitSubject, id: string, range: IAnalyticsDateRange, limit = 200): Promise<IPageHit[]> {
        if (!this.clickhouse) return [];
        if (subject === 'tid' && !UUID_V4_REGEX.test(id)) return [];
        const { clause, params } = this.rangeParams(range);
        const subjectExpr = subject === 'tid' ? 'candidate_uid = {id:UUID}' : 'user_id = {id:String}';
        const sql = `
            SELECT timestamp, path, referer, device, country
            FROM ${TABLE_NAME}
            WHERE ${clause} AND event_type = 'page' AND ${subjectExpr}
            ORDER BY timestamp DESC
            LIMIT {limit:UInt32}
        `;
        try {
            const rows = await this.clickhouse.query<{
                timestamp: string; path: string; referer: string | null;
                device: string; country: string | null;
            }>(sql, { ...params, id, limit });
            return rows.map(r => ({
                timestamp: clickHouseDateToIso(String(r.timestamp)),
                path: r.path,
                referer: r.referer ?? null,
                device: r.device,
                country: r.country ?? null
            }));
        } catch (error) {
            this.logger.warn({ error, subject }, 'Failed to read page hits');
            return [];
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
    /**
     * Name of an ad-network click-ID query param the middleware detected on
     * the landing URL (e.g. `'gclid'`). Auto-tagged ad clicks carry no UTM,
     * so this is the channel classifier's only paid signal for them. The
     * param's value is never forwarded or stored — only which param appeared.
     */
    clickId?: string | null;
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
    const cfRay = readSingleHeader(headers['cf-ray']);
    // Trust CF-IPCountry only when CF-Ray attests the hop was Cloudflare.
    // A direct-to-origin client can spoof both together, so this is row
    // consistency (cf columns populate as a set), not a security boundary —
    // the real enforcement is the origin firewall allow-listing Cloudflare.
    const cfIpCountry = cfRay ? normalizeCfCountry(readSingleHeader(headers['cf-ipcountry'])) : null;

    const utm = inputs.utm ?? {};
    const path = inputs.landingPath ?? (typeof req.path === 'string' ? req.path : '/');
    // Resolved once and shared by the country lookup and both source hashes;
    // the raw address never leaves this scope (privacy design — only the
    // derived country and keyed hashes are stored).
    const clientIP = getClientIP({ ip: req.ip, headers });

    return {
        event_type: eventType,
        timestamp: new Date(),
        candidate_uid: candidateUid,
        user_id: inputs.userId ?? null,
        referral_code: inputs.referralCode ?? null,
        duration_ms: inputs.durationMs ?? null,

        path,
        referer: referer ?? null,
        original_referrer: inputs.originalReferrer ?? null,

        user_agent: userAgent ?? null,
        accept_language: acceptLanguage ?? null,

        // Cloudflare's edge-derived country is authoritative when present;
        // the local GeoIP lookup covers direct-to-origin and dev traffic.
        country: cfIpCountry ?? getCountryFromIP(clientIP),
        device: getDeviceCategory(userAgent),
        bot_class: classifyTrafficRequest({ userAgent, path, referer, secFetchSite }),

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
        sec_fetch_site: secFetchSite ?? null,

        cf_ray: cfRay ?? null,
        cf_ipcountry: cfIpCountry,

        ip_hash: getIpHash(clientIP),
        subnet_hash: getSubnetHash(clientIP),

        // Classified at write time so channel is a stored dimension every
        // consumer shares. Bootstrap rows only: they carry the true external
        // attribution signal. A `page` row's Referer is this site's own
        // origin after any internal navigation and would classify as
        // 'referral' on every row — storing NULL instead keeps the column
        // meaningful under a bare GROUP BY with no event_type filter.
        channel: eventType === 'bootstrap'
            ? classifyChannel({
                refererDomain: refererDomainFromUrl(referer ?? null),
                utmMedium: utm.medium ?? null,
                utmSource: utm.source ?? null,
                clickId: inputs.clickId ?? null
            })
            : null
    };
}

/**
 * Normalize the `CF-IPCountry` header into a storable ISO-3166 alpha-2
 * code. Cloudflare emits `XX` (unknown) and `T1` (Tor) sentinels that are
 * not countries — collapsing them to `null` keeps the geo dimension clean
 * while the raw proxied/direct signal still lives in `cf_ray`.
 *
 * @param value - Raw `CF-IPCountry` header value.
 * @returns Uppercase alpha-2 code, or `null` for sentinels/malformed input.
 */
function normalizeCfCountry(value: string | undefined): string | null {
    let country: string | null = null;
    if (value) {
        const v = value.trim().toUpperCase();
        if (/^[A-Z]{2}$/.test(v) && v !== 'XX' && v !== 'T1') {
            country = v;
        }
    }
    return country;
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
 * Convert a ClickHouse native `DateTime64(3)` string to an ISO-8601 UTC string.
 *
 * Aggregate reads (`min`/`max`/`argMin` over `timestamp`) return the column's
 * native `YYYY-MM-DD HH:MM:SS.mmm` form with no zone suffix. The frontend's
 * `new Date(value)` parses that space-separated, suffix-less form as *local*
 * time, shifting every value by the viewer's UTC offset and skewing relative
 * ages — west-of-UTC offsets push recent rows into the future, which renders
 * as "just now" indefinitely. Emitting ISO-8601 with the `Z` suffix keeps the
 * wire value unambiguously UTC so the client parses it correctly.
 *
 * @param value - ClickHouse native DateTime64 string.
 * @returns ISO-8601 UTC string (with `Z` suffix).
 */
function clickHouseDateToIso(value: string): string {
    const date = parseClickHouseDateTime64Utc(value);
    return Number.isNaN(date.getTime()) ? value : date.toISOString();
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
