/**
 * @fileoverview ClickHouse reads behind the bot rules: preview, match counts,
 * and suggestions.
 *
 * ## Why This Exists
 *
 * A bot rule is only as good as the evidence behind it. Before saving, an
 * operator needs to see what the conditions would have matched and whether real
 * people are among the matches. After saving, they need to see how often each
 * rule fires. And a disguised crawler should be noticed without someone first
 * spotting a traffic spike by eye. These three reads answer those questions
 * from `traffic_events`.
 *
 * ## Design Decisions
 *
 * - **Separate from TrafficService.** These reads serve the rule editor, not
 *   the visitor Metrics Contract, so they do not apply the ignore list or the
 *   visitor rule and are kept apart from the dashboard reads.
 * - **Bound parameters only.** Every operator- or model-supplied value is
 *   passed as a query parameter, never spliced into the SQL.
 * - **Logged-in events never match**, mirroring the live matcher, so the
 *   preview reports what a rule would actually do.
 * - **No ClickHouse, no figures.** Without the analytics store each read
 *   returns null or an empty list, matching the module's no-op posture.
 */

import type { IBotRuleConditions, IBotRulePreview, IBotRuleStats, IBotRuleSuggestion, IClickHouseService, ISystemLogService } from '@/types';
import { TRAFFIC_EVENTS_TABLE_NAME } from './traffic.service.js';
import { formatClickHouseDateTime64Utc } from '../../../lib/formatClickHouseDateTime64Utc.js';
import { parseClickHouseDateTime64Utc } from '../../../lib/parseClickHouseDateTime64Utc.js';

/** Preview windows the editor offers, in days. */
export const BOT_RULE_PREVIEW_DAYS: readonly number[] = [1, 7, 30];

/** Preview window used when none is given. */
export const DEFAULT_BOT_RULE_PREVIEW_DAYS = 7;

/** Matched events returned as examples in a preview. */
const PREVIEW_SAMPLE_LIMIT = 10;

/** Window the suggestions read covers. */
const SUGGESTION_WINDOW_DAYS = 7;

/** Fewest distinct cookies a network needs before it is suggested. */
const SUGGESTION_MIN_COOKIES = 20;

/** Most page reports per cookie a suggested network may average; crawlers take a fresh cookie per page. */
const SUGGESTION_MAX_PAGES_PER_COOKIE = 1.5;

/** Smallest share of reports without a referrer a suggested network must have. */
const SUGGESTION_MIN_NO_REFERRER_SHARE = 0.9;

/** Most suggestions returned. */
const SUGGESTION_LIMIT = 20;

/**
 * Referrer an event is judged by: the browser-reported landing referrer on a
 * page report, and the `Referer` header on a page load. Matches the live matcher.
 */
const REFERRER_EXPR = "if(e.event_type = 'page', e.original_referrer, e.referer)";

/**
 * The SQL that selects events matching a set of conditions, with its parameters.
 */
interface IMatchedEventsQuery {
    /** A SELECT producing one row per matched event, columns aliased for the outer reads. */
    sql: string;
    /** Bound parameters for that SELECT. */
    params: Record<string, unknown>;
}

/**
 * Convert a ClickHouse native date string to ISO-8601 UTC.
 *
 * @param value - ClickHouse `DateTime64` string.
 * @returns ISO string, or the input unchanged when it cannot be parsed.
 */
function toIso(value: unknown): string {
    const text = String(value);
    const date = parseClickHouseDateTime64Utc(text);
    return Number.isNaN(date.getTime()) ? text : date.toISOString();
}

/**
 * Build the SELECT of events matching a rule's conditions over a window.
 *
 * Conditions translate one to one into SQL so the preview agrees with the live
 * matcher: every set condition is ANDed, lists are ORed, and browser-identifier
 * fragments must all appear. The network-mismatch condition joins each page
 * report to the same cookie's latest page load in the window.
 *
 * @param conditions - Validated, normalised conditions.
 * @param since - Window start.
 * @param until - Window end.
 * @returns The SELECT and its parameters.
 */
export function buildMatchedEventsQuery(conditions: IBotRuleConditions, since: Date, until: Date): IMatchedEventsQuery {
    const params: Record<string, unknown> = {
        since: formatClickHouseDateTime64Utc(since),
        until: formatClickHouseDateTime64Utc(until)
    };
    const clauses: string[] = [
        'e.timestamp >= parseDateTimeBestEffort({since:String})',
        'e.timestamp <= parseDateTimeBestEffort({until:String})',
        'e.user_id IS NULL'
    ];

    if (conditions.asns && conditions.asns.length > 0) {
        clauses.push('e.asn IN {asns:Array(UInt32)}');
        params.asns = conditions.asns;
    }
    if (conditions.countries && conditions.countries.length > 0) {
        clauses.push('e.country IN {countries:Array(String)}');
        params.countries = conditions.countries;
    }
    (conditions.userAgentContains ?? []).forEach((fragment, index) => {
        clauses.push(`positionCaseInsensitive(ifNull(e.user_agent, ''), {ua${index}:String}) > 0`);
        params[`ua${index}`] = fragment;
    });
    if (conditions.pathPrefixes && conditions.pathPrefixes.length > 0) {
        const parts = conditions.pathPrefixes.map((prefix, index) => {
            params[`pp${index}`] = prefix;
            return `startsWith(e.path, {pp${index}:String})`;
        });
        clauses.push(`(${parts.join(' OR ')})`);
    }
    if (conditions.eventType) {
        clauses.push('e.event_type = {eventType:String}');
        params.eventType = conditions.eventType;
    }
    if (conditions.referrer === 'absent') {
        clauses.push(`(${REFERRER_EXPR} IS NULL OR ${REFERRER_EXPR} = '')`);
    } else if (conditions.referrer === 'present') {
        clauses.push(`(${REFERRER_EXPR} IS NOT NULL AND ${REFERRER_EXPR} != '')`);
    }

    let join = '';
    if (conditions.networkMismatch) {
        // The live matcher compares against the page load held in memory when the
        // report arrives. Here the cookie's latest page load in the window stands
        // in for it, which is the same row for the usual one-load-per-cookie case.
        join = `
            INNER JOIN (
                SELECT
                    candidate_uid,
                    argMax(asn, timestamp) AS ft_asn,
                    argMax(country, timestamp) AS ft_country,
                    max(timestamp) AS ft_at
                FROM ${TRAFFIC_EVENTS_TABLE_NAME}
                WHERE event_type = 'bootstrap'
                    AND timestamp >= parseDateTimeBestEffort({since:String}) - INTERVAL 1 HOUR
                    AND timestamp <= parseDateTimeBestEffort({until:String})
                GROUP BY candidate_uid
            ) AS ft ON ft.candidate_uid = e.candidate_uid`;
        const column = conditions.networkMismatch.compare === 'asn' ? 'asn' : 'country';
        clauses.push(
            "e.event_type = 'page'",
            'e.timestamp >= ft.ft_at',
            "dateDiff('millisecond', ft.ft_at, e.timestamp) <= {mismatchMs:UInt32}",
            `ft.ft_${column} IS NOT NULL`,
            `e.${column} IS NOT NULL`,
            `ft.ft_${column} != e.${column}`
        );
        params.mismatchMs = conditions.networkMismatch.withinSeconds * 1000;
    }

    const sql = `
        SELECT
            e.timestamp AS ts,
            e.event_type AS kind,
            e.candidate_uid AS uid,
            e.path AS path,
            e.country AS country,
            e.asn AS asn,
            e.user_agent AS ua,
            e.bot_class AS bot_class,
            ${REFERRER_EXPR} AS ref
        FROM ${TRAFFIC_EVENTS_TABLE_NAME} AS e${join}
        WHERE ${clauses.join('\n            AND ')}`;
    return { sql, params };
}

/**
 * Runs the bot-rule reads against ClickHouse.
 */
export class BotRuleAnalyticsService {
    /**
     * @param clickhouse - ClickHouse service, or undefined when the analytics store is not configured.
     * @param logger - Traffic-module logger.
     */
    constructor(
        private readonly clickhouse: IClickHouseService | undefined,
        private readonly logger: ISystemLogService
    ) {}

    /**
     * Report what a set of conditions would have matched over a recent window,
     * with the signs of real people an operator should check before saving.
     *
     * @param conditions - Validated, normalised conditions.
     * @param days - Window length; one of {@link BOT_RULE_PREVIEW_DAYS}.
     * @returns The preview, or null when ClickHouse is not configured.
     */
    async preview(conditions: IBotRuleConditions, days: number = DEFAULT_BOT_RULE_PREVIEW_DAYS): Promise<IBotRulePreview | null> {
        let preview: IBotRulePreview | null = null;
        if (this.clickhouse) {
            const windowDays = BOT_RULE_PREVIEW_DAYS.includes(days) ? days : DEFAULT_BOT_RULE_PREVIEW_DAYS;
            const until = new Date();
            const since = new Date(until.getTime() - windowDays * 24 * 60 * 60 * 1000);
            const matched = buildMatchedEventsQuery(conditions, since, until);

            const [totals, labels, cookies, samples] = await Promise.all([
                this.clickhouse.query<{ events: string; cookies: string; ref_domains: string; uas: string }>(`
                    SELECT
                        count() AS events,
                        uniqExact(uid) AS cookies,
                        uniqExactIf(domain(assumeNotNull(ref)), ref IS NOT NULL AND ref != '') AS ref_domains,
                        uniqExact(ua) AS uas
                    FROM (${matched.sql})`, matched.params),
                this.clickhouse.query<{ label: string; n: string }>(`
                    SELECT ifNull(bot_class, 'unclassified') AS label, count() AS n
                    FROM (${matched.sql})
                    GROUP BY label`, matched.params),
                this.clickhouse.query<{ logged_in_cookies: string; returning_cookies: string }>(`
                    SELECT countIf(logged_in = 1) AS logged_in_cookies, countIf(days >= 2) AS returning_cookies
                    FROM (
                        SELECT
                            candidate_uid,
                            max(user_id IS NOT NULL) AS logged_in,
                            uniqExact(toDate(timestamp)) AS days
                        FROM ${TRAFFIC_EVENTS_TABLE_NAME}
                        WHERE timestamp >= parseDateTimeBestEffort({since:String})
                            AND timestamp <= parseDateTimeBestEffort({until:String})
                            AND candidate_uid IN (SELECT uid FROM (${matched.sql}))
                        GROUP BY candidate_uid
                    )`, matched.params),
                this.clickhouse.query<{ ts: string; kind: string; path: string; country: string | null; asn: number | null; ua: string | null; bot_class: string | null }>(`
                    SELECT ts, kind, path, country, asn, ua, bot_class
                    FROM (${matched.sql})
                    ORDER BY ts DESC
                    LIMIT ${PREVIEW_SAMPLE_LIMIT}`, matched.params)
            ]);

            const eventsByCurrentLabel: Record<string, number> = {};
            for (const row of labels) {
                eventsByCurrentLabel[row.label] = Number(row.n);
            }
            preview = {
                windowDays,
                windowStart: since.toISOString(),
                windowEnd: until.toISOString(),
                matchedEvents: Number(totals[0]?.events ?? 0),
                matchedCookies: Number(totals[0]?.cookies ?? 0),
                eventsByCurrentLabel,
                loggedInCookies: Number(cookies[0]?.logged_in_cookies ?? 0),
                returningCookies: Number(cookies[0]?.returning_cookies ?? 0),
                distinctReferrerDomains: Number(totals[0]?.ref_domains ?? 0),
                distinctUserAgents: Number(totals[0]?.uas ?? 0),
                samples: samples.map(row => ({
                    timestamp: toIso(row.ts),
                    eventType: row.kind,
                    path: row.path,
                    country: row.country ?? null,
                    asn: row.asn === null || row.asn === undefined ? null : Number(row.asn),
                    userAgent: row.ua ?? null,
                    currentLabel: row.bot_class ?? null
                }))
            };
        }
        return preview;
    }

    /**
     * Count each rule's matches over the last day and week, from
     * `traffic_events.bot_rule`. Returns an empty list, with a warning, when the
     * read fails, which is what happens until migration 021 adds the column.
     *
     * @returns One entry per rule that matched in the last 7 days.
     */
    async stats(): Promise<IBotRuleStats[]> {
        let stats: IBotRuleStats[] = [];
        if (this.clickhouse) {
            try {
                const rows = await this.clickhouse.query<{ rule_id: string; d1: string; d7: string; last_at: string }>(`
                    SELECT
                        bot_rule AS rule_id,
                        countIf(timestamp >= now() - INTERVAL 1 DAY) AS d1,
                        count() AS d7,
                        max(timestamp) AS last_at
                    FROM ${TRAFFIC_EVENTS_TABLE_NAME}
                    WHERE timestamp >= now() - INTERVAL 7 DAY AND bot_rule IS NOT NULL
                    GROUP BY bot_rule`);
                stats = rows.map(row => ({
                    ruleId: row.rule_id,
                    matches24h: Number(row.d1),
                    matches7d: Number(row.d7),
                    lastMatchedAt: row.last_at ? toIso(row.last_at) : null
                }));
            } catch (error) {
                this.logger.warn({ error }, 'Failed to read bot rule match counts; has migration 021 run?');
            }
        }
        return stats;
    }

    /**
     * Find networks whose recent traffic has a crawler's shape but is still
     * counted as human: many cookies, about one page each, almost never a
     * referrer, and no cookie that ever logged in.
     *
     * @param coveredAsns - Networks an active rule already names, left out of the result.
     * @returns Up to {@link SUGGESTION_LIMIT} candidates, most cookies first.
     */
    async suggestions(coveredAsns: ReadonlySet<number>): Promise<IBotRuleSuggestion[]> {
        let suggestions: IBotRuleSuggestion[] = [];
        if (this.clickhouse) {
            const rows = await this.clickhouse.query<{
                asn: number; cookies: string; events: string; no_ref: string; uas: string;
                top_ua: string[]; countries: string[]; first_seen: string; last_seen: string;
            }>(`
                SELECT
                    asn,
                    uniqExact(candidate_uid) AS cookies,
                    count() AS events,
                    countIf(original_referrer IS NULL OR original_referrer = '') AS no_ref,
                    uniqExactIf(candidate_uid, candidate_uid IN (
                        SELECT DISTINCT candidate_uid FROM ${TRAFFIC_EVENTS_TABLE_NAME}
                        WHERE timestamp >= now() - INTERVAL {days:UInt32} DAY AND user_id IS NOT NULL
                    )) AS logged_in,
                    uniqExact(user_agent) AS uas,
                    topK(1)(user_agent) AS top_ua,
                    groupUniqArray(5)(country) AS countries,
                    min(timestamp) AS first_seen,
                    max(timestamp) AS last_seen
                FROM ${TRAFFIC_EVENTS_TABLE_NAME}
                WHERE timestamp >= now() - INTERVAL {days:UInt32} DAY
                    AND event_type = 'page'
                    AND bot_class = 'human'
                    AND asn IS NOT NULL
                GROUP BY asn
                HAVING cookies >= {minCookies:UInt32}
                    AND logged_in = 0
                    AND events <= cookies * {maxPagesPerCookie:Float64}
                    AND no_ref >= events * {minNoReferrer:Float64}
                ORDER BY cookies DESC
                LIMIT {limit:UInt32}`, {
                days: SUGGESTION_WINDOW_DAYS,
                minCookies: SUGGESTION_MIN_COOKIES,
                maxPagesPerCookie: SUGGESTION_MAX_PAGES_PER_COOKIE,
                minNoReferrer: SUGGESTION_MIN_NO_REFERRER_SHARE,
                limit: SUGGESTION_LIMIT + coveredAsns.size
            });
            suggestions = rows
                .filter(row => !coveredAsns.has(Number(row.asn)))
                .slice(0, SUGGESTION_LIMIT)
                .map(row => ({
                    asn: Number(row.asn),
                    cookies: Number(row.cookies),
                    events: Number(row.events),
                    noReferrerShare: Number(row.events) > 0 ? Number(row.no_ref) / Number(row.events) : 0,
                    distinctUserAgents: Number(row.uas),
                    topUserAgent: row.top_ua?.[0] ?? null,
                    countries: (row.countries ?? []).filter((country): country is string => typeof country === 'string' && country !== ''),
                    firstSeen: toIso(row.first_seen),
                    lastSeen: toIso(row.last_seen)
                }));
        }
        return suggestions;
    }
}
