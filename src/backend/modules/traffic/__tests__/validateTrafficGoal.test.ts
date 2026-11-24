/// <reference types="vitest" />

/**
 * @fileoverview Tests for the goal naming and property rules. `ITrafficGoal`
 * promises callers that a malformed goal is refused with an error, so these
 * pin each rule's boundary: a component relying on the promise learns of a
 * mistake from its own tests instead of from a figure that never appears.
 */

import { describe, it, expect } from 'vitest';
import type { ITrafficGoal } from '@/types';
import {
    TrafficGoalValidationError,
    isValidGoalName,
    isValidGoalPropertyKey,
    validateTrafficGoal
} from '../services/validateTrafficGoal.js';

describe('validateTrafficGoal', () => {
    it('accepts a well-formed goal and returns a plain copy of its properties', () => {
        const properties = { market: 'tronsave', placement: 'table', affiliate: 'yes' };
        const result = validateTrafficGoal({ name: 'resource-markets:outbound-click', properties });
        expect(result).toEqual({ name: 'resource-markets:outbound-click', properties });
        // A copy, so a caller mutating its object afterwards cannot change the row.
        expect(result.properties).not.toBe(properties);
    });

    it('treats a goal without properties as having none', () => {
        expect(validateTrafficGoal({ name: 'blog:share' }).properties).toEqual({});
    });

    it.each([
        ['no owner', 'outbound-click'],
        ['upper case', 'Resource-Markets:click'],
        ['empty action', 'resource-markets:'],
        ['a space', 'resource markets:click'],
        ['two separators', 'a:b:c'],
        ['an underscore', 'resource_markets:click']
    ])('refuses a name with %s', (_label, name) => {
        expect(() => validateTrafficGoal({ name })).toThrow(TrafficGoalValidationError);
    });

    it('refuses a name longer than 64 characters and accepts one of exactly 64', () => {
        const exact = `a:${'b'.repeat(62)}`;
        expect(isValidGoalName(exact)).toBe(true);
        expect(() => validateTrafficGoal({ name: `${exact}c` })).toThrow(TrafficGoalValidationError);
    });

    it('refuses more than eight properties', () => {
        const properties = Object.fromEntries(Array.from({ length: 9 }, (_v, i) => [`k${i}`, 'v']));
        expect(() => validateTrafficGoal({ name: 'a:b', properties })).toThrow(/at most 8/);
    });

    it.each([
        ['a leading digit', '1market'],
        ['upper case', 'Market'],
        ['a hyphen', 'market-id'],
        ['33 characters', `m${'a'.repeat(32)}`]
    ])('refuses a property key with %s', (_label, key) => {
        expect(isValidGoalPropertyKey(key)).toBe(false);
        expect(() => validateTrafficGoal({ name: 'a:b', properties: { [key]: 'v' } })).toThrow(TrafficGoalValidationError);
    });

    it('refuses a property value that is not a string or is longer than 128 characters', () => {
        const numeric = { name: 'a:b', properties: { count: 3 } } as unknown as ITrafficGoal;
        expect(() => validateTrafficGoal(numeric)).toThrow(TrafficGoalValidationError);
        expect(() => validateTrafficGoal({ name: 'a:b', properties: { k: 'x'.repeat(129) } })).toThrow(TrafficGoalValidationError);
        expect(validateTrafficGoal({ name: 'a:b', properties: { k: 'x'.repeat(128) } }).properties.k).toHaveLength(128);
    });

    it('refuses properties that are not a plain object', () => {
        const asArray = { name: 'a:b', properties: ['x'] } as unknown as ITrafficGoal;
        const asNull = { name: 'a:b', properties: null } as unknown as ITrafficGoal;
        const asMap = { name: 'a:b', properties: new Map([['k', 'v']]) } as unknown as ITrafficGoal;
        expect(() => validateTrafficGoal(asArray)).toThrow(TrafficGoalValidationError);
        expect(() => validateTrafficGoal(asNull)).toThrow(TrafficGoalValidationError);
        expect(() => validateTrafficGoal(asMap)).toThrow(TrafficGoalValidationError);
    });
});
