/**
 * Unit tests for turning every integer in a parsed JSON value into decimal text.
 *
 * The helper exists so a contract field has one type at every size, so the
 * tests pin that small integers become strings, that integers the exact parser
 * already returned as strings are left alone, that nesting is followed, and
 * that nothing else changes type.
 */
import { describe, it, expect } from 'vitest';
import { stringifyIntegers } from '../stringifyIntegers.js';

describe('stringifyIntegers', () => {
    it('turns a small integer into its decimal string', () => {
        expect(stringifyIntegers(42)).toBe('42');
        expect(stringifyIntegers(-7)).toBe('-7');
        expect(stringifyIntegers(0)).toBe('0');
    });

    it('leaves strings alone, including large integers already given as text', () => {
        expect(stringifyIntegers('9223372036854775807')).toBe('9223372036854775807');
        expect(stringifyIntegers('41a614f8')).toBe('41a614f8');
    });

    it('follows arrays and nested objects', () => {
        expect(stringifyIntegers({ votes: [{ vote_count: 5 }], new_contract: { call_value: 10 } })).toEqual({
            votes: [{ vote_count: '5' }],
            new_contract: { call_value: '10' }
        });
    });

    it('leaves fractions, booleans, null, and undefined as they are', () => {
        expect(stringifyIntegers({ ratio: 1.5, flag: true, empty: null, missing: undefined })).toEqual({
            ratio: 1.5,
            flag: true,
            empty: null,
            missing: undefined
        });
    });

    it('does not modify its input', () => {
        const input = { amount: 1, nested: [2] };
        stringifyIntegers(input);
        expect(input).toEqual({ amount: 1, nested: [2] });
    });
});
