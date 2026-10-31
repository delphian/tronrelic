/**
 * @fileoverview Convert between the bot rule form's text fields and the rule
 * shape the API takes.
 *
 * Why it exists: an operator types lists — networks, countries, browser
 * fragments, paths — as free text, while the API takes arrays and an absent
 * condition must be left out entirely rather than sent empty. Keeping the
 * conversion in one place means the form, the "start a rule from this
 * suggestion" action, and the rule list summary read the same fields the same
 * way. The server still validates everything; this file only shapes input.
 */

import type { BotRuleLabel, BotRuleMode, IBotRule, IBotRuleConditions, IBotRuleInput, IBotRuleSuggestion } from '@/types';

/**
 * The form's fields, held as text the way the inputs edit them.
 */
export interface IBotRuleFormState {
    /** Rule name. */
    name: string;
    /** Why the rule exists. */
    note: string;
    /** Bot class applied in label mode. */
    label: BotRuleLabel;
    /** Monitor or label. */
    mode: BotRuleMode;
    /** False pauses the rule. */
    enabled: boolean;
    /** Expiry as a `YYYY-MM-DD` date input value, or empty for none. */
    expiresAt: string;
    /** Network numbers separated by commas or spaces; an `AS` prefix is accepted. */
    asns: string;
    /** Country codes separated by commas or spaces. */
    countries: string;
    /** Browser-identifier fragments, one per line. */
    userAgentContains: string;
    /** Path prefixes separated by commas or spaces. */
    pathPrefixes: string;
    /** Event type, or empty for either. */
    eventType: '' | 'bootstrap' | 'page';
    /** Referrer requirement, or empty for either. */
    referrer: '' | 'absent' | 'present';
    /** What the network-mismatch test compares, or empty to leave it off. */
    mismatchCompare: '' | 'asn' | 'country';
    /** The mismatch window in seconds, as typed. */
    mismatchSeconds: string;
}

/** Default mismatch window offered when the operator switches the test on. */
const DEFAULT_MISMATCH_SECONDS = '30';

/**
 * Split free text into non-empty tokens on commas, spaces, and line breaks.
 *
 * @param text - The field's text.
 * @returns The tokens, trimmed.
 */
function tokens(text: string): string[] {
    return text.split(/[\s,]+/).map(t => t.trim()).filter(Boolean);
}

/**
 * A form with nothing filled in, for a new rule. Starts in monitor mode so a
 * new rule is watched before it changes any figures.
 *
 * @returns Empty form state.
 */
export function emptyBotRuleForm(): IBotRuleFormState {
    return {
        name: '',
        note: '',
        label: 'bot_other',
        mode: 'monitor',
        enabled: true,
        expiresAt: '',
        asns: '',
        countries: '',
        userAgentContains: '',
        pathPrefixes: '',
        eventType: '',
        referrer: '',
        mismatchCompare: '',
        mismatchSeconds: DEFAULT_MISMATCH_SECONDS
    };
}

/**
 * Fill the form from a stored rule, for editing.
 *
 * @param rule - The rule to edit.
 * @returns Form state holding the rule's values.
 */
export function botRuleFormFromRule(rule: IBotRule): IBotRuleFormState {
    const c = rule.conditions;
    return {
        name: rule.name,
        note: rule.note ?? '',
        label: rule.label,
        mode: rule.mode,
        enabled: rule.enabled,
        expiresAt: rule.expiresAt ? rule.expiresAt.slice(0, 10) : '',
        asns: (c.asns ?? []).join(', '),
        countries: (c.countries ?? []).join(', '),
        userAgentContains: (c.userAgentContains ?? []).join('\n'),
        pathPrefixes: (c.pathPrefixes ?? []).join(', '),
        eventType: c.eventType ?? '',
        referrer: c.referrer ?? '',
        mismatchCompare: c.networkMismatch?.compare ?? '',
        mismatchSeconds: c.networkMismatch ? String(c.networkMismatch.withinSeconds) : DEFAULT_MISMATCH_SECONDS
    };
}

/**
 * Start a new rule from a suggested network: its number, its most common
 * browser identifier as a fragment, page reports only, and no referrer —
 * the shape that made it a suggestion. The operator previews and narrows it
 * before saving.
 *
 * @param suggestion - The suggested network.
 * @returns Form state for a new monitor-mode rule.
 */
export function botRuleFormFromSuggestion(suggestion: IBotRuleSuggestion): IBotRuleFormState {
    return {
        ...emptyBotRuleForm(),
        name: `Network AS${suggestion.asn}`,
        note: `Suggested: ${suggestion.cookies} cookies, ${suggestion.events} page reports, ${Math.round(suggestion.noReferrerShare * 100)}% without a referrer.`,
        asns: String(suggestion.asn),
        eventType: 'page',
        referrer: 'absent'
    };
}

/**
 * Build the conditions object the API takes, leaving out every condition the
 * form leaves empty.
 *
 * @param form - The form's fields.
 * @returns The conditions, and the first problem the form can see without the server.
 */
export function botRuleConditionsFromForm(form: IBotRuleFormState): { conditions: IBotRuleConditions; problem: string | null } {
    const conditions: IBotRuleConditions = {};
    let problem: string | null = null;

    const asnTokens = tokens(form.asns).map(t => t.replace(/^as/i, ''));
    if (asnTokens.length > 0) {
        if (asnTokens.some(t => !/^\d{1,10}$/.test(t))) {
            problem = 'Network numbers must be whole numbers, such as 45102 or AS45102';
        }
        conditions.asns = asnTokens.map(Number);
    }
    const countries = tokens(form.countries).map(t => t.toUpperCase());
    if (countries.length > 0) {
        conditions.countries = countries;
    }
    const fragments = form.userAgentContains.split('\n').map(t => t.trim()).filter(Boolean);
    if (fragments.length > 0) {
        conditions.userAgentContains = fragments;
    }
    const prefixes = tokens(form.pathPrefixes);
    if (prefixes.length > 0) {
        conditions.pathPrefixes = prefixes;
    }
    if (form.eventType) {
        conditions.eventType = form.eventType;
    }
    if (form.referrer) {
        conditions.referrer = form.referrer;
    }
    if (form.mismatchCompare) {
        const seconds = Number(form.mismatchSeconds);
        if (!Number.isInteger(seconds)) {
            problem = problem ?? 'The mismatch window must be a whole number of seconds';
        }
        conditions.networkMismatch = { compare: form.mismatchCompare, withinSeconds: seconds };
    }
    return { conditions, problem };
}

/**
 * Build the full rule input the create and update endpoints take.
 *
 * @param form - The form's fields.
 * @returns The rule input, and the first problem the form can see without the server.
 */
export function botRuleInputFromForm(form: IBotRuleFormState): { input: IBotRuleInput; problem: string | null } {
    const { conditions, problem } = botRuleConditionsFromForm(form);
    return {
        input: {
            name: form.name.trim(),
            note: form.note.trim() || null,
            label: form.label,
            mode: form.mode,
            enabled: form.enabled,
            expiresAt: form.expiresAt ? `${form.expiresAt}T00:00:00.000Z` : null,
            conditions
        },
        problem
    };
}

/**
 * Describe a rule's conditions as short phrases for the rule list.
 *
 * @param conditions - The rule's conditions.
 * @returns One phrase per condition, such as "AS45102" or "no referrer".
 */
export function describeBotRuleConditions(conditions: IBotRuleConditions): string[] {
    const parts: string[] = [];
    if (conditions.asns?.length) {
        parts.push(conditions.asns.map(asn => `AS${asn}`).join(' or '));
    }
    if (conditions.countries?.length) {
        parts.push(conditions.countries.join(' or '));
    }
    if (conditions.userAgentContains?.length) {
        parts.push(`browser has ${conditions.userAgentContains.map(f => `"${f}"`).join(' + ')}`);
    }
    if (conditions.pathPrefixes?.length) {
        parts.push(`path ${conditions.pathPrefixes.join(' or ')}`);
    }
    if (conditions.eventType) {
        parts.push(conditions.eventType === 'page' ? 'JavaScript reports' : 'page loads');
    }
    if (conditions.referrer) {
        parts.push(conditions.referrer === 'absent' ? 'no referrer' : 'has a referrer');
    }
    if (conditions.networkMismatch) {
        parts.push(`${conditions.networkMismatch.compare === 'asn' ? 'network' : 'country'} differs from page load within ${conditions.networkMismatch.withinSeconds}s`);
    }
    return parts;
}
