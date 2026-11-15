/**
 * @fileoverview Tests for the limiter that keeps outside-triggered log
 * entries bounded: once per key per window, a ceiling of keys per window
 * reported once, a fresh start each window, and long keys cut.
 */

import { describe, it, expect } from 'vitest';
import { WindowedLogLimiter } from '../WindowedLogLimiter.js';

/** One hour, the window every production caller uses. */
const HOUR_MS = 60 * 60 * 1000;

describe('WindowedLogLimiter', () => {
    it('lets a key through once per window', () => {
        const limiter = new WindowedLogLimiter({ windowMs: HOUR_MS, maxKeys: 10, maxKeyLength: 50 }, () => 1_000);
        expect(limiter.admit('caller-a')).toBe('log');
        expect(limiter.admit('caller-a')).toBe('suppressed');
        expect(limiter.admit('caller-b')).toBe('log');
    });

    it('reports the ceiling once, then suppresses every new key until the window ends', () => {
        let now = 1_000;
        const limiter = new WindowedLogLimiter({ windowMs: HOUR_MS, maxKeys: 2, maxKeyLength: 50 }, () => now);
        expect(limiter.admit('a')).toBe('log');
        expect(limiter.admit('b')).toBe('log');
        expect(limiter.admit('c')).toBe('ceiling-reached');
        expect(limiter.admit('d')).toBe('suppressed');
        expect(limiter.loggedKeys).toBe(2);
        now += HOUR_MS;
        expect(limiter.admit('c')).toBe('log');
        expect(limiter.admit('a')).toBe('log');
    });

    it('treats keys alike up to the length cap as one key', () => {
        const limiter = new WindowedLogLimiter({ windowMs: HOUR_MS, maxKeys: 10, maxKeyLength: 5 }, () => 1_000);
        expect(limiter.admit('abcde-first')).toBe('log');
        expect(limiter.admit('abcde-second')).toBe('suppressed');
    });

    it('reports its window in whole minutes for log entries', () => {
        expect(new WindowedLogLimiter({ windowMs: HOUR_MS, maxKeys: 1, maxKeyLength: 1 }).windowMinutes).toBe(60);
    });
});
