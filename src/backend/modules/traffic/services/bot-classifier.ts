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
 * - `scanner` — vulnerability probes identified by *request* signals
 *   rather than the UA (scanners lie in the UA): probe paths like
 *   `/.env` / `/wp-login.php` / encoded path traversal, or a spoofed
 *   search-engine `Referer` with no `Sec-Fetch-Site` header. Assigned
 *   by `classifyTrafficRequest`, never by the UA-only classifier.
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
    | 'scanner'
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
            'meta-externalagent',
            // Amazonbot powers both Alexa search and Amazon's LLM training
            // pipeline. Classify as `ai_crawler` because the training-crawl
            // intent is the analytically interesting one; the dashboard
            // surfaces AI ingestion as its own bucket.
            'amazonbot'
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
            'mojeekbot',
            // Moz's SEO crawler (DotBot/1.x). Drives the link graph behind
            // Moz/Open Site Explorer rankings — search-ranking adjacent.
            'dotbot'
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
            'skypeuripreview',
            // Flipboard's link unfurler. Same role as Twitterbot/Slackbot
            // for Flipboard "boards" sharing.
            'flipboardproxy'
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
 * Cap for the other request-signal inputs (path, referrer) before
 * lowercasing/matching. Same rationale as `MAX_UA_LENGTH` — bound CPU on
 * hostile inputs in the request path — but a separate constant so scanner
 * detection is not silently retuned by a future UA-specific change.
 */
const MAX_SIGNAL_LENGTH = 500;

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

/**
 * Request-level signals available only at the traffic-event write site.
 * The UA alone cannot expose a scanner that fakes a browser UA — but the
 * requested path and the referrer/Sec-Fetch consistency can.
 */
export interface ITrafficRequestSignals {
    /** Raw `User-Agent` header value, or null/undefined. */
    userAgent: string | null | undefined;
    /** Sanitized landing path (query/hash already stripped). */
    path: string | null | undefined;
    /** Raw `Referer` header value, or null/undefined. */
    referer: string | null | undefined;
    /** Raw `Sec-Fetch-Site` header value, or null/undefined. */
    secFetchSite: string | null | undefined;
}

/**
 * Lowercased path fragments that identify vulnerability probes. TronRelic
 * serves none of these — no PHP, no WordPress, no exposed dotfiles — so a
 * request for any of them is a scanner by definition, regardless of how
 * browser-like its UA looks. Match is `includes` on the lowercased path.
 */
const SCANNER_PATH_FRAGMENTS: readonly string[] = [
    '/.env',
    '/.git',
    '/.aws',
    '/.ssh',
    '/.docker',
    '/.vscode',
    '/wp-',
    '/wordpress',
    '/xmlrpc',
    '/phpmyadmin',
    '/phpinfo',
    '.php',
    '.asp',
    '.jsp',
    '/web-inf',
    '/etc/passwd',
    '/etc/apache2',
    '/var/www',
    '.aws/credentials',
    'application.properties',
    '/cgi-bin',
    '/actuator',
    '/owa/',
    '/vendor/phpunit',
    '/wlwmanifest'
];

/**
 * Exact-path probes (matched against the whole lowercased path, optionally
 * with a trailing slash) that are too short to safely `includes`-match —
 * `/wp` as a fragment would also hit legitimate slugs containing "wp".
 */
const SCANNER_EXACT_PATHS: ReadonlySet<string> = new Set([
    '/wp',
    '/cms',
    '/backup',
    '/old',
    '/config'
]);

/**
 * Path-traversal / encoding-evasion markers, checked against the *raw*
 * (pre-decode) lowercased path. `../` never appears in a legitimate
 * TronRelic route, and the encoded forms (`%2e%2e`, overlong UTF-8
 * `%c0%af`, fullwidth-solidus `%ef%bc%8f`) exist solely to slip
 * traversal past WAF pattern matching.
 */
const TRAVERSAL_FRAGMENTS: readonly string[] = [
    '../',
    '..%2f',
    '%2e%2e',
    '%252e',
    '%c0%af',
    '%ef%bc%8f'
];

/**
 * Referrer domains scanners routinely spoof to masquerade as organic
 * search traffic. Matched against the lowercased `Referer` value.
 */
const SPOOF_TARGET_REFERRERS: readonly string[] = [
    'google.',
    'bing.com',
    'duckduckgo.com',
    'yahoo.',
    'baidu.com',
    'yandex.'
];

/**
 * True when the requested path pattern-matches a vulnerability probe.
 *
 * @param path - Sanitized landing path (may still carry encoded traversal).
 * @returns True for probe paths (dotfiles, CMS probes, traversal encodings).
 */
function isScannerPath(path: string | null | undefined): boolean {
    let hit = false;
    if (path) {
        const p = path.slice(0, MAX_SIGNAL_LENGTH).toLowerCase();
        const exact = p.endsWith('/') && p.length > 1 ? p.slice(0, -1) : p;
        hit =
            SCANNER_EXACT_PATHS.has(exact) ||
            SCANNER_PATH_FRAGMENTS.some(fragment => p.includes(fragment)) ||
            TRAVERSAL_FRAGMENTS.some(fragment => p.includes(fragment));
    }
    return hit;
}

/**
 * True when the `Referer` claims a search-engine origin but the request's
 * `Sec-Fetch-Site` is anything other than `cross-site`. A genuine search
 * click-through is a cross-site navigation, and browsers set `Sec-Fetch-Site`
 * themselves (it is a forbidden header — page scripts cannot forge it), so
 * Chromium including Android WebView in-app browsers has sent `cross-site` on
 * real click-throughs since 2019 and WebKit since iOS 16.4 (2023). Spoofing
 * bots forge `Referer: https://www.google.com/` to masquerade as organic
 * traffic — and because Chrome's default `strict-origin-when-cross-origin`
 * policy makes even real clicks send a bare origin referer, the Referer alone
 * cannot distinguish them. The fetch metadata gives them away: a scripted
 * client sends no Sec-Fetch header at all (curl-style) or `Sec-Fetch-Site:
 * none` — a user-initiated navigation with no originating document, which
 * cannot coexist with a real cross-site referrer. We therefore treat a
 * search-engine referer whose `Sec-Fetch-Site` is any non-`cross-site` value
 * (absent, `none`, `same-origin`, `same-site`) as forged. Gated on
 * search-engine referrers specifically (the domains scanners actually spoof)
 * so a legacy browser arriving cross-site from an arbitrary site is untouched.
 * Accepted residual: a pre-16.4 iOS browser arriving from a real search click
 * (which sends no Sec-Fetch header) is mislabeled — the cost is one
 * first-touch analytics label, and its same-origin `page` events still
 * classify as human.
 *
 * @param referer - Raw `Referer` header value.
 * @param secFetchSite - Raw `Sec-Fetch-Site` header value.
 * @returns True when the referrer is a spoof-target domain and Sec-Fetch-Site is not `cross-site`.
 */
function isSpoofedSearchReferrer(
    referer: string | null | undefined,
    secFetchSite: string | null | undefined
): boolean {
    let spoofed = false;
    if (referer) {
        const site = secFetchSite ? secFetchSite.trim().toLowerCase() : '';
        if (site !== 'cross-site') {
            const ref = referer.slice(0, MAX_SIGNAL_LENGTH).toLowerCase();
            spoofed = SPOOF_TARGET_REFERRERS.some(domain => ref.includes(domain));
        }
    }
    return spoofed;
}

/**
 * Classify a traffic event using the full request context. Scanner
 * heuristics (probe paths, spoofed search referrers) run first because
 * scanners deliberately defeat UA-based classification with fake browser
 * UAs; everything that isn't a scanner falls through to the UA-only
 * {@link classifyUserAgent} pipeline unchanged.
 *
 * @param signals - Request-level signals collected at the write site.
 * @returns One of the seven `BotClass` enum values. Never null.
 */
export function classifyTrafficRequest(signals: ITrafficRequestSignals): BotClass {
    let result: BotClass;
    if (isScannerPath(signals.path) || isSpoofedSearchReferrer(signals.referer, signals.secFetchSite)) {
        result = 'scanner';
    } else {
        result = classifyUserAgent(signals.userAgent);
    }
    return result;
}
