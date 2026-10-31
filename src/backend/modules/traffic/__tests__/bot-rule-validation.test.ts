/// <reference types="vitest" />

/**
 * @fileoverview Unit tests for bot rule validation.
 *
 * The admin form and the AI tool both send untrusted rule input through this
 * validation, so these tests pin the limits and the normalisation the matcher
 * depends on.
 */

import { describe, it, expect } from 'vitest';
import { BotRuleValidationError, validateBotRuleConditions, validateBotRuleInput } from '../services/bot-rule-validation.js';

const VALID = {
    name: '  Alibaba SG crawler  ',
    note: 'One page per cookie',
    label: 'bot_other',
    mode: 'monitor',
    conditions: { asns: ['45102', 45102], countries: ['sg'], userAgentContains: ['Chrome/145.0.0.0'], pathPrefixes: ['/vi/'] }
};

describe('validateBotRuleInput', () => {
    it('normalises a valid rule', () => {
        expect(validateBotRuleInput(VALID)).toEqual({
            name: 'Alibaba SG crawler',
            note: 'One page per cookie',
            label: 'bot_other',
            mode: 'monitor',
            enabled: true,
            expiresAt: null,
            conditions: { asns: [45102], countries: ['SG'], userAgentContains: ['chrome/145.0.0.0'], pathPrefixes: ['/vi/'] }
        });
    });

    it('converts an expiry to ISO-8601', () => {
        expect(validateBotRuleInput({ ...VALID, expiresAt: '2027-01-01' }).expiresAt).toBe('2027-01-01T00:00:00.000Z');
    });

    it.each([
        ['a missing name', { ...VALID, name: '' }],
        ['an unknown label', { ...VALID, label: 'human' }],
        ['an unknown mode', { ...VALID, mode: 'block' }],
        ['an unparseable expiry', { ...VALID, expiresAt: 'soon' }],
        ['a non-boolean enabled', { ...VALID, enabled: 'yes' }]
    ])('rejects %s', (_label, input) => {
        expect(() => validateBotRuleInput(input)).toThrow(BotRuleValidationError);
    });
});

describe('validateBotRuleConditions', () => {
    it.each([
        ['no narrowing condition', { eventType: 'page', referrer: 'absent' }],
        ['an invalid network number', { asns: ['AS45102'] }],
        ['a country sentinel', { countries: ['XX'] }],
        ['a too-short browser fragment', { userAgentContains: ['ab'] }],
        ['a path prefix without a leading slash', { pathPrefixes: ['vi/'] }],
        ['an unknown event type', { asns: [1], eventType: 'redirect' }],
        ['a mismatch window over an hour', { networkMismatch: { compare: 'asn', withinSeconds: 3601 } }],
        ['a mismatch on page loads', { networkMismatch: { compare: 'asn', withinSeconds: 30 }, eventType: 'bootstrap' }],
        ['a list that is not an array', { asns: 45102 }],
        ['conditions that are not an object', 'asn 45102']
    ])('rejects %s', (_label, conditions) => {
        expect(() => validateBotRuleConditions(conditions)).toThrow(BotRuleValidationError);
    });

    it('accepts the network-mismatch condition on its own', () => {
        expect(validateBotRuleConditions({ networkMismatch: { compare: 'country', withinSeconds: 30 } })).toEqual({
            networkMismatch: { compare: 'country', withinSeconds: 30 }
        });
    });

    it('drops empty lists rather than storing them', () => {
        expect(validateBotRuleConditions({ asns: [45102], countries: [] })).toEqual({ asns: [45102] });
    });
});
