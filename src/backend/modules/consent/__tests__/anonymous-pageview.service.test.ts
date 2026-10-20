/**
 * @fileoverview Tests for `AnonymousPageviewService`: daily counting, the
 * automated-browser filter, and the zero-filled window the admin page reads.
 */

import { describe, it, expect } from 'vitest';
import { createMockDatabaseService } from '../../../tests/vitest/mocks/database-service.js';
import { AnonymousPageviewService } from '../services/anonymous-pageview.service.js';

const DAY_ONE = new Date(Date.UTC(2026, 9, 19, 23, 0, 0));
const DAY_TWO = new Date(Date.UTC(2026, 9, 20, 1, 0, 0));

describe('AnonymousPageviewService', () => {
    it('counts page views per UTC day and fills days with none as zero', async () => {
        const service = new AnonymousPageviewService(createMockDatabaseService());
        await service.record({}, DAY_ONE);
        await service.record({}, DAY_TWO);
        await service.record({ automated: false }, DAY_TWO);

        const stats = await service.getStats(3, DAY_TWO);
        expect(stats.windowStart).toBe('2026-10-18');
        expect(stats.windowEnd).toBe('2026-10-20');
        expect(stats.total).toBe(3);
        expect(stats.byDay).toEqual([
            { day: '2026-10-18', count: 0 },
            { day: '2026-10-19', count: 1 },
            { day: '2026-10-20', count: 2 }
        ]);
    });

    it('does not count a browser that reports automation', async () => {
        const service = new AnonymousPageviewService(createMockDatabaseService());
        expect(await service.record({ automated: true }, DAY_TWO)).toBe(false);
        expect((await service.getStats(1, DAY_TWO)).total).toBe(0);
    });

    it('clamps the window to between 1 and 365 days', async () => {
        const service = new AnonymousPageviewService(createMockDatabaseService());
        expect((await service.getStats(0, DAY_TWO)).days).toBe(1);
        expect((await service.getStats(1000, DAY_TWO)).days).toBe(365);
        expect((await service.getStats(Number.NaN, DAY_TWO)).days).toBe(30);
    });
});
