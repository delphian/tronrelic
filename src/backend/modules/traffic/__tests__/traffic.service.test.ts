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
    sec_fetch_site: null,
    cf_ray: null,
    cf_ipcountry: null,
    ip_hash: null,
    subnet_hash: null,
    channel: 'referral'
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

    describe('getBotClassTimeSeries()', () => {
        it('returns [] when ClickHouse is unavailable', async () => {
            TrafficService.setDependencies(undefined, createMockLogger());
            const out = await TrafficService.getInstance().getBotClassTimeSeries();
            expect(out).toEqual([]);
        });

        it('pivots (day, klass, count) rows into per-day count maps', async () => {
            // Coercion guards against ClickHouse returning string counts
            // under JSONEachRow; the per-day pivot is the method's whole job.
            const ch = createMockClickHouse();
            ch.queue.push(
                { day: '2026-06-01', klass: 'human', count: '120' },
                { day: '2026-06-01', klass: 'ai_crawler', count: 8 },
                { day: '2026-06-02', klass: 'human', count: '95' },
                { day: '2026-06-02', klass: 'unclassified', count: '3' }
            );
            TrafficService.setDependencies(ch, createMockLogger());

            const out = await TrafficService.getInstance().getBotClassTimeSeries({ sinceHours: 168 });

            expect(out).toEqual([
                { day: '2026-06-01', counts: { human: 120, ai_crawler: 8 } },
                { day: '2026-06-02', counts: { human: 95, unclassified: 3 } }
            ]);
        });

        it('folds NULL bot_class into unclassified in the generated SQL', async () => {
            const ch = createMockClickHouse();
            const captured: { sql?: string; params?: unknown } = {};
            ch.query = async <T>(sql: string, params?: unknown): Promise<T[]> => {
                captured.sql = sql;
                captured.params = params;
                return [] as T[];
            };
            TrafficService.setDependencies(ch, createMockLogger());

            await TrafficService.getInstance().getBotClassTimeSeries({ sinceHours: 48 });

            expect(captured.sql).toContain("coalesce(bot_class, 'unclassified')");
            expect(captured.params).toEqual({ sinceHours: 48 });
        });

        it('returns [] and logs on query failure', async () => {
            const ch = createMockClickHouse();
            ch.error = new Error('CH down');
            const logger = createMockLogger();
            TrafficService.setDependencies(ch, logger);

            const out = await TrafficService.getInstance().getBotClassTimeSeries();

            expect(out).toEqual([]);
            expect(logger.warn).toHaveBeenCalled();
        });
    });

    describe('getPathsByBotClass()', () => {
        it('returns [] when ClickHouse is unavailable', async () => {
            TrafficService.setDependencies(undefined, createMockLogger());
            const out = await TrafficService.getInstance().getPathsByBotClass('ai_crawler');
            expect(out).toEqual([]);
        });

        it('binds botClass as a parameter and maps buckets', async () => {
            // The bound param is load-bearing: botClass originates from the
            // request and must never be interpolated into the SQL.
            const ch = createMockClickHouse();
            const captured: { sql?: string; params?: unknown } = {};
            ch.query = async <T>(sql: string, params?: unknown): Promise<T[]> => {
                captured.sql = sql;
                captured.params = params;
                return [{ key: '/markets', count: '14' }] as T[];
            };
            TrafficService.setDependencies(ch, createMockLogger());

            const out = await TrafficService.getInstance().getPathsByBotClass('ai_crawler', { sinceHours: 168, limit: 10 });

            // NULL fold mirrors the trend query so 'unclassified' is drillable.
            expect(captured.sql).toContain("coalesce(bot_class, 'unclassified') = {botClass:String}");
            expect(captured.sql).not.toContain("'ai_crawler'");
            expect(captured.params).toEqual({ sinceHours: 168, limit: 10, botClass: 'ai_crawler' });
            expect(out).toEqual([{ key: '/markets', count: 14 }]);
        });

        it('returns [] and logs on query failure', async () => {
            const ch = createMockClickHouse();
            ch.error = new Error('CH down');
            const logger = createMockLogger();
            TrafficService.setDependencies(ch, logger);

            const out = await TrafficService.getInstance().getPathsByBotClass('ai_crawler');

            expect(out).toEqual([]);
            expect(logger.warn).toHaveBeenCalled();
        });
    });

    describe('getPageActivity()', () => {
        const range = { since: new Date('2026-04-01T00:00:00.000Z') };

        it('returns an empty page when ClickHouse is unavailable', async () => {
            TrafficService.setDependencies(undefined, createMockLogger());
            const out = await TrafficService.getInstance().getPageActivity('tid', range);
            expect(out).toEqual({ rows: [], total: 0 });
        });

        it('groups anonymous tid activity on candidate_uid with user_id IS NULL', async () => {
            const ch = createMockClickHouse();
            const sqls: string[] = [];
            ch.query = async <T>(sql: string): Promise<T[]> => {
                sqls.push(sql);
                if (sql.includes('AS total')) return [{ total: '3' }] as T[];
                return [{
                    id: 'tid-1', firstSeen: '2026-04-30 10:00:00.000', lastSeen: '2026-04-30 10:05:00.000',
                    pageViews: '4', distinctPaths: '3', firstPath: '/', lastPath: '/markets',
                    country: 'US', device: 'desktop'
                }] as T[];
            };
            TrafficService.setDependencies(ch, createMockLogger());

            const out = await TrafficService.getInstance().getPageActivity('tid', range, 25, 0);

            const joined = sqls.join('\n');
            expect(joined).toContain("event_type = 'page'");
            expect(joined).toContain('user_id IS NULL');
            expect(joined).toContain('GROUP BY candidate_uid');
            expect(out.total).toBe(3);
            expect(out.rows[0]).toMatchObject({ id: 'tid-1', pageViews: 4, distinctPaths: 3, lastPath: '/markets' });
            // ClickHouse's native suffix-less DateTime is normalized to ISO-8601 UTC
            // so the frontend's `new Date(...)` parses it as UTC, not local time.
            expect(out.rows[0].firstSeen).toBe('2026-04-30T10:00:00.000Z');
            expect(out.rows[0].lastSeen).toBe('2026-04-30T10:05:00.000Z');
        });

        it('groups registered activity on user_id with user_id IS NOT NULL', async () => {
            const ch = createMockClickHouse();
            const sqls: string[] = [];
            ch.query = async <T>(sql: string): Promise<T[]> => {
                sqls.push(sql);
                if (sql.includes('AS total')) return [{ total: 1 }] as T[];
                return [] as T[];
            };
            TrafficService.setDependencies(ch, createMockLogger());

            await TrafficService.getInstance().getPageActivity('user', range);

            const joined = sqls.join('\n');
            expect(joined).toContain('user_id IS NOT NULL');
            expect(joined).toContain('GROUP BY user_id');
        });
    });

    describe('getPageHits()', () => {
        const range = { since: new Date('2026-04-01T00:00:00.000Z') };

        it('returns [] when ClickHouse is unavailable', async () => {
            TrafficService.setDependencies(undefined, createMockLogger());
            const out = await TrafficService.getInstance().getPageHits('user', 'ba_42', range);
            expect(out).toEqual([]);
        });

        it('rejects a non-UUID tid id without querying ClickHouse', async () => {
            const ch = createMockClickHouse();
            let called = false;
            ch.query = async <T>(): Promise<T[]> => { called = true; return [] as T[]; };
            TrafficService.setDependencies(ch, createMockLogger());

            const out = await TrafficService.getInstance().getPageHits('tid', 'not-a-uuid', range);

            expect(out).toEqual([]);
            expect(called).toBe(false);
        });

        it('matches candidate_uid for a tid subject and maps hits', async () => {
            const ch = createMockClickHouse();
            const captured: { sql?: string; params?: Record<string, unknown> } = {};
            ch.query = async <T>(sql: string, params?: unknown): Promise<T[]> => {
                captured.sql = sql;
                captured.params = params as Record<string, unknown>;
                return [{ timestamp: '2026-04-30 10:05:00.000', path: '/markets', referer: null, device: 'desktop', country: 'US' }] as T[];
            };
            TrafficService.setDependencies(ch, createMockLogger());

            const out = await TrafficService.getInstance().getPageHits('tid', '550e8400-e29b-41d4-a716-446655440000', range, 50);

            expect(captured.sql).toContain('candidate_uid = {id:UUID}');
            expect(captured.sql).toContain("event_type = 'page'");
            expect(captured.params?.id).toBe('550e8400-e29b-41d4-a716-446655440000');
            // The suffix-less ClickHouse timestamp is normalized to ISO-8601 UTC so
            // the frontend's `new Date(...)` parses it as UTC, not local time.
            expect(out).toEqual([{ timestamp: '2026-04-30T10:05:00.000Z', path: '/markets', referer: null, device: 'desktop', country: 'US' }]);
        });

        it('matches user_id for a user subject', async () => {
            const ch = createMockClickHouse();
            const captured: { sql?: string } = {};
            ch.query = async <T>(sql: string): Promise<T[]> => { captured.sql = sql; return [] as T[]; };
            TrafficService.setDependencies(ch, createMockLogger());

            await TrafficService.getInstance().getPageHits('user', 'ba_user_42', range);

            expect(captured.sql).toContain('user_id = {id:String}');
        });
    });

    describe('excludeBots filter', () => {
        const range = { since: new Date('2026-06-01T00:00:00.000Z') };
        const HUMAN_FILTER = "(bot_class = 'human' OR bot_class IS NULL)";

        /**
         * Wire a mock ClickHouse that records every generated SQL string.
         *
         * @returns The captured SQL list (joined for substring assertions).
         */
        function captureSql(): { sqls: string[] } {
            const captured = { sqls: [] as string[] };
            const ch = createMockClickHouse();
            ch.query = async <T>(sql: string): Promise<T[]> => {
                captured.sqls.push(sql);
                return [] as T[];
            };
            TrafficService.setDependencies(ch, createMockLogger());
            return captured;
        }

        it('getDailyVisitors applies the human filter only when requested', async () => {
            // Referer headers are spoofable; the filter is what keeps the
            // visitor chart honest. NULL stays included because legacy
            // pre-classifier rows cannot be assumed to be bots.
            const captured = captureSql();

            await TrafficService.getInstance().getDailyVisitors(range, true);
            expect(captured.sqls.join('\n')).toContain(HUMAN_FILTER);

            captured.sqls.length = 0;
            await TrafficService.getInstance().getDailyVisitors(range);
            expect(captured.sqls.join('\n')).not.toContain(HUMAN_FILTER);
        });

        it('getTrafficSources applies the human filter only when requested', async () => {
            const captured = captureSql();

            await TrafficService.getInstance().getTrafficSources(range, true);
            expect(captured.sqls.join('\n')).toContain(HUMAN_FILTER);

            captured.sqls.length = 0;
            await TrafficService.getInstance().getTrafficSources(range);
            expect(captured.sqls.join('\n')).not.toContain(HUMAN_FILTER);
        });

        it('getNewVisitors filters both the tid set and the grouped rows', async () => {
            // A crawler spoofing a google referrer must neither appear as a
            // visitor (inner IN set) nor contribute first-touch attribution
            // (outer grouped rows).
            const captured = captureSql();

            await TrafficService.getInstance().getNewVisitors(range, 50, 0, true);

            for (const sql of captured.sqls) {
                const inner = sql.indexOf(HUMAN_FILTER);
                const outer = sql.lastIndexOf(HUMAN_FILTER);
                expect(inner).toBeGreaterThan(-1);
                expect(outer).toBeGreaterThan(inner);
            }
        });

        it('getTrafficSourceDetails applies the human filter to the summary read', async () => {
            const captured = captureSql();

            await TrafficService.getInstance().getTrafficSourceDetails(range, 'google.com', true);

            expect(captured.sqls[0]).toContain(HUMAN_FILTER);
        });
    });

    describe('canonical visitor rule (page-event membership)', () => {
        const range = { since: new Date('2026-06-01T00:00:00.000Z') };

        /**
         * Capture every generated SQL string so assertions can confirm the
         * page-event rule is enforced. Mirrors the excludeBots helper.
         *
         * @returns The captured SQL list.
         */
        function captureSql(): { sqls: string[] } {
            const captured = { sqls: [] as string[] };
            const ch = createMockClickHouse();
            ch.query = async <T>(sql: string): Promise<T[]> => {
                captured.sqls.push(sql);
                return [] as T[];
            };
            TrafficService.setDependencies(ch, createMockLogger());
            return captured;
        }

        it('getDailyVisitors counts only tids that ran JS (a page event)', async () => {
            const captured = captureSql();
            await TrafficService.getInstance().getDailyVisitors(range);
            expect(captured.sqls.join('\n')).toContain("uniqExactIf(candidate_uid, event_type = 'page') AS visitors");
        });

        it('getLiveVisitorCount counts only page-event tids', async () => {
            const captured = captureSql();
            await TrafficService.getInstance().getLiveVisitorCount();
            expect(captured.sqls.join('\n')).toContain("uniqExactIf(candidate_uid, event_type = 'page') AS visitors");
        });

        it('getTrafficSources gates its bootstrap-only visitor count on a page-event membership subquery', async () => {
            // The source scan reads bootstrap rows, which carry no page event,
            // so the rule can only be enforced via the IN-subquery.
            const captured = captureSql();
            await TrafficService.getInstance().getTrafficSources(range);
            const sql = captured.sqls.join('\n');
            expect(sql).toContain('candidate_uid IN (');
            expect(sql).toContain("event_type = 'page'");
        });

        it('getNewVisitors requires a page event on both the page and count queries', async () => {
            const captured = captureSql();
            await TrafficService.getInstance().getNewVisitors(range, 50, 0);
            expect(captured.sqls.length).toBeGreaterThanOrEqual(2);
            for (const sql of captured.sqls) {
                // The guard is window-scoped so a page beacon after a custom
                // range's end cannot retroactively qualify a new visitor.
                expect(sql).toMatch(/countIf\(event_type = 'page' AND .+\) > 0/);
            }
        });

        it('getOverviewTrend measures page-event visitors and restricts the series to page rows', async () => {
            const ch = createMockClickHouse();
            const sqls: string[] = [];
            ch.query = async <T>(sql: string): Promise<T[]> => {
                sqls.push(sql);
                return [] as T[];
            };
            TrafficService.setDependencies(ch, createMockLogger());

            await TrafficService.getInstance().getOverviewTrend(range);
            const joined = sqls.join('\n');
            expect(joined).toContain("uniqExactIf(candidate_uid, event_type = 'page') AS visitors");
            const seriesSql = sqls.find(s => s.includes('GROUP BY bucket'));
            expect(seriesSql).toBeDefined();
            expect(seriesSql!).toContain("AND event_type = 'page'");
        });
    });

    describe('getHighVolumeSubnets()', () => {
        it('returns [] when ClickHouse is unavailable', async () => {
            TrafficService.setDependencies(undefined, createMockLogger());
            expect(await TrafficService.getInstance().getHighVolumeSubnets({ since: new Date('2026-06-01T00:00:00.000Z') })).toEqual([]);
        });

        it('applies the volume threshold and maps request/visitor/page-visitor counts', async () => {
            const ch = createMockClickHouse();
            const captured: { sql?: string } = {};
            ch.query = async <T>(sql: string): Promise<T[]> => {
                captured.sql = sql;
                return [{ subnetHash: 'abc123def4567890', requests: '812', visitors: '640', pageVisitors: '4' }] as T[];
            };
            TrafficService.setDependencies(ch, createMockLogger());

            const out = await TrafficService.getInstance().getHighVolumeSubnets({ since: new Date('2026-06-01T00:00:00.000Z') });

            // Threshold guard present, and the read is not bot-filtered.
            expect(captured.sql).toContain('HAVING requests >=');
            expect(captured.sql).toContain('subnet_hash IS NOT NULL');
            expect(captured.sql).not.toContain("bot_class = 'human'");
            expect(out).toEqual([{ subnetHash: 'abc123def4567890', requests: 812, visitors: 640, pageVisitors: 4 }]);
        });
    });

    describe('visitors-primary aggregates', () => {
        it('getTrafficSources counts distinct visitors alongside raw events', async () => {
            // Raw event counts overstate audiences (one visitor → many rows);
            // analytics convention leads with unique visitors.
            const ch = createMockClickHouse();
            const captured: { sql?: string } = {};
            ch.query = async <T>(sql: string): Promise<T[]> => {
                captured.sql = sql;
                return [{ source: 'google.com', visitors: '17', count: '63' }] as T[];
            };
            TrafficService.setDependencies(ch, createMockLogger());

            const out = await TrafficService.getInstance().getTrafficSources({ since: new Date('2026-06-01T00:00:00.000Z') });

            expect(captured.sql).toContain('uniqExact(candidate_uid) AS visitors');
            expect(captured.sql).toContain('ORDER BY visitors DESC');
            // No stored channel in the mock row → server-side fallback
            // classifies the domain (google.com → organic).
            expect(out).toEqual([{ source: 'google.com', visitors: 17, count: 63, channel: 'organic' }]);
        });
    });

    describe('getOverviewTrend()', () => {
        it('returns the empty shape when ClickHouse is unavailable', async () => {
            TrafficService.setDependencies(undefined, createMockLogger());
            const out = await TrafficService.getInstance().getOverviewTrend({ since: new Date('2026-06-01T00:00:00.000Z') });
            expect(out.granularity).toBe('day');
            expect(out.series).toEqual([]);
            expect(out.current.visitors).toBe(0);
        });

        it('uses hourly zero-filled buckets for a 24h window', async () => {
            // A "24 Hours" view bucketed by day is one bar; hourly buckets are
            // what makes the short window readable. Absent hours must be
            // explicit zeros so the chart shows quiet, not gaps.
            const ch = createMockClickHouse();
            const sqls: string[] = [];
            ch.query = async <T>(sql: string): Promise<T[]> => {
                sqls.push(sql);
                // The top-paths query is the more specific `GROUP BY bucket, path`
                // and must be matched before the series' `GROUP BY bucket`.
                if (sql.includes('GROUP BY bucket, path')) {
                    return [{ bucket: '2026-06-01 05:00:00', path: '/markets', hits: '4' }] as T[];
                }
                if (sql.includes('GROUP BY bucket')) {
                    return [{ bucket: '2026-06-01 05:00:00', visitors: '3', pageviews: '7' }] as T[];
                }
                return [{ visitors: '10', pageviews: '25', sessions: '0', avgDurationMs: null, bounces: '0' }] as T[];
            };
            TrafficService.setDependencies(ch, createMockLogger());

            const out = await TrafficService.getInstance().getOverviewTrend({
                since: new Date('2026-06-01T00:00:00.000Z'),
                until: new Date('2026-06-02T00:00:00.000Z')
            });

            expect(out.granularity).toBe('hour');
            expect(sqls.some(s => s.includes('toStartOfHour(timestamp)'))).toBe(true);
            // The top-paths query is scoped to interactive page rows, same as
            // the series, so bot-only bootstrap paths never surface.
            expect(sqls.some(s => s.includes('GROUP BY bucket, path') && s.includes("event_type = 'page'"))).toBe(true);
            // 00:00 through 24:00 inclusive — 25 hourly buckets, one populated.
            expect(out.series).toHaveLength(25);
            // The populated bucket carries its ranked top paths as metadata.
            expect(out.series.find(p => p.bucket === '2026-06-01T05:00:00.000Z'))
                .toEqual({ bucket: '2026-06-01T05:00:00.000Z', visitors: 3, pageviews: 7, topPaths: [{ path: '/markets', hits: 4 }] });
            // Zero-traffic buckets carry an empty path list, never undefined.
            expect(out.series.find(p => p.bucket === '2026-06-01T02:00:00.000Z')?.topPaths).toEqual([]);
            expect(out.series.filter(p => p.visitors === 0)).toHaveLength(24);
            expect(out.current.visitors).toBe(10);
            // sessions = 0 → bounce rate is 0, not NaN.
            expect(out.current.bounceRate).toBe(0);
        });

        it('uses daily buckets beyond 48h and queries an equal-length previous window', async () => {
            const ch = createMockClickHouse();
            const calls: Array<{ sql: string; params: Record<string, unknown> }> = [];
            ch.query = async <T>(sql: string, params?: unknown): Promise<T[]> => {
                calls.push({ sql, params: params as Record<string, unknown> });
                if (sql.includes('GROUP BY bucket')) return [] as T[];
                return [{ visitors: '5', pageviews: '9', sessions: '0', avgDurationMs: null, bounces: '0' }] as T[];
            };
            TrafficService.setDependencies(ch, createMockLogger());

            const out = await TrafficService.getInstance().getOverviewTrend({
                since: new Date('2026-05-03T00:00:00.000Z'),
                until: new Date('2026-06-02T00:00:00.000Z')
            });

            expect(out.granularity).toBe('day');
            const seriesCall = calls.find(c => c.sql.includes('GROUP BY bucket'));
            expect(seriesCall?.sql).toContain('toDate(timestamp)');
            // The previous window slides back by the full 30-day window length.
            // KPI reads now issue two queries per window (base + derived
            // sessions), so locate the previous window by its params instead
            // of call position.
            const prevCall = calls.find(c => String(c.params?.since ?? '').includes('2026-04-03'));
            expect(prevCall).toBeDefined();
            expect(String(prevCall!.params.until)).toContain('2026-05-03');
            // 05-03 through 06-02 inclusive — 31 zero-filled daily buckets.
            expect(out.series).toHaveLength(31);
            expect(out.previous.visitors).toBe(5);
        });
    });

    describe('getLiveVisitorCount()', () => {
        it('returns 0 when ClickHouse is unavailable', async () => {
            TrafficService.setDependencies(undefined, createMockLogger());
            expect(await TrafficService.getInstance().getLiveVisitorCount()).toBe(0);
        });

        it('counts distinct visitors over the last five minutes, honoring the bot filter', async () => {
            const ch = createMockClickHouse();
            const captured: { sql?: string } = {};
            ch.query = async <T>(sql: string): Promise<T[]> => {
                captured.sql = sql;
                return [{ visitors: '4' }] as T[];
            };
            TrafficService.setDependencies(ch, createMockLogger());

            const count = await TrafficService.getInstance().getLiveVisitorCount(true);

            expect(captured.sql).toContain('INTERVAL 5 MINUTE');
            expect(captured.sql).toContain("(bot_class = 'human' OR bot_class IS NULL)");
            expect(count).toBe(4);
        });
    });

    describe('ignore list exclusion', () => {
        const IGNORED = ['665f00000000000000000001', '665f00000000000000000002'];

        it('excludes the whole person for ignored accounts on a rangeParams read', async () => {
            const ch = createMockClickHouse();
            const captured: { sql?: string; params?: Record<string, unknown> } = {};
            ch.query = async <T>(sql: string, params?: unknown): Promise<T[]> => {
                captured.sql = sql;
                captured.params = params as Record<string, unknown>;
                return [] as T[];
            };
            TrafficService.setDependencies(ch, createMockLogger());
            const svc = TrafficService.getInstance();
            svc.setIgnoredUserIds(IGNORED);

            await svc.getGeoDistribution({ since: new Date('2026-06-01T00:00:00.000Z') });

            // Whole-person: exclude every tid that ever logged in as an ignored
            // account, via the unwindowed candidate_uid subquery.
            expect(captured.sql).toContain('candidate_uid NOT IN (SELECT candidate_uid FROM');
            expect(captured.sql).toContain('user_id IN ({ignoredUserIds:Array(String)})');
            expect(captured.params?.ignoredUserIds).toEqual(IGNORED);
        });

        it('adds no exclusion when the ignore list is empty', async () => {
            const ch = createMockClickHouse();
            const captured: { sql?: string; params?: Record<string, unknown> } = {};
            ch.query = async <T>(sql: string, params?: unknown): Promise<T[]> => {
                captured.sql = sql;
                captured.params = params as Record<string, unknown>;
                return [] as T[];
            };
            TrafficService.setDependencies(ch, createMockLogger());

            await TrafficService.getInstance().getGeoDistribution({ since: new Date('2026-06-01T00:00:00.000Z') });

            expect(captured.sql).not.toContain('ignoredUserIds');
            expect(captured.params?.ignoredUserIds).toBeUndefined();
        });

        it('excludes ignored accounts from the live visitor count (own WHERE path)', async () => {
            const ch = createMockClickHouse();
            const captured: { sql?: string; params?: Record<string, unknown> } = {};
            ch.query = async <T>(sql: string, params?: unknown): Promise<T[]> => {
                captured.sql = sql;
                captured.params = params as Record<string, unknown>;
                return [{ visitors: '3' }] as T[];
            };
            TrafficService.setDependencies(ch, createMockLogger());
            const svc = TrafficService.getInstance();
            svc.setIgnoredUserIds(IGNORED);

            await svc.getLiveVisitorCount();

            expect(captured.sql).toContain('INTERVAL 5 MINUTE');
            expect(captured.sql).toContain('candidate_uid NOT IN (SELECT candidate_uid FROM');
            expect(captured.params?.ignoredUserIds).toEqual(IGNORED);
        });
    });
});
