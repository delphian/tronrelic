/// <reference types="vitest" />

/**
 * @fileoverview Unit tests for TrafficService's redirect-analytics surface.
 *
 * Covers the `redirect_events` write (`recordRedirectHit`) and the windowed
 * read (`getRedirectAnalytics`): fire-and-forget insert semantics, the
 * ClickHouse-unavailable no-op/empty contract, the human/bot total split, and
 * the zero-filled bucket series. The read is deliberately standalone (no
 * candidate_uid ignore-list filter), so these tests also pin that redirect rows
 * land in their own table, never `traffic_events`.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { IClickHouseService, ISystemLogService } from '@/types';
import { TrafficService, type IRedirectHitInput } from '../services/traffic.service.js';

/**
 * Minimal logger double — every method is a spy so warn/info paths can be
 * asserted without pulling in pino.
 *
 * @returns A logger whose `child()` returns itself.
 */
function createMockLogger(): ISystemLogService {
    const fns = {
        debug: vi.fn(), info: vi.fn(), warn: vi.fn(),
        error: vi.fn(), fatal: vi.fn(), trace: vi.fn(),
        child: vi.fn(() => fns)
    } as unknown as ISystemLogService;
    return fns;
}

/**
 * ClickHouse double whose `query()` routes on SQL fragments so the three
 * analytics reads (totals / series / per-pattern) can return distinct rows —
 * the shared-queue mock in the sibling suite cannot express that.
 *
 * @param handlers - Row sets keyed by which read they answer.
 * @returns A ClickHouse mock plus the captured insert log.
 */
function createRoutingClickHouse(handlers: {
    totals?: unknown[];
    series?: unknown[];
    byPattern?: unknown[];
}): IClickHouseService & { inserts: Array<{ table: string; rows: unknown[] }>; error?: Error } {
    const inserts: Array<{ table: string; rows: unknown[] }> = [];
    const mock = {
        inserts,
        error: undefined as Error | undefined,
        async connect() { /* noop */ },
        isConnected() { return true; },
        async ping() { return true; },
        async close() { /* noop */ },
        async exec() { /* noop */ },
        async insert(table: string, rows: unknown[]) {
            if (mock.error) throw mock.error;
            inserts.push({ table, rows });
        },
        async query<T>(sql: string): Promise<T[]> {
            if (mock.error) throw mock.error;
            if (sql.includes('allTotal')) return (handlers.totals ?? []) as T[];
            if (sql.includes('GROUP BY pattern')) return (handlers.byPattern ?? []) as T[];
            if (sql.includes('GROUP BY bucket')) return (handlers.series ?? []) as T[];
            return [] as T[];
        }
    };
    return mock as unknown as IClickHouseService & { inserts: Array<{ table: string; rows: unknown[] }>; error?: Error };
}

const sampleHit: IRedirectHitInput = {
    pattern: '/tron-forum',
    path: '/tron-forum/thread/9',
    destination: '/forum',
    permanent: true,
    botClass: 'human',
    country: 'US'
};

describe('TrafficService redirect analytics', () => {
    beforeEach(() => {
        TrafficService.resetInstance();
    });

    describe('recordRedirectHit()', () => {
        it('no-ops when ClickHouse is unavailable', () => {
            TrafficService.setDependencies(undefined, createMockLogger());
            expect(() => TrafficService.getInstance().recordRedirectHit(sampleHit)).not.toThrow();
        });

        it('dispatches an insert to redirect_events with the serialized row', async () => {
            const ch = createRoutingClickHouse({});
            TrafficService.setDependencies(ch, createMockLogger());

            const ret = TrafficService.getInstance().recordRedirectHit(sampleHit);
            expect(ret).toBeUndefined();
            await Promise.resolve();

            expect(ch.inserts).toHaveLength(1);
            expect(ch.inserts[0].table).toBe('redirect_events');
            const row = ch.inserts[0].rows[0] as Record<string, unknown>;
            expect(row.pattern).toBe('/tron-forum');
            expect(row.path).toBe('/tron-forum/thread/9');
            expect(row.destination).toBe('/forum');
            expect(row.permanent).toBe(1);
            expect(row.bot_class).toBe('human');
            expect(row.country).toBe('US');
            // ClickHouse native DateTime64(3) form, UTC, no 'T'/'Z' suffix.
            expect(row.timestamp).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/);
        });

        it('stores permanent=0 for a 302 and country="" when unknown', async () => {
            const ch = createRoutingClickHouse({});
            TrafficService.setDependencies(ch, createMockLogger());

            TrafficService.getInstance().recordRedirectHit({ ...sampleHit, permanent: false, country: null });
            await Promise.resolve();

            const row = ch.inserts[0].rows[0] as Record<string, unknown>;
            expect(row.permanent).toBe(0);
            expect(row.country).toBe('');
        });

        it('swallows ClickHouse failures without throwing', async () => {
            const ch = createRoutingClickHouse({});
            ch.error = new Error('CH down');
            const logger = createMockLogger();
            TrafficService.setDependencies(ch, logger);

            expect(() => TrafficService.getInstance().recordRedirectHit(sampleHit)).not.toThrow();
            await new Promise(resolve => setImmediate(resolve));

            expect(logger.warn).toHaveBeenCalled();
        });
    });

    describe('getRedirectAnalytics()', () => {
        it('returns an empty shape when ClickHouse is unavailable', async () => {
            TrafficService.setDependencies(undefined, createMockLogger());
            const result = await TrafficService.getInstance().getRedirectAnalytics({
                since: new Date('2026-05-01T00:00:00.000Z'),
                until: new Date('2026-05-04T00:00:00.000Z')
            });
            expect(result).toEqual({ granularity: 'day', total: 0, humanTotal: 0, botTotal: 0, series: [], byPattern: [] });
        });

        it('buckets hourly for windows ≤ 48h', async () => {
            TrafficService.setDependencies(undefined, createMockLogger());
            const result = await TrafficService.getInstance().getRedirectAnalytics({
                since: new Date('2026-05-01T00:00:00.000Z'),
                until: new Date('2026-05-02T00:00:00.000Z')
            });
            expect(result.granularity).toBe('hour');
        });

        it('splits human/bot totals and zero-fills the daily series', async () => {
            const ch = createRoutingClickHouse({
                totals: [{ allTotal: 10, humanTotal: 7 }],
                series: [{ bucket: '2026-05-02', hits: 5 }],
                byPattern: [
                    { pattern: '/tron-forum', destination: '/forum', permanent: 1, hits: 5 },
                    { pattern: '/old', destination: '/new', permanent: 0, hits: 2 }
                ]
            });
            TrafficService.setDependencies(ch, createMockLogger());

            const result = await TrafficService.getInstance().getRedirectAnalytics({
                since: new Date('2026-05-01T00:00:00.000Z'),
                until: new Date('2026-05-04T00:00:00.000Z')
            });

            expect(result.granularity).toBe('day');
            expect(result.total).toBe(10);
            expect(result.humanTotal).toBe(7);
            expect(result.botTotal).toBe(3);

            // Daily buckets 05-01..05-04 inclusive, only 05-02 has hits.
            expect(result.series).toHaveLength(4);
            const hit = result.series.find(p => p.bucket === '2026-05-02');
            expect(hit?.hits).toBe(5);
            expect(result.series.filter(p => p.hits === 0)).toHaveLength(3);

            expect(result.byPattern).toHaveLength(2);
            expect(result.byPattern[0]).toEqual({ pattern: '/tron-forum', destination: '/forum', permanent: true, hits: 5 });
            expect(result.byPattern[1].permanent).toBe(false);
        });

        it('reports total as the human count when excludeBots is set', async () => {
            const ch = createRoutingClickHouse({ totals: [{ allTotal: 10, humanTotal: 7 }] });
            TrafficService.setDependencies(ch, createMockLogger());

            const result = await TrafficService.getInstance().getRedirectAnalytics(
                { since: new Date('2026-05-01T00:00:00.000Z'), until: new Date('2026-05-04T00:00:00.000Z') },
                true
            );
            expect(result.total).toBe(7);
            expect(result.humanTotal).toBe(7);
            expect(result.botTotal).toBe(3);
        });
    });
});
