/**
 * @fileoverview Unit tests for JSON parsing that keeps large integers exact.
 *
 * The parser sits in front of TronGrid's block responses, so a mistake here is
 * silent in production: a rounded int64 is stored as a confident wrong amount.
 * These tests pin both halves of the contract — integers beyond 2^53 come back
 * as their exact text, and everything else parses exactly as `JSON.parse` does.
 */

import { describe, it, expect } from 'vitest';
import { parseJsonExactIntegers } from '../parseJsonExactIntegers.js';

describe('parseJsonExactIntegers', () => {
    it('keeps an integer beyond 2^53 as its exact decimal text', () => {
        const parsed = parseJsonExactIntegers('{"amount":9223372036854775807,"low":-9007199254740993}');

        expect(parsed).toEqual({ amount: '9223372036854775807', low: '-9007199254740993' });
    });

    it('leaves safe integers, fractions, and exponents as numbers', () => {
        const parsed = parseJsonExactIntegers('{"a":9007199254740991,"b":1.5,"c":1e21,"d":0}');

        expect(parsed).toEqual({ a: 9_007_199_254_740_991, b: 1.5, c: 1e21, d: 0 });
    });

    it('applies inside nested arrays and objects', () => {
        const parsed = parseJsonExactIntegers('[{"callValueInfo":[{"callValue":12345678901234567890}]}]');

        expect(parsed).toEqual([{ callValueInfo: [{ callValue: '12345678901234567890' }] }]);
    });

    it('throws on invalid JSON as JSON.parse does', () => {
        expect(() => parseJsonExactIntegers('{not json')).toThrow(SyntaxError);
    });
});
