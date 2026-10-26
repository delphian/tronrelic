/**
 * Unit tests for normalizing a block header's raw timestamp.
 *
 * Block sync and the chain data repair job both rely on this rule, and a block
 * written with a wrong time lands in the wrong ClickHouse day partition, so the
 * scaled forms TronGrid has returned are pinned here.
 */
import { describe, it, expect } from 'vitest';
import { normalizeBlockTimestamp } from '../normalizeBlockTimestamp.js';

/** A real block time in epoch milliseconds. */
const MILLISECONDS = Date.UTC(2026, 9, 25, 18, 36, 51, 0);

describe('normalizeBlockTimestamp', () => {
    it('keeps a timestamp already in milliseconds', () => {
        expect(normalizeBlockTimestamp(MILLISECONDS)?.getTime()).toBe(MILLISECONDS);
    });

    it('scales down a timestamp reported in microseconds or nanoseconds', () => {
        expect(normalizeBlockTimestamp(MILLISECONDS * 1_000)?.getTime()).toBe(MILLISECONDS);
        expect(normalizeBlockTimestamp(MILLISECONDS * 1_000_000)?.getTime()).toBe(MILLISECONDS);
    });

    it('accepts a timestamp delivered as a string', () => {
        expect(normalizeBlockTimestamp('2026-10-25T18:36:51.000Z')?.getTime()).toBe(MILLISECONDS);
    });

    it('returns null for a value that is not a date', () => {
        expect(normalizeBlockTimestamp('not a time')).toBeNull();
    });
});
