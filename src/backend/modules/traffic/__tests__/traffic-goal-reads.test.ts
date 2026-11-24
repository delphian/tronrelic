/// <reference types="vitest" />

/**
 * @fileoverview SQL-shape and mapping tests for the goal reads on
 * `TrafficService`. There is no ClickHouse in CI, so these capture the
 * generated SQL and pin the rules the README promises: goals go through the
 * same window, ignore-list, and bot-filter chokepoint as page views, goal
 * visitors follow the Visitor rule, and attribution reuses the session
 * definition the source and landing-page panels use, with goals that have no
 * session landing in explicit buckets instead of vanishing.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { IClickHouseService, ISystemLogService } from '@/types';
import { TrafficService, NO_TID, type ITrafficGoalEvent } from '../services/traffic.service.js';

const IGNORED_TID = '11111111-2222-4333-8444-555555555555';
const GOAL = 'resource-markets:outbound-click';
const range = { since: new Date('2026-11-01T00:00:00.000Z'), until: new Date('2026-11-08T00:00:00.000Z') };

/** A logger whose methods are spies, so failure paths can be asserted. */
function createMockLogger(): ISystemLogService {
    const fns = {
        debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn(), trace: vi.fn(),
        child: vi.fn(() => fns)
    } as unknown as ISystemLogService;
    return fns;
}

/**
 * Install a ClickHouse double that records every query and answers with the
 * given rows, and return what it captured.
 *
 * @param rows - Rows every query returns, or a function choosing them per SQL.
 */
function install(rows: unknown[] | ((sql: string) => unknown[]) = []): {
    sqls: string[]; params: Array<Record<string, unknown>>; inserts: Array<{ table: string; rows: unknown[] }>;
} {
    const captured = { sqls: [] as string[], params: [] as Array<Record<string, unknown>>, inserts: [] as Array<{ table: string; rows: unknown[] }> };
    const clickhouse = {
        async query<T>(sql: string, params?: Record<string, unknown>): Promise<T[]> {
            captured.sqls.push(sql);
            captured.params.push(params ?? {});
            return (typeof rows === 'function' ? rows(sql) : rows) as T[];
        },
        async insert(table: string, inserted: unknown[]) {
            captured.inserts.push({ table, rows: inserted });
        },
        async exec() { /* unused */ }
    } as unknown as IClickHouseService;
    TrafficService.setDependencies(clickhouse, createMockLogger());
    return captured;
}

describe('TrafficService goal reads', () => {
    beforeEach(() => {
        TrafficService.resetInstance();
    });

    it('stores a goal row in traffic_goal_events in ClickHouse wire format', async () => {
        const captured = install();
        const event: ITrafficGoalEvent = {
            timestamp: new Date('2026-11-02T10:00:00.000Z'), candidate_uid: NO_TID, user_id: null, goal: GOAL,
            properties: { market: 'tronsave' }, path: '/resource-markets', analytics_consent: 0, bot_class: 'human',
            bot_rule: null, country: 'DE', device: 'desktop', asn: null, ip_hash: null, subnet_hash: null
        };
        await TrafficService.getInstance().recordGoalEvent(event);
        expect(captured.inserts).toHaveLength(1);
        expect(captured.inserts[0]!.table).toBe('traffic_goal_events');
        expect((captured.inserts[0]!.rows[0] as { timestamp: string }).timestamp).toBe('2026-11-02 10:00:00.000');
    });

    it('resolves without recording or reading when ClickHouse is not configured', async () => {
        TrafficService.setDependencies(undefined, createMockLogger());
        const service = TrafficService.getInstance();
        await expect(service.recordGoalEvent({} as ITrafficGoalEvent)).resolves.toBeUndefined();
        expect(await service.getGoalSummary(range)).toEqual([]);
        expect(await service.getGoalAttribution(range, GOAL, 'source')).toEqual([]);
    });

    it('summarizes goals through the shared window, ignore list, and Visitor rule', async () => {
        const captured = install([
            { goal: GOAL, events: '9', visitors: '4', unattributed_events: '2', property_keys: ['placement', 'market'] }
        ]);
        const service = TrafficService.getInstance();
        await service.setIgnoredUserIds([]);
        // Seed the resolved tid set directly: there is no ClickHouse to resolve it from.
        (service as unknown as { ignoredCandidateUids: string[] }).ignoredCandidateUids = [IGNORED_TID];

        const rows = await service.getGoalSummary(range, true);
        const sql = captured.sqls[0]!;
        expect(sql).toContain('FROM traffic_goal_events');
        expect(sql).toContain('candidate_uid NOT IN ({ignoredCandidateUids:Array(String)})');
        expect(sql).toContain("(bot_class = 'human' OR bot_class IS NULL)");
        // A goal visitor must have a page event in the window, as every visitor must.
        expect(sql).toContain("event_type = 'page'");
        expect(sql).toContain('candidate_uid != toUUID({noTid:String})');
        expect(captured.params[0]!.noTid).toBe(NO_TID);
        expect(rows).toEqual([
            { goal: GOAL, events: 9, visitors: 4, unattributedEvents: 2, propertyKeys: ['market', 'placement'] }
        ]);
    });

    it('breaks one goal down by a bound property key and reports unset values as null', async () => {
        const captured = install([
            { value: 'tronsave', events: '5', visitors: '3' },
            { value: '', events: '1', visitors: '0' }
        ]);
        const rows = await TrafficService.getInstance().getGoalPropertyBreakdown(range, GOAL, 'market');
        expect(captured.sqls[0]).toContain('properties[{propertyKey:String}] AS value');
        expect(captured.sqls[0]).toContain('goal = {goal:String}');
        expect(captured.params[0]!.propertyKey).toBe('market');
        expect(rows[1]!.value).toBeNull();
    });

    it('attributes a goal to the session it happened in, using the panels\' session definition', async () => {
        const captured = install();
        await TrafficService.getInstance().getGoalAttribution(range, GOAL, 'source', true);
        const sql = captured.sqls[0]!;
        // The latest session of the same tid that started at or before the goal...
        expect(sql).toContain('ASOF LEFT JOIN');
        expect(sql).toContain('g.goal_uid = s.candidate_uid AND g.goal_at >= s.session_start');
        // ...and only while the goal is within one session gap of its last hit.
        expect(sql).toContain('goal_at >= session_end + INTERVAL 1800 SECOND');
        // Sessions are the derived page sessions, named by the source expression.
        expect(sql).toContain('session_seq');
        expect(sql).toContain('argMin(tuple(original_referrer), timestamp).1 AS entry_referer');
        expect(sql).toContain('domain(entry_referer)');
        // Goals without a tid or a session get explicit buckets.
        expect(sql).toContain("'unattributed'");
        expect(sql).toContain("'no-session'");
        // The bot filter reaches both the goal rows and the session page rows.
        expect(sql.match(/bot_class = 'human' OR bot_class IS NULL/g)!.length).toBeGreaterThanOrEqual(2);
        // A session already running at the window start is looked up from a day before it.
        const sinceWidened = String(captured.params[0]!.sinceWidened);
        expect(sinceWidened.startsWith('2026-10-31 00:00:00')).toBe(true);
    });

    it('groups by entry path for landing-page attribution', async () => {
        const captured = install();
        await TrafficService.getInstance().getGoalAttribution(range, GOAL, 'landing-page');
        expect(captured.sqls[0]).toContain("if(kind = 'session', entry_path, '') AS bucket");
    });

    it('labels the special buckets and lists them after the session buckets', async () => {
        install([
            { kind: 'unattributed', bucket: '', events: '2', visitors: '0', sessions: '0', medium: null, app: null },
            { kind: 'no-session', bucket: '', events: '1', visitors: '0', sessions: '0', medium: null, app: null },
            { kind: 'session', bucket: 'direct', events: '3', visitors: '3', sessions: '3', medium: '', app: '' },
            { kind: 'session', bucket: 'google.com', events: '5', visitors: '4', sessions: '4', medium: '', app: '' }
        ]);
        const buckets = await TrafficService.getInstance().getGoalAttribution(range, GOAL, 'source');
        expect(buckets.map(b => b.key)).toEqual(['google.com', 'direct', '(unattributed)', '(no session)']);
        expect(buckets[0]!.channel).toBe('organic');
        expect(buckets[2]!.channel).toBeNull();
        // Every event is in exactly one bucket.
        expect(buckets.reduce((sum, b) => sum + b.events, 0)).toBe(11);
    });

    it('lists goal rows with a goal filter and reports a missing tid as null', async () => {
        const captured = install([{
            timestamp: '2026-11-02 10:00:00.000', goal: GOAL, properties: { market: 'tronsave' }, candidate_uid: NO_TID,
            logged_in: 0, analytics_consent: 0, country: 'DE', device: 'desktop', bot_class: 'human', asn: null,
            path: '/resource-markets', ip_hash: null, subnet_hash: null
        }]);
        const page = await TrafficService.getInstance().listGoalEvents(range, { asn: 13335 }, GOAL, 20, 0);
        expect(captured.sqls[0]).toContain('FROM traffic_goal_events');
        expect(captured.sqls[0]).toContain('goal = {fGoal:String}');
        expect(captured.sqls[0]).toContain('asn = {fAsn:UInt32}');
        expect(captured.sqls[0]).not.toContain('event_type');
        expect(page.rows[0]!.tid).toBeNull();
        expect(page.rows[0]!.timestamp).toBe('2026-11-02T10:00:00.000Z');
        expect(page.rows[0]!.analyticsConsent).toBe(false);
    });
});
