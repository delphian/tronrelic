/**
 * @fileoverview Validate and normalise bot rule input.
 *
 * ## Why This Exists
 *
 * Bot rules arrive from two untrusted places: the admin form and an AI agent's
 * tool call. Both must be held to the same limits, because a rule is evaluated
 * on every traffic event and an over-broad one silently mislabels real
 * visitors. Keeping the checks in one function means the REST controller, the
 * AI tool, and the preview endpoint cannot disagree about what a valid rule is.
 *
 * Normalisation happens here too: browser-identifier fragments are lower-cased
 * and country codes upper-cased once, so the per-event matcher compares
 * without converting case on every request.
 */

import { BOT_RULE_LABELS } from '@/types';
import type { BotRuleLabel, BotRuleMode, IBotRuleConditions, IBotRuleInput, IBotRuleNetworkMismatch } from '@/types';
import { isStorableCountryCode, parseAsn } from './traffic.service.js';
import { hasNarrowingCondition } from './bot-rule-matcher.js';

/** Longest rule name accepted. */
const MAX_NAME_LENGTH = 80;
/** Longest rule note accepted. */
const MAX_NOTE_LENGTH = 500;
/** Most networks one rule may list. */
const MAX_ASNS = 50;
/** Most countries one rule may list. */
const MAX_COUNTRIES = 50;
/** Most browser-identifier fragments one rule may require. */
const MAX_UA_FRAGMENTS = 10;
/** Shortest browser-identifier fragment; one or two letters would match almost anything. */
const MIN_UA_FRAGMENT_LENGTH = 3;
/** Longest browser-identifier fragment. */
const MAX_UA_FRAGMENT_LENGTH = 200;
/** Most path prefixes one rule may list. */
const MAX_PATH_PREFIXES = 20;
/** Longest path prefix. */
const MAX_PATH_PREFIX_LENGTH = 200;
/** Longest gap the network-mismatch condition may compare, matching the first-touch store's expiry. */
export const MAX_MISMATCH_SECONDS = 3600;

/** Modes a rule may be saved in. */
const BOT_RULE_MODES: readonly BotRuleMode[] = ['monitor', 'label'];

/**
 * Thrown when rule input breaks a limit. The controller maps it to HTTP 400 and
 * the AI tool returns its message, so the text must say what to fix.
 */
export class BotRuleValidationError extends Error {
    /**
     * @param message - Description of the rejected input, written for the person or model correcting it.
     */
    constructor(message: string) {
        super(message);
        this.name = 'BotRuleValidationError';
    }
}

/**
 * Read an optional array field, rejecting anything that is present but not an array.
 *
 * @param value - The raw field.
 * @param field - Field name for the error message.
 * @param max - Most entries allowed.
 * @returns The array, or undefined when the field was absent.
 */
function readArray(value: unknown, field: string, max: number): unknown[] | undefined {
    let result: unknown[] | undefined;
    if (value !== undefined && value !== null) {
        if (!Array.isArray(value)) {
            throw new BotRuleValidationError(`${field} must be an array`);
        }
        if (value.length > max) {
            throw new BotRuleValidationError(`${field} may hold at most ${max} entries`);
        }
        result = value;
    }
    return result;
}

/**
 * Validate the network list.
 *
 * @param value - Raw `asns` field.
 * @returns De-duplicated ASNs, or undefined when none were given.
 */
function readAsns(value: unknown): number[] | undefined {
    const raw = readArray(value, 'conditions.asns', MAX_ASNS);
    let result: number[] | undefined;
    if (raw && raw.length > 0) {
        const asns = raw.map(entry => {
            const asn = parseAsn(typeof entry === 'number' || typeof entry === 'string' ? String(entry) : undefined);
            if (asn === null) {
                throw new BotRuleValidationError(`conditions.asns has an invalid network number: ${String(entry)}. Use whole numbers between 1 and 4294967295`);
            }
            return asn;
        });
        result = [...new Set(asns)];
    }
    return result;
}

/**
 * Validate the country list.
 *
 * @param value - Raw `countries` field.
 * @returns De-duplicated upper-case codes, or undefined when none were given.
 */
function readCountries(value: unknown): string[] | undefined {
    const raw = readArray(value, 'conditions.countries', MAX_COUNTRIES);
    let result: string[] | undefined;
    if (raw && raw.length > 0) {
        const countries = raw.map(entry => {
            const code = typeof entry === 'string' ? entry.trim().toUpperCase() : '';
            if (!isStorableCountryCode(code)) {
                throw new BotRuleValidationError(`conditions.countries has an invalid code: ${String(entry)}. Use two-letter ISO codes such as SG`);
            }
            return code;
        });
        result = [...new Set(countries)];
    }
    return result;
}

/**
 * Validate the browser-identifier fragments.
 *
 * @param value - Raw `userAgentContains` field.
 * @returns De-duplicated lower-case fragments, or undefined when none were given.
 */
function readUserAgentFragments(value: unknown): string[] | undefined {
    const raw = readArray(value, 'conditions.userAgentContains', MAX_UA_FRAGMENTS);
    let result: string[] | undefined;
    if (raw && raw.length > 0) {
        const fragments = raw.map(entry => {
            const fragment = typeof entry === 'string' ? entry.trim().toLowerCase() : '';
            if (fragment.length < MIN_UA_FRAGMENT_LENGTH || fragment.length > MAX_UA_FRAGMENT_LENGTH) {
                throw new BotRuleValidationError(
                    `conditions.userAgentContains entries must be ${MIN_UA_FRAGMENT_LENGTH} to ${MAX_UA_FRAGMENT_LENGTH} characters`
                );
            }
            return fragment;
        });
        result = [...new Set(fragments)];
    }
    return result;
}

/**
 * Validate the path prefixes.
 *
 * @param value - Raw `pathPrefixes` field.
 * @returns De-duplicated prefixes, or undefined when none were given.
 */
function readPathPrefixes(value: unknown): string[] | undefined {
    const raw = readArray(value, 'conditions.pathPrefixes', MAX_PATH_PREFIXES);
    let result: string[] | undefined;
    if (raw && raw.length > 0) {
        const prefixes = raw.map(entry => {
            const prefix = typeof entry === 'string' ? entry.trim() : '';
            if (!prefix.startsWith('/') || prefix.length > MAX_PATH_PREFIX_LENGTH) {
                throw new BotRuleValidationError(
                    `conditions.pathPrefixes entries must start with "/" and be at most ${MAX_PATH_PREFIX_LENGTH} characters`
                );
            }
            return prefix;
        });
        result = [...new Set(prefixes)];
    }
    return result;
}

/**
 * Validate the network-mismatch condition.
 *
 * @param value - Raw `networkMismatch` field.
 * @returns The condition, or undefined when it was absent.
 */
function readNetworkMismatch(value: unknown): IBotRuleNetworkMismatch | undefined {
    let result: IBotRuleNetworkMismatch | undefined;
    if (value !== undefined && value !== null) {
        const raw = value as Record<string, unknown>;
        if (typeof value !== 'object' || (raw.compare !== 'asn' && raw.compare !== 'country')) {
            throw new BotRuleValidationError('conditions.networkMismatch.compare must be "asn" or "country"');
        }
        const seconds = raw.withinSeconds;
        if (typeof seconds !== 'number' || !Number.isInteger(seconds) || seconds < 1 || seconds > MAX_MISMATCH_SECONDS) {
            throw new BotRuleValidationError(`conditions.networkMismatch.withinSeconds must be a whole number from 1 to ${MAX_MISMATCH_SECONDS}`);
        }
        result = { compare: raw.compare, withinSeconds: seconds };
    }
    return result;
}

/**
 * Validate and normalise a rule's conditions. Only conditions that were set
 * appear on the result, so the stored document carries no empty lists.
 *
 * @param value - Raw `conditions` object.
 * @returns Normalised conditions.
 * @throws BotRuleValidationError when a value breaks a limit or no narrowing condition is set.
 */
export function validateBotRuleConditions(value: unknown): IBotRuleConditions {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new BotRuleValidationError('conditions must be an object');
    }
    const raw = value as Record<string, unknown>;
    const conditions: IBotRuleConditions = {};

    const asns = readAsns(raw.asns);
    if (asns) {
        conditions.asns = asns;
    }
    const countries = readCountries(raw.countries);
    if (countries) {
        conditions.countries = countries;
    }
    const userAgentContains = readUserAgentFragments(raw.userAgentContains);
    if (userAgentContains) {
        conditions.userAgentContains = userAgentContains;
    }
    const pathPrefixes = readPathPrefixes(raw.pathPrefixes);
    if (pathPrefixes) {
        conditions.pathPrefixes = pathPrefixes;
    }
    if (raw.eventType !== undefined && raw.eventType !== null) {
        if (raw.eventType !== 'bootstrap' && raw.eventType !== 'page') {
            throw new BotRuleValidationError('conditions.eventType must be "bootstrap" or "page"');
        }
        conditions.eventType = raw.eventType;
    }
    if (raw.referrer !== undefined && raw.referrer !== null) {
        if (raw.referrer !== 'absent' && raw.referrer !== 'present') {
            throw new BotRuleValidationError('conditions.referrer must be "absent" or "present"');
        }
        conditions.referrer = raw.referrer;
    }
    const networkMismatch = readNetworkMismatch(raw.networkMismatch);
    if (networkMismatch) {
        if (conditions.eventType === 'bootstrap') {
            throw new BotRuleValidationError('conditions.networkMismatch applies to page events only, so it cannot be combined with eventType "bootstrap"');
        }
        conditions.networkMismatch = networkMismatch;
    }

    if (!hasNarrowingCondition(conditions)) {
        throw new BotRuleValidationError(
            'Set at least one of conditions.asns, countries, userAgentContains, pathPrefixes, or networkMismatch. ' +
            'Event type and referrer alone would match most traffic'
        );
    }
    return conditions;
}

/**
 * Validate and normalise a full rule.
 *
 * @param value - Raw request body or tool input.
 * @returns The normalised rule input, with `enabled` defaulted to true and `note` and `expiresAt` to null.
 * @throws BotRuleValidationError when any field is invalid.
 */
export function validateBotRuleInput(value: unknown): Required<IBotRuleInput> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new BotRuleValidationError('rule must be an object');
    }
    const raw = value as Record<string, unknown>;

    const name = typeof raw.name === 'string' ? raw.name.trim() : '';
    if (!name || name.length > MAX_NAME_LENGTH) {
        throw new BotRuleValidationError(`name is required and must be at most ${MAX_NAME_LENGTH} characters`);
    }

    let note: string | null = null;
    if (raw.note !== undefined && raw.note !== null) {
        if (typeof raw.note !== 'string' || raw.note.length > MAX_NOTE_LENGTH) {
            throw new BotRuleValidationError(`note must be text of at most ${MAX_NOTE_LENGTH} characters`);
        }
        note = raw.note.trim() || null;
    }

    if (typeof raw.label !== 'string' || !(BOT_RULE_LABELS as readonly string[]).includes(raw.label)) {
        throw new BotRuleValidationError(`label must be one of: ${BOT_RULE_LABELS.join(', ')}`);
    }
    const label = raw.label as BotRuleLabel;

    if (typeof raw.mode !== 'string' || !(BOT_RULE_MODES as readonly string[]).includes(raw.mode)) {
        throw new BotRuleValidationError('mode must be "monitor" or "label"');
    }
    const mode = raw.mode as BotRuleMode;

    if (raw.enabled !== undefined && typeof raw.enabled !== 'boolean') {
        throw new BotRuleValidationError('enabled must be true or false');
    }
    const enabled = raw.enabled !== false;

    let expiresAt: string | null = null;
    if (raw.expiresAt !== undefined && raw.expiresAt !== null && raw.expiresAt !== '') {
        const parsed = typeof raw.expiresAt === 'string' ? new Date(raw.expiresAt) : new Date(NaN);
        if (Number.isNaN(parsed.getTime())) {
            throw new BotRuleValidationError('expiresAt must be an ISO-8601 date, or null for no expiry');
        }
        expiresAt = parsed.toISOString();
    }

    return {
        name,
        note,
        conditions: validateBotRuleConditions(raw.conditions),
        label,
        mode,
        enabled,
        expiresAt
    };
}
