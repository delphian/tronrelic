/**
 * @fileoverview Acquisition-channel classification for traffic events.
 *
 * Classifies a visit into a coarse acquisition channel (direct / organic /
 * paid / social / email / ai / referral) from its first-touch referrer, UTM
 * parameters, and paid click-ID landing params. Runs at write time so
 * `channel` is a stored dimension on `traffic_events` — every consumer
 * (dashboards, AI tools, future reports) reads one canonical classification
 * instead of re-deriving it per surface. Before this existed the mapping
 * lived as a display-time regex in the frontend, invisible to the backend
 * and unable to distinguish paid from organic because UTM medium never
 * participated.
 *
 * Rules track GA4's default channel grouping (May 2026 revision, which added
 * the native "AI Assistants" channel) reduced to this module's coarse
 * vocabulary — e.g. GA4's Paid Search / Paid Social / Display all fold into
 * `paid`, and Organic Video (YouTube) folds into `social`.
 */

/**
 * Closed acquisition-channel vocabulary. Matches the GA4-style default
 * channel grouping, reduced to the buckets TronRelic can actually
 * distinguish, plus `ai` — LLM-assistant referrals (ChatGPT, Perplexity)
 * that SEO practice now tracks as a first-class channel.
 */
export type TrafficChannel = 'direct' | 'organic' | 'paid' | 'social' | 'email' | 'ai' | 'referral';

/**
 * GA4's paid-medium test (`^(.*cp.*|ppc|retargeting|paid.*)$`) — any medium
 * containing "cp" (cpc, cpm, cpa, cpv, ecpc, …) or starting with "paid".
 * Deliberately broad: an advertiser's explicit paid declaration should win
 * even for medium spellings we have never seen.
 */
const PAID_MEDIUM_REGEX = /^(.*cp.*|ppc|retargeting|paid.*)$/;

/**
 * GA4 Display-channel mediums, folded into `paid` under this module's
 * coarse vocabulary (`cpm` is already caught by {@link PAID_MEDIUM_REGEX}).
 */
const DISPLAY_MEDIUMS = new Set(['display', 'banner', 'expandable', 'interstitial']);

/**
 * Ad-network click-ID query params whose presence marks a paid landing even
 * with no UTM tagging (auto-tagged Google Ads carry only `gclid`).
 * `fbclid` is deliberately absent — Facebook appends it to organic outbound
 * clicks too, so it proves the source, not the spend.
 *
 * Exported as the ingestion allow-list: the bootstrap controller accepts a
 * body-supplied click-ID *name* only when it appears here, so the publicly
 * callable endpoint cannot be used to store arbitrary strings. The Next.js
 * middleware carries a copy of these names (frontend cannot import backend
 * modules) — keep the two lists in sync.
 */
export const PAID_CLICK_IDS = new Set(['gclid', 'gbraid', 'wbraid', 'dclid', 'msclkid', 'ttclid', 'twclid', 'li_fat_id']);

/**
 * Email mediums/sources per GA4 (`email|e-mail|e_mail|e mail` on source OR
 * medium), plus `newsletter` — a common real-world medium GA4 leaves
 * Unassigned but which is unambiguously email.
 */
const EMAIL_TOKENS = new Set(['email', 'e-mail', 'e_mail', 'e mail', 'newsletter']);

/** GA4 organic-social mediums (plus the legacy `social_media` spelling). */
const SOCIAL_MEDIUMS = new Set(['social', 'social-network', 'social-media', 'sm', 'social network', 'social media', 'social_media']);

/**
 * Referrer domains of LLM assistants — GA4's AI Assistants list (ChatGPT,
 * Gemini, DeepSeek, Copilot, Grok) plus Claude, Perplexity (missing from
 * GA4's list as of mid-2026), Mistral, Meta AI, You.com, and Phind.
 * End-anchored so a hostile subdomain suffix cannot spoof its way in.
 */
const AI_DOMAINS = /(^|\.)(chatgpt\.com|chat\.openai\.com|perplexity\.ai|claude\.ai|gemini\.google\.com|copilot\.microsoft\.com|deepseek\.com|grok\.com|x\.ai|meta\.ai|mistral\.ai|you\.com|phind\.com)$/;

/**
 * Referrer domains of search engines — the organic channel. Every
 * alternative is end-anchored on its registrable domain so `google.evil.com`
 * cannot classify as organic; google/yahoo additionally accept country TLDs
 * (`google.de`, `google.co.uk`).
 */
const SEARCH_DOMAINS = /(^|\.)((google|yahoo)\.([a-z]{2,3})(\.[a-z]{2})?|(bing|duckduckgo|ecosia|qwant|startpage|naver)\.com|baidu\.com|yandex\.(ru|com)|search\.brave\.com)$/;

/**
 * Referrer domains of social platforms, per GA4's social source category
 * (YouTube folded in from GA4's Organic Video) plus the post-2023 networks
 * GA4 lags on (Threads, Bluesky, Mastodon). End-anchored against
 * subdomain-suffix spoofing.
 */
const SOCIAL_DOMAINS = /(^|\.)(twitter\.com|x\.com|t\.co|facebook\.com|fb\.com|reddit\.com|linkedin\.com|instagram\.com|youtube\.com|tiktok\.com|telegram\.org|t\.me|discord\.com|discord\.gg|pinterest\.com|threads\.net|bsky\.app|mastodon\.social|whatsapp\.com)$/;

/**
 * Inputs to channel classification — the first-touch attribution signals a
 * bootstrap row carries.
 */
export interface IChannelInputs {
    /** Referrer host (e.g. `'duckduckgo.com'`), or null/empty for none. */
    refererDomain: string | null;
    /** `utm_medium`, when the landing URL carried one. */
    utmMedium?: string | null;
    /** `utm_source`, when the landing URL carried one. */
    utmSource?: string | null;
    /**
     * Name of an ad-network click-ID param present on the landing URL
     * (e.g. `'gclid'`), when the ingestion path detected one. Auto-tagged
     * ad clicks carry no UTM at all, so this is the only paid signal they
     * have.
     */
    clickId?: string | null;
}

/**
 * Extract the lowercase hostname from a raw `Referer` header value.
 *
 * The caller hands the full header (a URL) because that is what the event
 * builder has; classification only needs the host.
 *
 * @param referer - Raw `Referer` header value, or null.
 * @returns Lowercase hostname, or null when absent/unparseable.
 */
export function refererDomainFromUrl(referer: string | null): string | null {
    let domain: string | null = null;
    if (referer) {
        try {
            domain = new URL(referer).hostname.toLowerCase();
        } catch {
            domain = null;
        }
    }
    return domain;
}

/**
 * Classify a first touch into an acquisition channel.
 *
 * Paid signals are checked first because they are the advertiser's explicit
 * declaration of intent — a paid Google ad arrives with a google.com
 * referrer (and, when auto-tagged, only a `gclid`) and would otherwise be
 * indistinguishable from an organic search. Email and social mediums
 * follow (GA4 matches email on source or medium), then referrer-domain
 * heuristics separate ai / organic / social, `utm_medium=organic` claims
 * organic per GA4, and the absence of any signal is `direct`.
 *
 * @param inputs - First-touch referrer domain, UTM parameters, and click-ID.
 * @returns The acquisition channel for the visit.
 */
export function classifyChannel(inputs: IChannelInputs): TrafficChannel {
    const medium = (inputs.utmMedium ?? '').trim().toLowerCase();
    const source = (inputs.utmSource ?? '').trim().toLowerCase();
    const domain = (inputs.refererDomain ?? '').trim().toLowerCase();
    const clickId = (inputs.clickId ?? '').trim().toLowerCase();

    let channel: TrafficChannel;
    if ((medium && PAID_MEDIUM_REGEX.test(medium)) || DISPLAY_MEDIUMS.has(medium) || PAID_CLICK_IDS.has(clickId)) {
        channel = 'paid';
    } else if (EMAIL_TOKENS.has(medium) || EMAIL_TOKENS.has(source)) {
        channel = 'email';
    } else if (SOCIAL_MEDIUMS.has(medium)) {
        channel = 'social';
    } else if (domain && AI_DOMAINS.test(domain)) {
        channel = 'ai';
    } else if (medium === 'organic' || (domain && SEARCH_DOMAINS.test(domain))) {
        channel = 'organic';
    } else if (domain && SOCIAL_DOMAINS.test(domain)) {
        channel = 'social';
    } else if (!domain && !medium && !source) {
        channel = 'direct';
    } else {
        // Unrecognized referrer domain, or tagged traffic with an unknown
        // medium and no referrer — referral is the honest catch-all.
        channel = 'referral';
    }
    return channel;
}
