/// <reference types="vitest" />

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { IClickHouseService, ISystemLogService } from '@/types';
import { TrafficService, type ITrafficEvent } from '../services/traffic.service.js';

/**
 * Minimal logger double — every call is a vi.fn so tests can assert on
 * warn/info paths without pulling in pino. `child()` returns the same
 * mock so scoping calls still work.
 */
function createMockLogger(): ISystemLogService {
    const fns = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        fatal: vi.fn(),
        trace: vi.fn(),
        child: vi.fn(() => fns)
    } as unknown as ISystemLogService;
    return fns;
}

/**
 * In-memory IClickHouseService double. Captures inserted rows and lets
 * tests pre-stage rows that `query()` will return.
 */
function createMockClickHouse(): IClickHouseService & {
    inserts: Array<{ table: string; rows: unknown[] }>;
    queue: unknown[];
    error?: Error;
} {
    const inserts: Array<{ table: string; rows: unknown[] }> = [];
    const queue: unknown[] = [];
    const mock = {
        inserts,
        queue,
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
        async query<T>(_sql: string, _params?: unknown): Promise<T[]> {
            if (mock.error) throw mock.error;
            return queue.slice() as T[];
        }
    };
    return mock as unknown as IClickHouseService & {
        inserts: Array<{ table: string; rows: unknown[] }>;
        queue: unknown[];
        error?: Error;
    };
}

const sampleEvent: ITrafficEvent = {
    event_type: 'bootstrap',
    timestamp: new Date('2026-04-30T12:00:00.000Z'),
    candidate_uid: '550e8400-e29b-41d4-a716-446655440000',
    user_id: null,
    referral_code: null,
    duration_ms: null,
    path: '/markets',
    referer: 'https://example.com/post',
    original_referrer: null,
    user_agent: 'Mozilla/5.0',
    accept_language: 'en-US',
    country: 'US',
    device: 'desktop',
    bot_class: null,
    utm_source: null,
    utm_medium: null,
    utm_campaign: null,
    utm_term: null,
    utm_content: null,
    sec_ch_ua: null,
    sec_ch_ua_mobile: null,
    sec_ch_ua_platform: null,
    sec_fetch_dest: null,
    sec_fetch_mode: null,
    sec_fetch_site: null
};

describe('TrafficService', () => {
    beforeEach(() => {
        TrafficService.resetInstance();
    });

    describe('singleton lifecycle', () => {
        it('throws if getInstance() called before setDependencies()', () => {
            expect(() => TrafficService.getInstance()).toThrow(/setDependencies/);
        });

        it('returns the same instance across getInstance() calls', () => {
            const logger = createMockLogger();
            TrafficService.setDependencies(undefined, logger);
            expect(TrafficService.getInstance()).toBe(TrafficService.getInstance());
        });

        it('logs once when initialized without ClickHouse', () => {
            const logger = createMockLogger();
            TrafficService.setDependencies(undefined, logger);
            expect(logger.info).toHaveBeenCalledWith(
                expect.stringContaining('without ClickHouse')
            );
        });
    });

    describe('isEnabled()', () => {
        it('is false when ClickHouse is unavailable', () => {
            TrafficService.setDependencies(undefined, createMockLogger());
            expect(TrafficService.getInstance().isEnabled()).toBe(false);
        });

        it('is true when ClickHouse is provided', () => {
            TrafficService.setDependencies(createMockClickHouse(), createMockLogger());
            expect(TrafficService.getInstance().isEnabled()).toBe(true);
        });
    });

    describe('recordEvent()', () => {
        it('no-ops when ClickHouse is unavailable', () => {
            TrafficService.setDependencies(undefined, createMockLogger());
            expect(() => TrafficService.getInstance().recordEvent(sampleEvent)).not.toThrow();
        });

        it('returns synchronously and dispatches an insert to traffic_events', async () => {
            const ch = createMockClickHouse();
            TrafficService.setDependencies(ch, createMockLogger());

            // Fire-and-forget: returns void synchronously.
            const ret = TrafficService.getInstance().recordEvent(sampleEvent);
            expect(ret).toBeUndefined();

            // Insert is dispatched on a microtask; await one tick to let it settle.
            await Promise.resolve();

            expect(ch.inserts).toHaveLength(1);
            expect(ch.inserts[0].table).toBe('traffic_events');
            const row = ch.inserts[0].rows[0] as Record<string, unknown>;
            expect(row.candidate_uid).toBe(sampleEvent.candidate_uid);
            expect(row.event_type).toBe('bootstrap');
            expect(typeof row.timestamp).toBe('string');
            // ClickHouse native DateTime64(3) form, UTC, no 'T'/'Z' suffix.
            expect(row.timestamp).toBe('2026-04-30 12:00:00.000');
        });

        it('swallows ClickHouse failures without throwing', async () => {
            const ch = createMockClickHouse();
            ch.error = new Error('CH down');
            const logger = createMockLogger();
            TrafficService.setDependencies(ch, logger);

            expect(() => TrafficService.getInstance().recordEvent(sampleEvent)).not.toThrow();

            // Allow the rejected insert promise to flush through .catch().
            await new Promise(resolve => setImmediate(resolve));

            expect(logger.warn).toHaveBeenCalled();
        });
    });

    describe('getEventsForUser()', () => {
        it('returns [] when ClickHouse is unavailable', async () => {
            TrafficService.setDependencies(undefined, createMockLogger());
            const events = await TrafficService.getInstance().getEventsForUser('uid');
            expect(events).toEqual([]);
        });

        it('rehydrates ClickHouse native-format timestamps as Date instances', async () => {
            const ch = createMockClickHouse();
            // ClickHouse JSONEachRow returns DateTime64 in this form, not ISO.
            ch.queue.push({ ...sampleEvent, timestamp: '2026-04-30 12:00:00.000' });
            TrafficService.setDependencies(ch, createMockLogger());

            const events = await TrafficService.getInstance().getEventsForUser('uid');

            expect(events).toHaveLength(1);
            expect(events[0].timestamp).toBeInstanceOf(Date);
            expect(events[0].timestamp.toISOString()).toBe('2026-04-30T12:00:00.000Z');
        });

        it('returns [] and logs when the query fails', async () => {
            const ch = createMockClickHouse();
            ch.error = new Error('CH down');
            const logger = createMockLogger();
            TrafficService.setDependencies(ch, logger);

            const events = await TrafficService.getInstance().getEventsForUser('uid');

            expect(events).toEqual([]);
            expect(logger.warn).toHaveBeenCalled();
        });
    });

    describe('getBotClassBreakdown()', () => {
        it('returns [] when ClickHouse is unavailable', async () => {
            TrafficService.setDependencies(undefined, createMockLogger());
            const out = await TrafficService.getInstance().getBotClassBreakdown();
            expect(out).toEqual([]);
        });

        it('preserves NULL buckets and coerces count to number', async () => {
            // NULL is a real, distinct bucket — pre-classifier rows roll
            // through that bucket and the dashboard charts the decay.
            // Coercion guards against ClickHouse returning string counts
            // under JSONEachRow.
            const ch = createMockClickHouse();
            ch.queue.push(
                { key: 'human', count: '76' },
                { key: null, count: '23' },
                { key: 'bot_other', count: 21 }
            );
            TrafficService.setDependencies(ch, createMockLogger());

            const out = await TrafficService.getInstance().getBotClassBreakdown({ sinceHours: 24 });

            expect(out).toEqual([
                { key: 'human', count: 76 },
                { key: null, count: 23 },
                { key: 'bot_other', count: 21 }
            ]);
        });
    });

    describe('getTopPaths() / getTopCountries()', () => {
        it('exclude null keys (low analytic value vs the populated keys)', async () => {
            const ch = createMockClickHouse();
            // Verifies the SQL the service generates includes the
            // null-exclusion clause; we rely on the captured query
            // string since the mock can't actually filter.
            const captured: { sql?: string; params?: unknown } = {};
            ch.query = async <T>(sql: string, params?: unknown): Promise<T[]> => {
                captured.sql = sql;
                captured.params = params;
                return [{ key: 'US', count: 12 }] as T[];
            };
            TrafficService.setDependencies(ch, createMockLogger());

            await TrafficService.getInstance().getTopCountries({ sinceHours: 6, limit: 5 });

            expect(captured.sql).toContain('country IS NOT NULL');
            expect(captured.params).toEqual({ sinceHours: 6, limit: 5 });
        });
    });

    describe('getBotOtherUserAgents()', () => {
        it('filters to bot_other and clamps the UA column', async () => {
            const ch = createMockClickHouse();
            const captured: { sql?: string } = {};
            ch.query = async <T>(sql: string): Promise<T[]> => {
                captured.sql = sql;
                return [{ key: 'CensysInspect/1.1', count: 6 }] as T[];
            };
            TrafficService.setDependencies(ch, createMockLogger());

            const out = await TrafficService.getInstance().getBotOtherUserAgents({ sinceHours: 24, limit: 10 });

            // Two assertions document load-bearing parts of the SQL —
            // the clamp keeps wire bandwidth bounded and the WHERE
            // filter is what makes this method "bot_other only".
            expect(captured.sql).toContain("bot_class = 'bot_other'");
            expect(captured.sql).toContain('substring(user_agent, 1, 240)');
            expect(out).toEqual([{ key: 'CensysInspect/1.1', count: 6 }]);
        });

        it('returns [] when ClickHouse is unavailable', async () => {
            TrafficService.setDependencies(undefined, createMockLogger());
            const out = await TrafficService.getInstance().getBotOtherUserAgents();
            expect(out).toEqual([]);
        });

        it('returns [] and logs on query failure', async () => {
            const ch = createMockClickHouse();
            ch.error = new Error('CH down');
            const logger = createMockLogger();
            TrafficService.setDependencies(ch, logger);

            const out = await TrafficService.getInstance().getBotOtherUserAgents();

            expect(out).toEqual([]);
            expect(logger.warn).toHaveBeenCalled();
        });
    });
});
