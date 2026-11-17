/**
 * Tests for buildNiceTicks, the helper that gives chart value axes round tick
 * labels. It exists because ticks placed at even fractions of the range read
 * 407.333 and 4,020.333, and a reader took those labels for real figures.
 */
import { describe, expect, it } from 'vitest';
import { buildNiceTicks } from '../buildNiceTicks';

describe('buildNiceTicks', () => {
    it('labels the SEO impressions range with round thousands', () => {
        const axis = buildNiceTicks(2191.667, 25639);
        expect(axis.ticks).toEqual([0, 10000, 20000, 30000]);
        expect(axis.min).toBe(0);
        expect(axis.max).toBe(30000);
    });

    it('widens the axis to multiples of the step so the data sits inside it', () => {
        const axis = buildNiceTicks(22191, 25639);
        expect(axis.min).toBeLessThanOrEqual(22191);
        expect(axis.max).toBeGreaterThanOrEqual(25639);
        expect(axis.ticks).toEqual([22000, 23000, 24000, 25000, 26000]);
    });

    it('keeps a bound the caller fixed and labels only round values inside it', () => {
        const axis = buildNiceTicks(0, 407.333, { keepMin: true });
        expect(axis.min).toBe(0);
        expect(axis.ticks).toEqual([0, 100, 200, 300, 400, 500]);
    });

    it('labels both fixed bounds when they are multiples of the step', () => {
        const axis = buildNiceTicks(0, 100, { keepMin: true, keepMax: true });
        expect(axis).toEqual({ min: 0, max: 100, ticks: [0, 50, 100] });
    });

    it('keeps fixed bounds that are not multiples of the step and labels only round values inside them', () => {
        const axis = buildNiceTicks(3, 97, { keepMin: true, keepMax: true });
        expect(axis.min).toBe(3);
        expect(axis.max).toBe(97);
        expect(axis.ticks).toEqual([50]);
    });

    it('labels zero on an axis that crosses it', () => {
        const axis = buildNiceTicks(-37, 82);
        expect(axis.ticks).toContain(0);
        expect(axis.ticks[0]).toBeLessThanOrEqual(-37);
    });

    it('labels small fractional ranges without floating-point noise', () => {
        const axis = buildNiceTicks(0.1, 0.4);
        expect(axis.ticks).toEqual([0.1, 0.2, 0.3, 0.4]);
    });

    it('never labels negative zero', () => {
        const axis = buildNiceTicks(-0.5, 0.5);
        expect(axis.ticks.some(tick => Object.is(tick, -0))).toBe(false);
    });
});
