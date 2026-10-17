/// <reference types="vitest" />

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { IClickHouseService, ISystemLogService } from '@/types';
import type { Request } from 'express';
import { TrafficService, buildTrafficEvent, parseAsn, ASN_HEADER, type ITrafficEvent } from '../services/traffic.service.js';

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
    channel: 'referral',
    asn: null
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

    describe('ASN recording', () => {
        /**
         * Build the minimal Express request `buildTrafficEvent` reads, so a
         * test only has to state the headers it cares about.
         *
         * @param headers - Request headers, lower-cased as Express delivers them.
         * @returns A request stub carrying those headers.
         */
        function requestWith(headers: Record<string, string>): Request {
            return { headers, ip: '203.0.113.7', path: '/' } as unknown as Request;
        }

        it('stores the ASN from the Cloudflare header when CF-Ray attests the hop', () => {
            const event = buildTrafficEvent('page', sampleEvent.candidate_uid, requestWith({
                'cf-ray': '8f1a2b3c4d5e6f70-SIN',
                [ASN_HEADER]: '139341'
            }));
            expect(event.asn).toBe(139341);
        });

        it('ignores the header on a request that did not come through Cloudflare', () => {
            // Without CF-Ray the header is whatever the client chose to send,
            // the same reason cf_ipcountry is dropped in that case.
            const event = buildTrafficEvent('page', sampleEvent.candidate_uid, requestWith({
                [ASN_HEADER]: '139341'
            }));
            expect(event.asn).toBeNull();
        });

        it('stores null when the Transform Rule is not yet in place', () => {
            const event = buildTrafficEvent('bootstrap', sampleEvent.candidate_uid, requestWith({
                'cf-ray': '8f1a2b3c4d5e6f70-SIN'
            }));
            expect(event.asn).toBeNull();
        });

        it('accepts only a positive 32-bit decimal integer', () => {
            expect(parseAsn('13335')).toBe(13335);
            expect(parseAsn(' 4294967295 ')).toBe(4294967295);
            // AS0 is reserved and means "could not be placed", not a network.
            expect(parseAsn('0')).toBeNull();
            expect(parseAsn('4294967296')).toBeNull();
            expect(parseAsn('AS13335')).toBeNull();
            expect(parseAsn('1e5')).toBeNull();
            expect(parseAsn('-5')).toBeNull();
            expect(parseAsn(undefined)).toBeNull();
        });
    });

    describe('per-event reads', () => {
        /**
         * Wire a mock ClickHouse that records each query and answers with the
         * staged rows, so a test can check both the bound filters and the
         * reshaping of what comes back.
         *
         * @param rows - Rows every query returns.
         * @returns The captured queries in issue order.
         */
        function captureWith(rows: unknown[]): Array<{ sql: string; params: Record<string, unknown> }> {
            const queries: Array<{ sql: string; params: Record<string, unknown> }> = [];
            const ch = createMockClickHouse();
            ch.query = async <T>(sql: string, params?: unknown): Promise<T[]> => {
                queries.push({ sql, params: (params ?? {}) as Record<string, unknown> });
                return rows as T[];
            };
            TrafficService.setDependencies(ch, createMockLogger());
            return queries;
        }

        const storedRow = {
            timestamp: '2026-10-17 05:38:56.123',
            event_type: 'page',
            path: '/blog/some-post',
            candidate_uid: '550e8400-e29b-41d4-a716-446655440000',
            logged_in: 0,
            country: 'TR',
            cf_ipcountry: 'TR',
            via_cloudflare: 1,
            asn: 139341,
            bot_class: 'human',
            device: 'desktop',
            user_agent_trimmed: 'Mozilla/5.0 Chrome/144',
            referer: 'https://tronrelic.com/blog',
            original_referrer: 'https://www.google.com/',
            channel: null,
            ip_hash: 'e0d716babf000000',
            subnet_hash: '239b22c643000000'
        };

        it('returns an empty page when ClickHouse is unavailable', async () => {
            TrafficService.setDependencies(undefined, createMockLogger());
            const page = await TrafficService.getInstance().listTrafficEvents(
                { since: new Date('2026-10-16T00:00:00.000Z') }, {}, 20, 0
            );
            expect(page).toEqual({ rows: [], hasMore: false });
        });

        it('binds every filter as a parameter instead of splicing it into the SQL', async () => {
            const queries = captureWith([]);

            await TrafficService.getInstance().listTrafficEvents(
                { since: new Date('2026-10-16T00:00:00.000Z') },
                { ipHash: 'e0d716babf000000', asn: 139341, botClass: 'unclassified', pathPrefix: "/blog/' OR 1=1" },
                20,
                0
            );

            const [query] = queries;
            expect(query!.sql).toContain('ip_hash = {fIpHash:String}');
            expect(query!.sql).toContain('asn = {fAsn:UInt32}');
            expect(query!.sql).toContain("coalesce(bot_class, 'unclassified') = {fBotClass:String}");
            expect(query!.sql).not.toContain('OR 1=1');
            expect(query!.params).toMatchObject({ fIpHash: 'e0d716babf000000', fAsn: 139341, fPathPrefix: "/blog/' OR 1=1" });
        });

        it('reshapes a row without exposing the account id or the raw referrer URL', async () => {
            captureWith([storedRow]);

            const page = await TrafficService.getInstance().listTrafficEvents(
                { since: new Date('2026-10-16T00:00:00.000Z') }, {}, 20, 0
            );

            expect(page.rows[0]).toEqual({
                timestamp: '2026-10-17T05:38:56.123Z',
                eventType: 'page',
                path: '/blog/some-post',
                tid: '550e8400-e29b-41d4-a716-446655440000',
                loggedIn: false,
                country: 'TR',
                cfIpCountry: 'TR',
                viaCloudflare: true,
                asn: 139341,
                botClass: 'human',
                device: 'desktop',
                userAgent: 'Mozilla/5.0 Chrome/144',
                // A page row's own referer is the beacon's page, so the
                // visitor's real referrer comes from original_referrer.
                referrerDomain: 'www.google.com',
                channel: null,
                ipHash: 'e0d716babf000000',
                subnetHash: '239b22c643000000'
            });
        });

        it('fetches one extra row to report whether another page exists', async () => {
            const queries = captureWith([storedRow, storedRow, storedRow]);

            const page = await TrafficService.getInstance().listTrafficEvents(
                { since: new Date('2026-10-16T00:00:00.000Z') }, {}, 2, 40
            );

            expect(queries[0]!.params).toMatchObject({ pageLimit: 3, pageOffset: 40 });
            expect(page.rows).toHaveLength(2);
            expect(page.hasMore).toBe(true);
        });

        it('groups sources on the requested column and drops rows where it is NULL', async () => {
            const queries = captureWith([{
                key: '139341',
                events: '577',
                page_events: '301',
                distinct_tids: '54',
                distinct_ips: '27',
                distinct_subnets: '9',
                distinct_paths: '31',
                first_seen: '2026-10-15 18:00:00.000',
                last_seen: '2026-10-17 06:00:00.000',
                countries: ['TR', 'FI'],
                asns: [139341],
                bot_classes: ['human'],
                top_user_agent: ['Mozilla/5.0 Chrome/144']
            }]);

            const sources = await TrafficService.getInstance().getTrafficEventSources(
                { since: new Date('2026-10-15T00:00:00.000Z') }, {}, 'asn', 10
            );

            expect(queries[0]!.sql).toContain('toString(asn) AS key');
            expect(queries[0]!.sql).toContain('AND asn IS NOT NULL');
            expect(sources[0]).toMatchObject({
                key: '139341',
                events: 577,
                pageEvents: 301,
                distinctTids: 54,
                distinctSubnets: 9,
                firstSeen: '2026-10-15T18:00:00.000Z',
                asns: [139341],
                topUserAgent: 'Mozilla/5.0 Chrome/144'
            });
        });

        it('applies the operator ignore list like every other analytics read', async () => {
            const ch = createMockClickHouse();
            const queries: Array<{ sql: string; params: Record<string, unknown> }> = [];
            ch.query = async <T>(sql: string, params?: unknown): Promise<T[]> => {
                queries.push({ sql, params: (params ?? {}) as Record<string, unknown> });
                // The first query is the ignore-list resolution; answer it
                // with one tid so the exclusion has something to apply.
                return (queries.length === 1 ? [{ candidate_uid: 'tid-ignored' }] : []) as T[];
            };
            TrafficService.setDependencies(ch, createMockLogger());
            await TrafficService.getInstance().setIgnoredUserIds(['665f00000000000000000001']);

            await TrafficService.getInstance().getTrafficEventSources(
                { since: new Date('2026-10-15T00:00:00.000Z') }, {}, 'ip', 10
            );

            const read = queries[queries.length - 1]!;
            expect(read.sql).toContain('candidate_uid NOT IN ({ignoredCandidateUids:Array(String)})');
            expect(read.params.ignoredCandidateUids).toEqual(['tid-ignored']);
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
                { day: '2026-06-01', klass: 'search_engine', count: '120' },
                { day: '2026-06-01', klass: 'ai_crawler', count: 8 },
                { day: '2026-06-02', klass: 'scanner', count: '95' },
                { day: '2026-06-02', klass: 'unclassified', count: '3' }
            );
            TrafficService.setDependencies(ch, createMockLogger());

            const out = await TrafficService.getInstance().getBotClassTimeSeries({ sinceHours: 168 });

            expect(out).toEqual([
                { day: '2026-06-01', counts: { search_engine: 120, ai_crawler: 8 } },
                { day: '2026-06-02', counts: { scanner: 95, unclassified: 3 } }
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

        it('excludes human rows but keeps the NULL fold', async () => {
            // The Crawlers tab serves no human traffic. Filtering on the
            // coalesced expression (not bare `bot_class != 'human'`) is
            // load-bearing: a bare inequality evaluates NULL for unclassified
            // rows, which ClickHouse drops — silently deleting the coverage
            // signal this surface exists to show.
            const ch = createMockClickHouse();
            const captured: { sql?: string } = {};
            ch.query = async <T>(sql: string): Promise<T[]> => {
                captured.sql = sql;
                return [] as T[];
            };
            TrafficService.setDependencies(ch, createMockLogger());

            await TrafficService.getInstance().getBotClassTimeSeries({ sinceHours: 48 });

            expect(captured.sql).toContain("coalesce(bot_class, 'unclassified') != 'human'");
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

    describe('getVisitors()', () => {
        const range = { since: new Date('2026-04-01T00:00:00.000Z') };

        /**
         * Build a ClickHouse mock that records every SQL statement and answers
         * the count query separately from the row query.
         *
         * @param row - The single visitor row the mock returns, if any.
         * @returns The mock plus the array collecting executed SQL.
         */
        const mockWithRow = (row?: Record<string, unknown>) => {
            const sqls: string[] = [];
            const ch = createMockClickHouse();
            ch.query = async <T>(sql: string): Promise<T[]> => {
                sqls.push(sql);
                if (sql.includes('AS total')) return [{ total: '3' }] as T[];
                return (row ? [row] : []) as T[];
            };
            return { ch, sqls };
        };

        it('returns an empty page when ClickHouse is unavailable', async () => {
            TrafficService.setDependencies(undefined, createMockLogger());
            const out = await TrafficService.getInstance().getVisitors(range);
            expect(out).toEqual({ rows: [], total: 0 });
        });

        it('keys on the tid, requires a page event, and merges acquisition with behaviour', async () => {
            const { ch, sqls } = mockWithRow({
                id: 'tid-1', accountId: null,
                firstSeen: '2026-04-30 10:00:00.000', lastSeen: '2026-04-30 10:05:00.000',
                pageViews: '4', distinctPaths: '3', lastPath: '/markets',
                channel: 'organic', referrerDomain: 'google.com', landingPage: '/',
                utmSource: null, utmMedium: null, utmCampaign: null, utmTerm: null, utmContent: null,
                country: 'US', device: 'desktop', botClass: 'human', subnetHash: 'abc123'
            });
            TrafficService.setDependencies(ch, createMockLogger());

            const out = await TrafficService.getInstance().getVisitors(range, 25, 0);

            const joined = sqls.join('\n');
            expect(joined).toContain('GROUP BY candidate_uid');
            // The Visitor rule: membership is gated on a page event in the window.
            expect(joined).toContain("event_type = 'page'");
            expect(out.total).toBe(3);
            expect(out.rows[0]).toMatchObject({
                id: 'tid-1', accountId: null, pageViews: 4, distinctPaths: 3,
                channel: 'organic', referrerDomain: 'google.com',
                botClass: 'human', utm: null
            });
            // ClickHouse's native suffix-less DateTime is normalized to ISO-8601 UTC
            // so the frontend's `new Date(...)` parses it as UTC, not local time.
            expect(out.rows[0].firstSeen).toBe('2026-04-30T10:00:00.000Z');
        });

        it('flags isNew only when the global first-seen falls inside the window', async () => {
            const returning = {
                id: 'tid-old', accountId: 'ba_42',
                firstSeen: '2026-03-01 09:00:00.000', lastSeen: '2026-04-30 10:05:00.000',
                pageViews: '2', distinctPaths: '1', lastPath: '/',
                channel: null, referrerDomain: null, landingPage: '/',
                utmSource: null, utmMedium: null, utmCampaign: null, utmTerm: null, utmContent: null,
                country: null, device: 'desktop', botClass: null, subnetHash: null
            };
            const { ch } = mockWithRow(returning);
            TrafficService.setDependencies(ch, createMockLogger());

            const out = await TrafficService.getInstance().getVisitors(range);

            // First seen a month before `since` — a returning visitor, which the
            // superseded New Visitors read would have filtered out entirely.
            expect(out.rows[0].isNew).toBe(false);
            expect(out.rows[0].accountId).toBe('ba_42');
        });

        it('applies the bot filter to membership, aggregation, and the count alike', async () => {
            const { ch, sqls } = mockWithRow();
            TrafficService.setDependencies(ch, createMockLogger());

            await TrafficService.getInstance().getVisitors(range, 25, 0, true);

            const joined = sqls.join('\n');
            const occurrences = joined.split("bot_class = 'human'").length - 1;
            // Membership subquery, outer scan, and the count query's own
            // membership scan — one policy, applied to every leg rather than
            // to the first one only, which is what the superseded three-view
            // split did.
            expect(occurrences).toBeGreaterThanOrEqual(3);
        });

        it('narrows to one account by collecting every tid that account ever used', async () => {
            const { ch, sqls } = mockWithRow();
            TrafficService.setDependencies(ch, createMockLogger());

            await TrafficService.getInstance().getVisitors(range, 25, 0, false, 'ba_42');

            const joined = sqls.join('\n');
            expect(joined).toContain('user_id = {accountId:String}');
            // Unwindowed on purpose: the account's tids are resolved across all
            // history, then the window still decides which of them are visitors.
            expect(joined).not.toContain("user_id = {accountId:String} AND timestamp");
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

        it('getTrafficSources attributes per session from the real document.referrer', async () => {
            // Session-scoped, so the Visitor rule is structural: only `page`
            // rows sessionize, and a session is one entry. The referrer must
            // come from original_referrer — on a page row `referer` is the
            // beacon XHR's own header (the current page), which would collapse
            // every session to a self-referral.
            const captured = captureSql();
            await TrafficService.getInstance().getTrafficSources(range);
            const sql = captured.sqls.join('\n');
            expect(sql).toContain("event_type = 'page'");
            expect(sql).toContain('entry_referer');
            expect(sql).toContain('argMin(tuple(original_referrer), timestamp).1');
            expect(sql).toContain('session_seq');
        });

        it('excludes resumed sessions without dropping direct arrivals', async () => {
            // A NULL entry_referer is a genuine direct arrival. `domain(NULL)`
            // is NULL and `NULL NOT IN (...)` is NULL, which SQL treats as
            // false — so without the explicit NULL branch this predicate would
            // delete the largest bucket on the panel. Guard the branch, not
            // just the exclusion. Exercised directly because the site host is
            // unresolvable under test (no Mongo config, no SITE_URL).
            TrafficService.setDependencies(createMockClickHouse(), createMockLogger());
            const service = TrafficService.getInstance() as unknown as {
                acquisitionSessionFilter(siteHost: string | null): string;
            };
            const predicate = service.acquisitionSessionFilter('tronrelic.com');
            expect(predicate).toContain('NOT IN ({siteHost:String}');
            expect(predicate).toContain("entry_referer IS NULL OR entry_referer = ''");
            // Parenthesised so composing it after another condition with AND
            // cannot re-associate the ORs and re-admit excluded rows.
            expect(predicate.trim().startsWith('(')).toBe(true);
            expect(predicate.trim().endsWith(')')).toBe(true);
        });

        it('keeps every session when the site host cannot be resolved', async () => {
            // Degrading to GA4's behaviour is the intended failure mode; the
            // alternative — an empty host in the NOT IN — would silently drop
            // real arrivals.
            TrafficService.setDependencies(createMockClickHouse(), createMockLogger());
            const service = TrafficService.getInstance() as unknown as {
                acquisitionSessionFilter(siteHost: string | null): string;
            };
            expect(service.acquisitionSessionFilter(null)).toBe('');
        });

        it('getTrafficSourceDetails drills into the same session cohort as the aggregate', async () => {
            // The drill-down must share getTrafficSources' cohort definition.
            // While it was first-touch and the aggregate was session-scoped, a
            // visitor acquired direct who returned from Google counted in the
            // Google row but had no in-window Google bootstrap row — so the
            // expanded panel rendered empty beneath a non-empty row.
            // A non-empty cohort is required: a zero visitor count short-circuits
            // to the empty shell before any breakdown query is built.
            const sqls: string[] = [];
            const ch = createMockClickHouse();
            ch.query = async <T>(sql: string): Promise<T[]> => {
                sqls.push(sql);
                return (sql.includes('avg(duration_s)')
                    ? [{ visitors: 3, sessions: 5, avgDurationS: 42 }]
                    : []) as T[];
            };
            TrafficService.setDependencies(ch, createMockLogger());
            await TrafficService.getInstance().getTrafficSourceDetails(range, 'google.com');
            const sql = sqls.join('\n');
            expect(sql).toContain('session_seq');
            expect(sql).toContain('{source:String}');
            // Every breakdown groups the session's entry hit, not raw events.
            expect(sql).toContain('entry_path AS path');
            expect(sql).toContain('entry_country AS country');
            expect(sql).toContain('entry_device AS device');
            expect(sql).toContain('entry_utm_campaign AS campaign');
            // The superseded first-touch cohort is gone.
            expect(sql).not.toContain("event_type = 'bootstrap'");
        });

        it('separates the acquisition projection from its neighbours correctly', async () => {
            // The projection is spliced between a column that already ends in a
            // comma and the window function that follows, so a leading comma
            // doubles one separator and drops the other. ClickHouse answers with
            // a syntax error, the read swallows it and returns the empty shell,
            // and the panel silently renders zeroes under a populated aggregate
            // row — a failure no assertion on cohort *shape* can catch, because
            // every expected fragment is still present in the broken SQL.
            const captured = captureSql();
            await TrafficService.getInstance().getTrafficSourceDetails(range, 'google.com');
            const sql = captured.sqls.join('\n');
            expect(sql).not.toMatch(/,\s*,/);
            expect(sql).toMatch(/utm_campaign,\s+sum\(is_new\)/);
            expect(sql).toMatch(/utm_campaign,\s+if\(dateDiff/);
        });

        it('only projects acquisition columns when a caller needs them', async () => {
            // Every session read would otherwise pay for five extra columns to
            // serve the one caller that breaks a cohort down by them.
            const captured = captureSql();
            await TrafficService.getInstance().getEngagementMetrics(range);
            expect(captured.sqls.join('\n')).not.toContain('entry_country');
        });

        it('getTopLandingPages groups session entry paths, not every navigation', async () => {
            const captured = captureSql();
            await TrafficService.getInstance().getTopLandingPages(range);
            const sql = captured.sqls.join('\n');
            expect(sql).toContain('entry_path AS path');
            expect(sql).toContain('session_seq');
            // The bootstrap-only restriction is gone; sessionizing is what
            // keeps this from becoming a most-viewed-pages table.
            expect(sql).not.toContain("event_type = 'bootstrap'");
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
                // The top-paths/top-countries/top-sources queries are the more
                // specific `GROUP BY bucket, <dim>` and must be matched before the
                // series' plain `GROUP BY bucket`.
                if (sql.includes('GROUP BY bucket, path')) {
                    return [{ bucket: '2026-06-01 05:00:00', path: '/markets', hits: '4' }] as T[];
                }
                if (sql.includes('GROUP BY bucket, country')) {
                    return [{ bucket: '2026-06-01 05:00:00', country: 'US', visitors: '5' }] as T[];
                }
                if (sql.includes('GROUP BY bucket, source')) {
                    return [{ bucket: '2026-06-01 05:00:00', source: 'google.com', visitors: '6' }] as T[];
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
            // The top-paths and top-countries queries are scoped to interactive
            // page rows, same as the series, so bot-only bootstrap dimensions
            // never surface.
            expect(sqls.some(s => s.includes('GROUP BY bucket, path') && s.includes("event_type = 'page'"))).toBe(true);
            expect(sqls.some(s => s.includes('GROUP BY bucket, country') && s.includes("event_type = 'page'") && s.includes('country IS NOT NULL'))).toBe(true);
            // The sources query attributes bucket page views to each viewer's
            // first-touch bootstrap origin via a join (argMin over bootstrap rows).
            expect(sqls.some(s => s.includes('GROUP BY bucket, source') && s.includes("event_type = 'bootstrap'") && s.includes('argMin'))).toBe(true);
            // 00:00 through 24:00 inclusive — 25 hourly buckets, one populated.
            expect(out.series).toHaveLength(25);
            // The populated bucket carries its ranked paths, countries, and sources as metadata.
            expect(out.series.find(p => p.bucket === '2026-06-01T05:00:00.000Z'))
                .toEqual({ bucket: '2026-06-01T05:00:00.000Z', visitors: 3, pageviews: 7, topPaths: [{ path: '/markets', hits: 4 }], topCountries: [{ country: 'US', visitors: 5 }], topSources: [{ source: 'google.com', visitors: 6 }] });
            // Zero-traffic buckets carry empty breakdown lists, never undefined.
            expect(out.series.find(p => p.bucket === '2026-06-01T02:00:00.000Z')?.topPaths).toEqual([]);
            expect(out.series.find(p => p.bucket === '2026-06-01T02:00:00.000Z')?.topCountries).toEqual([]);
            expect(out.series.find(p => p.bucket === '2026-06-01T02:00:00.000Z')?.topSources).toEqual([]);
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
        const RESOLVED_TIDS = [{ candidate_uid: 'tid-a' }, { candidate_uid: 'tid-b' }];

        /**
         * Build a mock whose `query` resolves the ignored candidate_uid set for
         * the DISTINCT-resolution query (issued by setIgnoredUserIds) and captures
         * the last non-resolution read for assertions.
         *
         * @param captured - Sink for the last read's sql/params.
         * @param readRow - Row shape a read query should return.
         * @returns The configured mock ClickHouse double.
         */
        function mockWithResolver(
            captured: { sql?: string; params?: Record<string, unknown> },
            readRow: Record<string, unknown> = {}
        ): ReturnType<typeof createMockClickHouse> {
            const ch = createMockClickHouse();
            ch.query = async <T>(sql: string, params?: unknown): Promise<T[]> => {
                if (sql.includes('SELECT DISTINCT candidate_uid')) {
                    return RESOLVED_TIDS as T[];
                }
                captured.sql = sql;
                captured.params = params as Record<string, unknown>;
                return [readRow] as T[];
            };
            return ch;
        }

        it('resolves the whole-person tid set once and injects it as a literal on reads', async () => {
            const captured: { sql?: string; params?: Record<string, unknown> } = {};
            TrafficService.setDependencies(mockWithResolver(captured), createMockLogger());
            const svc = TrafficService.getInstance();
            await svc.setIgnoredUserIds(IGNORED);

            await svc.getGeoDistribution({ since: new Date('2026-06-01T00:00:00.000Z') });

            // Read filters against the resolved literal tid set — no per-read
            // subquery on the unindexed user_id column.
            expect(captured.sql).toContain('candidate_uid NOT IN ({ignoredCandidateUids:Array(String)})');
            expect(captured.sql).not.toContain('SELECT candidate_uid FROM');
            expect(captured.params?.ignoredCandidateUids).toEqual(['tid-a', 'tid-b']);
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

            expect(captured.sql).not.toContain('ignoredCandidateUids');
            expect(captured.params?.ignoredCandidateUids).toBeUndefined();
        });

        it('excludes ignored accounts from the live visitor count (own WHERE path)', async () => {
            const captured: { sql?: string; params?: Record<string, unknown> } = {};
            TrafficService.setDependencies(mockWithResolver(captured, { visitors: '3' }), createMockLogger());
            const svc = TrafficService.getInstance();
            await svc.setIgnoredUserIds(IGNORED);

            await svc.getLiveVisitorCount();

            expect(captured.sql).toContain('INTERVAL 5 MINUTE');
            expect(captured.sql).toContain('candidate_uid NOT IN ({ignoredCandidateUids:Array(String)})');
            expect(captured.params?.ignoredCandidateUids).toEqual(['tid-a', 'tid-b']);
        });
    });

    describe('country scope', () => {
        const COUNTRY_FILTER = 'country = {country:String}';

        /**
         * Wire a mock ClickHouse that records every query with its params, so
         * a test can check that each one carries the country filter.
         *
         * @returns The captured queries in issue order.
         */
        function captureQueries(): { queries: Array<{ sql: string; params: Record<string, unknown> }> } {
            const captured = { queries: [] as Array<{ sql: string; params: Record<string, unknown> }> };
            const ch = createMockClickHouse();
            ch.query = async <T>(sql: string, params?: unknown): Promise<T[]> => {
                captured.queries.push({ sql, params: (params ?? {}) as Record<string, unknown> });
                return [] as T[];
            };
            TrafficService.setDependencies(ch, createMockLogger());
            return captured;
        }

        it('binds the country as a parameter on a row-level read', async () => {
            // Bound rather than spliced, so the value cannot alter the SQL.
            const captured = captureQueries();

            await TrafficService.getInstance().getDeviceBreakdown(
                { since: new Date('2026-06-01T00:00:00.000Z'), country: 'KR' }
            );

            expect(captured.queries[0]!.sql).toContain(COUNTRY_FILTER);
            expect(captured.queries[0]!.params.country).toBe('KR');
        });

        it('adds no filter when no country is requested', async () => {
            const captured = captureQueries();

            await TrafficService.getInstance().getDeviceBreakdown({ since: new Date('2026-06-01T00:00:00.000Z') });

            expect(captured.queries[0]!.sql).not.toContain(COUNTRY_FILTER);
            expect(captured.queries[0]!.params.country).toBeUndefined();
        });

        it('narrows the derived-session scan behind the source read', async () => {
            // Sources are built from derived sessions, which assemble their own
            // window in sessionRangeParams rather than reusing rangeParams'
            // clause, so the filter has to be applied there separately.
            const captured = captureQueries();

            await TrafficService.getInstance().getTrafficSources(
                { since: new Date('2026-06-01T00:00:00.000Z'), country: 'KR' }
            );

            const sourceQuery = captured.queries.find(query => query.sql.includes('AS source'));
            expect(sourceQuery?.sql).toContain(COUNTRY_FILTER);
            expect(sourceQuery?.params.country).toBe('KR');
        });

        it('scopes the previous comparison window of the overview too', async () => {
            // A country-scoped current window compared against an all-country
            // previous window would report a collapse that never happened.
            const captured = captureQueries();

            await TrafficService.getInstance().getOverviewTrend({
                since: new Date('2026-06-01T00:00:00.000Z'),
                until: new Date('2026-06-08T00:00:00.000Z'),
                country: 'KR'
            });

            expect(captured.queries.length).toBeGreaterThan(0);
            for (const query of captured.queries) {
                expect(query.sql).toContain(COUNTRY_FILTER);
                expect(query.params.country).toBe('KR');
            }
        });
    });

    describe('isIgnored()', () => {
        const IGNORED = ['665f00000000000000000001'];

        /**
         * Build a ClickHouse double whose resolution query returns `tid-a` as
         * the one browser that has logged in as an ignored account.
         *
         * @returns The configured mock ClickHouse double.
         */
        function mockResolvingTidA(): ReturnType<typeof createMockClickHouse> {
            const ch = createMockClickHouse();
            ch.queue.push({ candidate_uid: 'tid-a' });
            return ch;
        }

        it('matches an ignored account by user id', async () => {
            TrafficService.setDependencies(mockResolvingTidA(), createMockLogger());
            const svc = TrafficService.getInstance();
            await svc.setIgnoredUserIds(IGNORED);

            expect(svc.isIgnored({ userId: IGNORED[0], tid: null })).toBe(true);
        });

        it('matches an anonymous request from a tid that once logged in as an ignored account', async () => {
            TrafficService.setDependencies(mockResolvingTidA(), createMockLogger());
            const svc = TrafficService.getInstance();
            await svc.setIgnoredUserIds(IGNORED);

            expect(svc.isIgnored({ userId: null, tid: 'tid-a' })).toBe(true);
        });

        it('matches an uppercase tid against the lowercase set ClickHouse returns', async () => {
            const ch = createMockClickHouse();
            ch.queue.push({ candidate_uid: '550e8400-e29b-41d4-a716-446655440000' });
            TrafficService.setDependencies(ch, createMockLogger());
            const svc = TrafficService.getInstance();
            await svc.setIgnoredUserIds(IGNORED);

            expect(svc.isIgnored({ tid: '550E8400-E29B-41D4-A716-446655440000' })).toBe(true);
        });

        it('does not match a visitor with neither identifier on the list', async () => {
            TrafficService.setDependencies(mockResolvingTidA(), createMockLogger());
            const svc = TrafficService.getInstance();
            await svc.setIgnoredUserIds(IGNORED);

            expect(svc.isIgnored({ userId: 'someone-else', tid: 'tid-z' })).toBe(false);
            expect(svc.isIgnored({})).toBe(false);
        });

        it('stops matching once the list is cleared', async () => {
            TrafficService.setDependencies(mockResolvingTidA(), createMockLogger());
            const svc = TrafficService.getInstance();
            await svc.setIgnoredUserIds(IGNORED);
            await svc.setIgnoredUserIds([]);

            expect(svc.isIgnored({ userId: IGNORED[0], tid: 'tid-a' })).toBe(false);
        });

        it('keeps the previous tid set when resolution fails, but still matches the new user ids', async () => {
            const ch = mockResolvingTidA();
            TrafficService.setDependencies(ch, createMockLogger());
            const svc = TrafficService.getInstance();
            await svc.setIgnoredUserIds(IGNORED);

            ch.error = new Error('ClickHouse down');
            await svc.setIgnoredUserIds([...IGNORED, '665f00000000000000000002']);

            expect(svc.isIgnored({ tid: 'tid-a' })).toBe(true);
            expect(svc.isIgnored({ userId: '665f00000000000000000002' })).toBe(true);
        });

        it('matches by user id even without ClickHouse', async () => {
            TrafficService.setDependencies(undefined, createMockLogger());
            const svc = TrafficService.getInstance();
            await svc.setIgnoredUserIds(IGNORED);

            expect(svc.isIgnored({ userId: IGNORED[0] })).toBe(true);
            expect(svc.isIgnored({ tid: 'tid-a' })).toBe(false);
        });
    });
});
