/// <reference types="vitest" />

/**
 * @fileoverview Pins the checks on an admin's limit change.
 *
 * The admin page is the one place limits change at runtime, so this function
 * is what stops a mistyped value from removing an account's protection.
 */

import { describe, it, expect } from 'vitest';
import { AI_AGENT_ACCOUNT_ID, buildAccountDefinitions } from '../services/buildAccountDefinitions.js';
import { ClickHouseAccountError } from '../services/ClickHouseAccountError.js';
import { mergeLimitPatch } from '../services/mergeLimitPatch.js';

const policy = buildAccountDefinitions('default').find(definition => definition.id === AI_AGENT_ACCOUNT_ID)!.policy!;

describe('mergeLimitPatch', () => {
    it('merges changed fields and keeps the rest', () => {
        const merged = mergeLimitPatch(policy.defaultLimits, policy.ceilings, { maxThreads: 4 });
        expect(merged).toEqual({ ...policy.defaultLimits, maxThreads: 4 });
    });

    it('accepts a value equal to its ceiling', () => {
        const merged = mergeLimitPatch(policy.defaultLimits, policy.ceilings, { maxThreads: policy.ceilings.maxThreads });
        expect(merged.maxThreads).toBe(policy.ceilings.maxThreads);
    });

    it('refuses a value above its ceiling with a 400', () => {
        expect(() => mergeLimitPatch(policy.defaultLimits, policy.ceilings, { maxThreads: policy.ceilings.maxThreads + 1 }))
            .toThrow(ClickHouseAccountError);
    });

    it('refuses zero, negative, fractional, and non-numeric values', () => {
        for (const value of [0, -1, 2.5, '4', null]) {
            expect(() => mergeLimitPatch(policy.defaultLimits, policy.ceilings, { maxThreads: value })).toThrow(ClickHouseAccountError);
        }
    });

    it('refuses an unknown field instead of ignoring it', () => {
        expect(() => mergeLimitPatch(policy.defaultLimits, policy.ceilings, { maxThread: 4 })).toThrow(/Unknown limit/);
    });

    it('refuses an empty patch', () => {
        expect(() => mergeLimitPatch(policy.defaultLimits, policy.ceilings, {})).toThrow(ClickHouseAccountError);
    });
});
