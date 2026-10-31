/**
 * @fileoverview Evaluate operator bot rules against one traffic event.
 *
 * ## Why This Exists
 *
 * The built-in classifier catches crawlers that name themselves, scanners that
 * probe for files, and browsers that report automation. It cannot catch a fleet
 * that runs real Chrome, hides the automation flag, and sends a stock browser
 * identifier. Those are recognisable only from data an operator gathers —
 * their network, country, exact browser build, the pages they read — so the
 * operator records that as bot rules and this file applies them.
 *
 * ## Design Decisions
 *
 * - **Pure functions.** Matching reads only its arguments, so the ingestion
 *   path, the redirect beacon, and the tests all evaluate rules identically.
 * - **Toward bot only.** Rules run only on events the built-in classifier left
 *   as `human`, and never on a logged-in visitor, so a rule can never undo a
 *   built-in label or count an account holder as a bot.
 * - **No regular expressions.** Text conditions use `includes` and
 *   `startsWith` on length-capped input, the same rule the built-in classifier
 *   follows, so an operator-entered pattern cannot make a request slow.
 */

import type { BotRuleLabel, BotRuleMode, IBotRuleConditions } from '@/types';
import type { BotClass } from './bot-classifier.js';
import type { IFirstTouchSnapshot } from './first-touch-store.js';

/** Longest browser identifier or path compared, matching the classifier's cap. */
const MAX_SIGNAL_LENGTH = 500;

/**
 * Everything a rule may test, gathered from one request.
 */
export interface IBotRuleSignals {
    /** `bootstrap` page load, `page` JavaScript report, or a `redirect` hit. */
    eventType: 'bootstrap' | 'page' | 'redirect';
    /** True when the request carried a Better Auth session. Rules never match these. */
    loggedIn: boolean;
    /** Network number from Cloudflare, or null when not recorded. */
    asn: number | null;
    /** Two-letter country code, or null when not recorded. */
    country: string | null;
    /** Raw browser identifier, or null/undefined when absent. */
    userAgent: string | null | undefined;
    /** Sanitized request path. */
    path: string;
    /**
     * The referrer the event is judged by: the `Referer` header on a page load
     * or redirect, and the browser-reported landing referrer on a page report.
     */
    referrer: string | null | undefined;
    /** The same cookie's recent page load, on `page` events only; null otherwise. */
    firstTouch: IFirstTouchSnapshot | null;
    /** Evaluation time in epoch milliseconds, for expiry and the mismatch window. */
    now: number;
}

/**
 * A rule in the form the matcher evaluates: already validated and normalised,
 * with its expiry as a number so the per-event check does no date parsing.
 */
export interface ICompiledBotRule {
    /** Rule id, written to `traffic_events.bot_rule` on a match. */
    id: string;
    /** Label applied in `label` mode. */
    label: BotRuleLabel;
    /** Whether a match changes the label or is only recorded. */
    mode: BotRuleMode;
    /** Conditions, with text lower-cased where matching ignores case. */
    conditions: IBotRuleConditions;
    /** Expiry in epoch milliseconds, or null for none. */
    expiresAt: number | null;
}

/**
 * The rule an event matched.
 */
export interface IBotRuleMatch {
    /** Id of the matching rule. */
    ruleId: string;
    /** The rule's label. */
    label: BotRuleLabel;
    /** The rule's mode, which decides whether the label is applied. */
    mode: BotRuleMode;
}

/**
 * The one call event ingestion needs from the rule set. Declared separately so
 * ingestion depends on the lookup rather than the whole service, and tests can
 * supply a stub.
 */
export interface IBotRuleMatcher {
    /**
     * Find the rule an event matches.
     *
     * @param signals - The event's request signals.
     * @returns The match, or null when no active rule matches.
     */
    match(signals: IBotRuleSignals): IBotRuleMatch | null;
}

/**
 * Result of applying the rules on top of the built-in verdict.
 */
export interface IBotRuleOutcome {
    /** The bot class to store on the event. */
    botClass: BotClass;
    /** The id of the rule that matched, or null. Recorded in monitor mode too. */
    botRule: string | null;
}

/**
 * Decide whether an event's referrer counts as absent.
 *
 * @param referrer - The referrer the event is judged by.
 * @returns True when there is no referrer or it is blank.
 */
function isReferrerAbsent(referrer: string | null | undefined): boolean {
    return !referrer || referrer.trim() === '';
}

/**
 * Test the `networkMismatch` condition: the JavaScript report arrived soon after
 * the same cookie's page load but from a different network or country.
 *
 * @param conditions - The rule's conditions; only `networkMismatch` is read.
 * @param signals - The event's signals.
 * @returns True when the mismatch condition holds.
 */
function matchesNetworkMismatch(conditions: IBotRuleConditions, signals: IBotRuleSignals): boolean {
    let result = false;
    const mismatch = conditions.networkMismatch;
    const firstTouch = signals.firstTouch;
    if (mismatch && signals.eventType === 'page' && firstTouch) {
        const elapsed = signals.now - firstTouch.at;
        if (elapsed >= 0 && elapsed <= mismatch.withinSeconds * 1000) {
            const before = mismatch.compare === 'asn' ? firstTouch.asn : firstTouch.country;
            const after = mismatch.compare === 'asn' ? signals.asn : signals.country;
            result = before !== null && after !== null && before !== after;
        }
    }
    return result;
}

/**
 * Report whether a set of conditions narrows the match enough to be saved. The
 * event-type and referrer conditions describe most traffic on their own, so a
 * rule must also name a network, country, browser identifier, path, or the
 * network-mismatch test.
 *
 * @param conditions - Conditions to inspect.
 * @returns True when at least one narrowing condition is set.
 */
export function hasNarrowingCondition(conditions: IBotRuleConditions): boolean {
    return Boolean(
        (conditions.asns && conditions.asns.length > 0) ||
        (conditions.countries && conditions.countries.length > 0) ||
        (conditions.userAgentContains && conditions.userAgentContains.length > 0) ||
        (conditions.pathPrefixes && conditions.pathPrefixes.length > 0) ||
        conditions.networkMismatch
    );
}

/**
 * Test every condition a rule sets against one event. All set conditions must
 * hold. A rule with no narrowing condition never matches, as a second guard
 * behind validation.
 *
 * @param conditions - Normalised conditions; `userAgentContains` is lower-cased.
 * @param signals - The event's signals.
 * @returns True when the event satisfies every condition.
 */
export function matchesBotRuleConditions(conditions: IBotRuleConditions, signals: IBotRuleSignals): boolean {
    let matched = hasNarrowingCondition(conditions);

    if (matched && conditions.asns && conditions.asns.length > 0) {
        matched = signals.asn !== null && conditions.asns.includes(signals.asn);
    }
    if (matched && conditions.countries && conditions.countries.length > 0) {
        matched = signals.country !== null && conditions.countries.includes(signals.country.toUpperCase());
    }
    if (matched && conditions.userAgentContains && conditions.userAgentContains.length > 0) {
        const ua = (signals.userAgent ?? '').slice(0, MAX_SIGNAL_LENGTH).toLowerCase();
        matched = conditions.userAgentContains.every(fragment => ua.includes(fragment));
    }
    if (matched && conditions.pathPrefixes && conditions.pathPrefixes.length > 0) {
        const path = signals.path.slice(0, MAX_SIGNAL_LENGTH);
        matched = conditions.pathPrefixes.some(prefix => path.startsWith(prefix));
    }
    if (matched && conditions.eventType) {
        matched = signals.eventType === conditions.eventType;
    }
    if (matched && conditions.referrer) {
        const absent = isReferrerAbsent(signals.referrer);
        matched = conditions.referrer === 'absent' ? absent : !absent;
    }
    if (matched && conditions.networkMismatch) {
        matched = matchesNetworkMismatch(conditions, signals);
    }
    return matched;
}

/**
 * Pick the rule an event matches. A rule in `label` mode wins over one in
 * `monitor` mode, so watching a new rule never hides a label an established
 * rule would apply. Among rules of the same mode, the first in the list wins;
 * the service orders them oldest first so the outcome is stable.
 *
 * @param rules - Active rules, oldest first.
 * @param signals - The event's signals.
 * @returns The winning match, or null when none matches.
 */
export function selectBotRuleMatch(rules: readonly ICompiledBotRule[], signals: IBotRuleSignals): IBotRuleMatch | null {
    let labelMatch: ICompiledBotRule | null = null;
    let monitorMatch: ICompiledBotRule | null = null;
    if (!signals.loggedIn) {
        for (const rule of rules) {
            const live = rule.expiresAt === null || rule.expiresAt > signals.now;
            const needed = rule.mode === 'label' ? labelMatch === null : monitorMatch === null;
            if (live && needed && matchesBotRuleConditions(rule.conditions, signals)) {
                if (rule.mode === 'label') {
                    labelMatch = rule;
                } else {
                    monitorMatch = rule;
                }
            }
            if (labelMatch) {
                break;
            }
        }
    }
    const winner = labelMatch ?? monitorMatch;
    return winner ? { ruleId: winner.id, label: winner.label, mode: winner.mode } : null;
}

/**
 * Apply the operator's rules on top of the built-in classifier's verdict.
 * Shared by event ingestion and the redirect beacon so both follow one rule:
 * only a `human` verdict is ever consulted, a `label`-mode match replaces it,
 * and a `monitor`-mode match is recorded without changing it.
 *
 * @param builtIn - The verdict from `classifyTrafficRequest`.
 * @param matcher - The active rule set, or undefined when none is wired.
 * @param signals - The event's signals.
 * @returns The bot class to store and the id of the matching rule.
 */
export function applyBotRules(
    builtIn: BotClass,
    matcher: IBotRuleMatcher | undefined,
    signals: IBotRuleSignals
): IBotRuleOutcome {
    let outcome: IBotRuleOutcome = { botClass: builtIn, botRule: null };
    if (builtIn === 'human' && matcher) {
        const match = matcher.match(signals);
        if (match) {
            outcome = {
                botClass: match.mode === 'label' ? match.label : builtIn,
                botRule: match.ruleId
            };
        }
    }
    return outcome;
}
