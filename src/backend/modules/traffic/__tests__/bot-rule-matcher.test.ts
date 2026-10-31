/// <reference types="vitest" />

/**
 * @fileoverview Unit tests for the bot rule matcher.
 *
 * Pins the matching contract every caller relies on: all set conditions must
 * hold, list entries match on any one, browser-identifier fragments must all
 * appear, logged-in visitors never match, expired rules never match, a label
 * rule wins over a monitor rule, and rules only ever replace a `human` verdict.
 */

import { describe, it, expect } from 'vitest';
import {
    applyBotRules,
    matchesBotRuleConditions,
    selectBotRuleMatch,
    type IBotRuleMatcher,
    type IBotRuleSignals,
    type ICompiledBotRule
} from '../services/bot-rule-matcher.js';

const NOW = Date.parse('2026-10-30T14:30:00Z');
const MAC_CHROME_145 = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36';

/**
 * Build signals resembling the October 2026 Singapore crawler, with overrides.
 *
 * @param overrides - Fields to change for one test.
 * @returns A complete signal set.
 */
function signals(overrides: Partial<IBotRuleSignals> = {}): IBotRuleSignals {
    return {
        eventType: 'page',
        loggedIn: false,
        asn: 45102,
        country: 'SG',
        userAgent: MAC_CHROME_145,
        path: '/vi/resource-markets/tronzap',
        referrer: null,
        firstTouch: null,
        now: NOW,
        ...overrides
    };
}

/**
 * Build a compiled rule with overrides.
 *
 * @param overrides - Fields to change for one test.
 * @returns A compiled rule.
 */
function rule(overrides: Partial<ICompiledBotRule> = {}): ICompiledBotRule {
    return { id: 'r1', label: 'bot_other', mode: 'label', conditions: { asns: [45102] }, expiresAt: null, ...overrides };
}

describe('matchesBotRuleConditions', () => {
    it('matches when every set condition holds', () => {
        expect(matchesBotRuleConditions({
            asns: [45102],
            countries: ['SG'],
            userAgentContains: ['chrome/145.0.0.0', 'macintosh'],
            pathPrefixes: ['/vi/', '/zh/'],
            eventType: 'page',
            referrer: 'absent'
        }, signals())).toBe(true);
    });

    it('fails when any one condition does not hold', () => {
        expect(matchesBotRuleConditions({ asns: [45102], countries: ['US'] }, signals())).toBe(false);
    });

    it('requires every browser-identifier fragment', () => {
        expect(matchesBotRuleConditions({ userAgentContains: ['chrome/145.0.0.0', 'windows'] }, signals())).toBe(false);
    });

    it('matches a path against any listed prefix', () => {
        expect(matchesBotRuleConditions({ pathPrefixes: ['/zh/', '/vi/'] }, signals())).toBe(true);
        expect(matchesBotRuleConditions({ pathPrefixes: ['/zh/'] }, signals())).toBe(false);
    });

    it('treats a blank referrer as absent', () => {
        expect(matchesBotRuleConditions({ asns: [45102], referrer: 'absent' }, signals({ referrer: '  ' }))).toBe(true);
        expect(matchesBotRuleConditions({ asns: [45102], referrer: 'present' }, signals({ referrer: 'https://google.com/' }))).toBe(true);
    });

    it('never matches a rule with no narrowing condition', () => {
        expect(matchesBotRuleConditions({ eventType: 'page', referrer: 'absent' }, signals())).toBe(false);
        expect(matchesBotRuleConditions({}, signals())).toBe(false);
    });

    it('does not match a network condition when the event has no network', () => {
        expect(matchesBotRuleConditions({ asns: [45102] }, signals({ asn: null }))).toBe(false);
    });

    describe('network mismatch', () => {
        const mismatch = { networkMismatch: { compare: 'asn' as const, withinSeconds: 30 } };

        it('matches a report from a different network soon after the page load', () => {
            const firstTouch = { asn: 12849, country: 'IL', at: NOW - 3000 };
            expect(matchesBotRuleConditions(mismatch, signals({ firstTouch }))).toBe(true);
        });

        it('does not match when the networks are the same', () => {
            const firstTouch = { asn: 45102, country: 'SG', at: NOW - 3000 };
            expect(matchesBotRuleConditions(mismatch, signals({ firstTouch }))).toBe(false);
        });

        it('does not match outside the time window', () => {
            const firstTouch = { asn: 12849, country: 'IL', at: NOW - 31_000 };
            expect(matchesBotRuleConditions(mismatch, signals({ firstTouch }))).toBe(false);
        });

        it('does not match without a remembered page load or on a page load itself', () => {
            expect(matchesBotRuleConditions(mismatch, signals())).toBe(false);
            const firstTouch = { asn: 12849, country: 'IL', at: NOW - 3000 };
            expect(matchesBotRuleConditions(mismatch, signals({ eventType: 'bootstrap', firstTouch }))).toBe(false);
        });

        it('can compare countries instead of networks', () => {
            const firstTouch = { asn: 45102, country: 'IL', at: NOW - 3000 };
            expect(matchesBotRuleConditions({ networkMismatch: { compare: 'country', withinSeconds: 30 } }, signals({ firstTouch }))).toBe(true);
        });
    });
});

describe('selectBotRuleMatch', () => {
    it('never matches a logged-in visitor', () => {
        expect(selectBotRuleMatch([rule()], signals({ loggedIn: true }))).toBeNull();
    });

    it('skips an expired rule', () => {
        expect(selectBotRuleMatch([rule({ expiresAt: NOW - 1 })], signals())).toBeNull();
        expect(selectBotRuleMatch([rule({ expiresAt: NOW + 1 })], signals())).not.toBeNull();
    });

    it('prefers a label rule over a monitor rule listed before it', () => {
        const match = selectBotRuleMatch([
            rule({ id: 'watching', mode: 'monitor' }),
            rule({ id: 'labeling', mode: 'label', label: 'scanner' })
        ], signals());
        expect(match).toEqual({ ruleId: 'labeling', label: 'scanner', mode: 'label' });
    });

    it('falls back to the first monitor rule when no label rule matches', () => {
        const match = selectBotRuleMatch([
            rule({ id: 'other', conditions: { asns: [1] } }),
            rule({ id: 'watching', mode: 'monitor' })
        ], signals());
        expect(match?.ruleId).toBe('watching');
    });
});

describe('applyBotRules', () => {
    const matcher: IBotRuleMatcher = { match: s => selectBotRuleMatch([rule()], s) };

    it('replaces a human verdict with the rule label in label mode', () => {
        expect(applyBotRules('human', matcher, signals())).toEqual({ botClass: 'bot_other', botRule: 'r1' });
    });

    it('records a monitor match without changing the verdict', () => {
        const monitor: IBotRuleMatcher = { match: s => selectBotRuleMatch([rule({ mode: 'monitor' })], s) };
        expect(applyBotRules('human', monitor, signals())).toEqual({ botClass: 'human', botRule: 'r1' });
    });

    it('leaves a built-in bot verdict alone', () => {
        expect(applyBotRules('search_engine', matcher, signals())).toEqual({ botClass: 'search_engine', botRule: null });
    });

    it('does nothing when no matcher is wired', () => {
        expect(applyBotRules('human', undefined, signals())).toEqual({ botClass: 'human', botRule: null });
    });
});
