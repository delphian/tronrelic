/**
 * Bot classifier for ClickHouse `traffic_events.bot_class`.
 *
 * Hybrid approach: `isbot` provides the boolean spine (handles the long
 * tail of generic crawlers and stays current as new bots emerge), and
 * a small explicit rule set on top maps the few User-Agent families we
 * actually want to chart in the Phase 5 admin UI to a stable enum.
 *
 * ## Why a hybrid
 *
 * Pure `isbot` would tell us "47% of traffic is bots" — useless for an
 * analytics dashboard. Pure regex would rot, since maintaining a
 * comprehensive UA database is a full-time job and we'd still miss the
 * long tail. The hybrid keeps the maintained library for breadth and
 * adds explicit rules only for the categories whose rate of change
 * matters to a TRON analytics product (search reach, AI training, link
 * unfurls, monitoring).
 *
 * ## Categories
 *
 * - `human` — `isbot` returns false (the default for real visitors).
 * - `search_engine` — Googlebot, Bingbot, DuckDuckBot, Yandex, Baidu,
 *   Sogou, Naver, Applebot. Drives organic SEO surface area.
 * - `ai_crawler` — GPTBot, ClaudeBot, PerplexityBot, Google-Extended,
 *   CCBot, anthropic-ai. The fastest-growing class in 2026 and the one
 *   most analytically interesting (training-set ingestion).
 * - `social_unfurler` — Slackbot, Twitterbot, facebookexternalhit,
 *   LinkedInBot, Discordbot, TelegramBot, WhatsApp. First-touch link
 *   previews; correlates with social distribution velocity.
 * - `uptime_probe` — UptimeRobot, Pingdom, StatusCake, BetterUptime,
 *   New Relic synthetics. Synthetic monitoring; high cardinality with
 *   low analytic value, broken out so dashboards can subtract it.
 * - `bot_other` — `isbot` returned true but no explicit rule matched.
 *   Captures the long tail without forcing it into a misleading family.
 *
 * Keep the enum small. Industry consensus across analytics platforms
 * (Plausible, Fathom, Cloudflare Web Analytics) lands in this 5-6
 * category range — beyond that dashboards become illegible and the
 * classifier drifts toward fingerprinting.
 *
 * ## Design constraints
 *
 * - **Server-side, write-time.** Classification runs once per row inside
 *   `buildTrafficEvent`. Never compute on read; ClickHouse can't run
 *   `isbot` and we don't want a UDF.
 * - **Family-level, not version-level.** Store `search_engine`, not
 *   `googlebot-mobile-image`. Drilldowns happen via the raw
 *   `user_agent` column, kept on every row for exactly this reason.
 * - **Order matters.** The explicit rules run before the `isbot`
 *   fallback so a UA that matches both an explicit family and the
 *   library's bot list gets the more specific label.
 * - **AI-crawler rules run before search-engine rules.** Google-Extended
 *   includes the substring `googlebot` in some UA strings; it must be
 *   tagged `ai_crawler` first, since the operator-distinguishing
 *   intent (training-data ingest vs search ranking) is what the
 *   dashboard cares about.
 * - **No ReDoS surface.** All matching uses `String.prototype.includes`
 *   on a lowercased, length-clamped UA. No user-controlled regex.
 */

import { isbot } from 'isbot';

/**
 * Closed enum written to `traffic_events.bot_class`.
 *
 * Stored as `LowCardinality(Nullable(String))`. `null` means "not yet
 * classified" — pre-classifier rows from Phases 0-4 keep that value
 * forever (forward-only by project convention; no backfill planned).
 */
export type BotClass =
    | 'human'
    | 'search_engine'
    | 'ai_crawler'
    | 'social_unfurler'
    | 'uptime_probe'
    | 'bot_other';

/**
 * UA fragments per explicit category, lowercased. Match is `includes`,
 * so partial matches are intentional (e.g. `'googlebot'` covers
 * `Googlebot`, `Googlebot-Image`, `Googlebot-Mobile`).
 *
 * Rule list iterates in declaration order. `ai_crawler` precedes
 * `search_engine` because Google-Extended advertises itself with a
 * UA that contains both `Googlebot` and `Google-Extended`; tagging
 * it as `ai_crawler` matches operator intent (Gemini training crawl
 * vs search-ranking crawl) and is what the Phase 5 dashboard will
 * surface as a distinct category.
 */
const RULES: ReadonlyArray<{ class: BotClass; fragments: readonly string[] }> = [
    {
        class: 'ai_crawler',
        fragments: [
            'gptbot',
            'chatgpt-user',
            'oai-searchbot',
            'claudebot',
            'claude-web',
            'anthropic-ai',
            'perplexitybot',
            'google-extended',
            'ccbot',
            'bytespider',
            'cohere-ai',
            'meta-externalagent'
        ]
    },
    {
        class: 'search_engine',
        fragments: [
            'googlebot',
            'bingbot',
            'duckduckbot',
            'yandexbot',
            'yandex.com/bots',
            'baiduspider',
            'sogou web spider',
            'naverbot',
            'yeti',
            'applebot',
            'petalbot',
            'seznambot',
            'mojeekbot'
        ]
    },
    {
        class: 'social_unfurler',
        fragments: [
            'slackbot',
            'slack-imgproxy',
            'twitterbot',
            'facebookexternalhit',
            'facebookcatalog',
            'linkedinbot',
            'discordbot',
            'telegrambot',
            'whatsapp',
            'pinterestbot',
            'redditbot',
            'embedly',
            'skypeuripreview'
        ]
    },
    {
        class: 'uptime_probe',
        fragments: [
            'uptimerobot',
            'pingdom',
            'statuscake',
            'betteruptime',
            'better-uptime',
            'newrelicpinger',
            'datadog',
            'site24x7',
            'hetrixtools',
            'updown.io'
        ]
    }
];

/**
 * Cap UA length before lowercasing/matching. Real browsers stay under
 * ~250 chars; anything longer is either misconfigured or hostile, and
 * we don't want pathological inputs driving CPU on the request path.
 * Matches `getDeviceCategory`'s 500-char cap pattern.
 */
const MAX_UA_LENGTH = 500;

/**
 * Classify a User-Agent header value into one of the six `BotClass`
 * buckets.
 *
 * `null` / `undefined` / empty string is treated as `bot_other` rather
 * than `human` — a request without a UA in 2026 is overwhelmingly
 * non-browser traffic (curl scripts, hand-rolled HTTP clients, broken
 * proxies). Calling it `human` would inflate human metrics with the
 * exact noise this column exists to filter out.
 *
 * @param userAgent - Raw `User-Agent` header value, or null/undefined.
 * @returns One of the six `BotClass` enum values. Never null.
 */
export function classifyUserAgent(userAgent: string | null | undefined): BotClass {
    if (!userAgent) {
        return 'bot_other';
    }

    const ua = userAgent.slice(0, MAX_UA_LENGTH).toLowerCase();

    for (const rule of RULES) {
        for (const fragment of rule.fragments) {
            if (ua.includes(fragment)) {
                return rule.class;
            }
        }
    }

    if (isbot(ua)) {
        return 'bot_other';
    }

    return 'human';
}
