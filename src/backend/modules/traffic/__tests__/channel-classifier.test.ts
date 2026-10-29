/**
 * @fileoverview Contract tests for the acquisition-channel classifier.
 *
 * The classifier is the single canonical channel definition (stored at
 * write time on `traffic_events.channel`), so these tests pin the
 * precedence rules: paid signals (GA4 medium regex, ad click-IDs) beat
 * referrer heuristics, AI/search/social domain lists resolve in that
 * order with end-anchored matching (no subdomain-suffix spoofing), and
 * the absence of any signal is `direct`.
 */
import { describe, it, expect } from 'vitest';
import { classifyChannel, refererDomainFromUrl } from '../services/channel-classifier.js';

describe('classifyChannel', () => {
    it('classifies no-signal visits as direct', () => {
        expect(classifyChannel({ refererDomain: null })).toBe('direct');
        expect(classifyChannel({ refererDomain: '' })).toBe('direct');
    });

    it('classifies a referrer-less visit from a social app\'s in-app browser as social', () => {
        // In-app browsers send no referrer, so before the source app was
        // recorded these visits read direct.
        expect(classifyChannel({ refererDomain: null, sourceApp: 'douyin' })).toBe('social');
        expect(classifyChannel({ refererDomain: '', sourceApp: 'wechat' })).toBe('social');
    });

    it('lets a referrer win over the in-app browser', () => {
        // The referrer says where the visitor came from; the app is only the
        // browser they used, so an unknown referrer still reads referral and
        // a search referrer still reads organic.
        expect(classifyChannel({ refererDomain: 'example.org', sourceApp: 'wechat' })).toBe('referral');
        expect(classifyChannel({ refererDomain: 'www.google.com', sourceApp: 'wechat' })).toBe('organic');
    });

    it('lets a stronger tag win over the in-app browser', () => {
        expect(classifyChannel({ refererDomain: null, utmMedium: 'cpc', sourceApp: 'douyin' })).toBe('paid');
        expect(classifyChannel({ refererDomain: null, utmSource: 'chatgpt.com', sourceApp: 'douyin' })).toBe('ai');
    });

    it('lets paid UTM medium override an organic-looking referrer', () => {
        // A paid Google ad arrives with a google.com referrer — medium is
        // the advertiser's explicit declaration and must win.
        expect(classifyChannel({ refererDomain: 'www.google.com', utmMedium: 'cpc' })).toBe('paid');
    });

    it('matches the GA4 paid-medium regex, not just a fixed list', () => {
        // GA4: ^(.*cp.*|ppc|retargeting|paid.*)$ — any "cp" substring or
        // "paid" prefix counts, including spellings we have never seen.
        expect(classifyChannel({ refererDomain: null, utmMedium: 'cpa' })).toBe('paid');
        expect(classifyChannel({ refererDomain: null, utmMedium: 'ecpc' })).toBe('paid');
        expect(classifyChannel({ refererDomain: null, utmMedium: 'paid-media' })).toBe('paid');
        expect(classifyChannel({ refererDomain: null, utmMedium: 'display' })).toBe('paid');
    });

    it('classifies ad click-ID landings as paid despite no UTM (auto-tagging)', () => {
        // An auto-tagged Google Ads click carries only gclid — without this
        // signal it would classify organic off the google.com referrer.
        expect(classifyChannel({ refererDomain: 'www.google.com', clickId: 'gclid' })).toBe('paid');
        expect(classifyChannel({ refererDomain: null, clickId: 'msclkid' })).toBe('paid');
        // fbclid is NOT a paid signal — Facebook appends it to organic clicks.
        expect(classifyChannel({ refererDomain: 'facebook.com', clickId: 'fbclid' })).toBe('social');
    });

    it('treats utm_medium=organic as organic per GA4, even with no referrer', () => {
        expect(classifyChannel({ refererDomain: null, utmMedium: 'organic', utmSource: 'newsletter-swap' })).toBe('organic');
    });

    it('classifies email mediums', () => {
        expect(classifyChannel({ refererDomain: null, utmMedium: 'newsletter' })).toBe('email');
        expect(classifyChannel({ refererDomain: null, utmSource: 'email' })).toBe('email');
    });

    it('classifies search-engine referrers as organic', () => {
        expect(classifyChannel({ refererDomain: 'www.google.com' })).toBe('organic');
        expect(classifyChannel({ refererDomain: 'duckduckgo.com' })).toBe('organic');
    });

    it('classifies LLM-assistant referrers as ai', () => {
        expect(classifyChannel({ refererDomain: 'chatgpt.com' })).toBe('ai');
        expect(classifyChannel({ refererDomain: 'www.perplexity.ai' })).toBe('ai');
        expect(classifyChannel({ refererDomain: 'chat.deepseek.com' })).toBe('ai');
        expect(classifyChannel({ refererDomain: 'grok.com' })).toBe('ai');
        // Gemini must resolve before the google.* organic rule.
        expect(classifyChannel({ refererDomain: 'gemini.google.com' })).toBe('ai');
    });

    it('classifies an AI-assistant utm_source as ai when the app sent no referrer', () => {
        // The ChatGPT apps open cited links with no referrer but keep the
        // utm_source=chatgpt.com tag ChatGPT adds to each citation.
        expect(classifyChannel({ refererDomain: null, utmSource: 'chatgpt.com' })).toBe('ai');
        expect(classifyChannel({ refererDomain: null, utmSource: 'ChatGPT.com' })).toBe('ai');
        // End-anchored like the referrer test, so a lookalike source is not ai.
        expect(classifyChannel({ refererDomain: null, utmSource: 'chatgpt.com.evil.example' })).toBe('referral');
    });

    it('classifies social referrers as social', () => {
        expect(classifyChannel({ refererDomain: 'x.com' })).toBe('social');
        expect(classifyChannel({ refererDomain: 'old.reddit.com' })).toBe('social');
        expect(classifyChannel({ refererDomain: 'threads.net' })).toBe('social');
        expect(classifyChannel({ refererDomain: 'bsky.app' })).toBe('social');
    });

    it('rejects subdomain-suffix spoofing of the search list', () => {
        // Referrers are client-supplied; google.evil.com must not read as
        // organic. Country TLDs on real engines still match.
        expect(classifyChannel({ refererDomain: 'google.evil.com' })).toBe('referral');
        expect(classifyChannel({ refererDomain: 'google.co.uk' })).toBe('organic');
        expect(classifyChannel({ refererDomain: 'search.brave.com' })).toBe('organic');
    });

    it('falls back to referral for unrecognized domains', () => {
        expect(classifyChannel({ refererDomain: 'someblog.example' })).toBe('referral');
    });

    it('treats tagged traffic with an unknown medium and no referrer as referral, not direct', () => {
        expect(classifyChannel({ refererDomain: null, utmMedium: 'qr-code' })).toBe('referral');
    });
});

describe('refererDomainFromUrl', () => {
    it('extracts the lowercase hostname', () => {
        expect(refererDomainFromUrl('https://Www.Google.com/search?q=x')).toBe('www.google.com');
    });

    it('returns null for missing or malformed referers', () => {
        expect(refererDomainFromUrl(null)).toBeNull();
        expect(refererDomainFromUrl('not a url')).toBeNull();
    });
});
