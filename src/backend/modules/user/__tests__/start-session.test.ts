/// <reference types="vitest" />

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { IClickHouseService, ISystemLogService } from '@/types';
import { UserService } from '../services/user.service.js';
import { TrafficService, type ITrafficEvent } from '../services/traffic.service.js';
import { createMockDatabaseService } from '../../../tests/vitest/mocks/database-service.js';

vi.mock('../../auth/signature.service.js', () => ({
    SignatureService: class {
        normalizeAddress(a: string) { return a; }
        async verifyMessage(a: string) { return a; }
    }
}));

/**
 * Tests for Phase 3 of the traffic-events split: `startSession` is the
 * first Mongo write in the visitor lifecycle, and it pulls first-touch
 * attribution from ClickHouse when a pre-hydration `bootstrap` event
 * exists for the same UUID.
 *
 * These tests assert two behaviours together because they're load-
 * bearing in the same code path:
 *   1. Upsert — `startSession` creates the row when bootstrap didn't.
 *   2. First-touch backfill — when CH has a `bootstrap` event for the
 *      visitor, prefer its attribution dimensions over the post-hydration
 *      session payload.
 */

class MockCache {
    private store = new Map<string, any>();
    async get<T>(k: string) { return (this.store.get(k) ?? null) as T | null; }
    async set<T>(k: string, v: T) { this.store.set(k, v); }
    async del(k: string) { return this.store.delete(k) ? 1 : 0; }
    async invalidate() { /* unused */ }
    async keys() { return []; }
}

class NullLogger implements ISystemLogService {
    info() {} warn() {} error() {} debug() {} trace() {} fatal() {}
    child(): ISystemLogService { return this; }
    async initialize() {} async saveLog() {}
    async getLogs() { return { logs: [], total: 0, page: 1, limit: 50, totalPages: 0, hasNextPage: false, hasPrevPage: false }; }
    async markAsResolved() {} async markAsUnresolved() { return null; }
    async cleanup() { return 0; }
    async getStatistics(): Promise<any> { return { total: 0, byLevel: {}, byService: {}, unresolved: 0 }; }
    async getLogById() { return null; }
    async deleteAllLogs() { return 0; }
    async getStats(): Promise<any> { return { total: 0, byLevel: {}, resolved: 0, unresolved: 0 }; }
    level = 'info';
}

/**
 * In-memory ClickHouse double. The traffic-service test in this folder
 * already exercises low-level shape concerns; here we only need a
 * `query()` that returns a pre-staged row so `startSession` can read it
 * back through `TrafficService.getEventsForUser`.
 */
function createMockClickHouse(rows: unknown[] = []): IClickHouseService {
    return {
        async connect() { /* noop */ },
        isConnected() { return true; },
        async ping() { return true; },
        async close() { /* noop */ },
        async exec() { /* noop */ },
        async insert() { /* noop */ },
        async query<T>() { return rows.slice() as T[]; }
    } as unknown as IClickHouseService;
}

const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000';

describe('UserService.startSession (Phase 3)', () => {
    let mockDb: ReturnType<typeof createMockDatabaseService>;
    let mockCache: MockCache;

    beforeEach(() => {
        mockDb = createMockDatabaseService();
        mockCache = new MockCache();
        UserService.resetInstance();
        TrafficService.resetInstance();
    });

    function bootService(clickhouse?: IClickHouseService) {
        TrafficService.setDependencies(clickhouse, new NullLogger());
        UserService.setDependencies(
            mockDb,
            mockCache,
            new NullLogger(),
            {
                getSiteUrl: async () => 'http://localhost:3000',
                getConfig: async () => ({ siteUrl: 'http://localhost:3000' }),
                updateConfig: async (u: any) => u,
                clearCache: () => {}
            } as any,
            {} as any
        );
        const userService = UserService.getInstance();
        userService.setTrafficService(TrafficService.getInstance());
        return userService;
    }

    it('upserts a new user row when bootstrap left no record', async () => {
        // Pre-Phase-3 this would have thrown "User not found" because
        // bootstrap was the only writer. Phase 2 dropped the bootstrap
        // write, so `startSession` must create the row itself for
        // first-time visitors (humans who actually run JS — bots never
        // reach this endpoint).
        const userService = bootService();
        const collection = mockDb.getCollection('users');

        const before = await collection.findOne({ id: VALID_UUID });
        expect(before).toBeNull();

        const session = await userService.startSession({
            userId: VALID_UUID,
            userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
            landingPage: '/markets',
            screenWidth: 1920
        });

        expect(session.landingPage).toBe('/markets');
        expect(session.device).toBe('desktop');

        const persisted = await collection.findOne({ id: VALID_UUID });
        expect(persisted).not.toBeNull();
        expect(persisted?.identityState).toBe('anonymous');
        expect(persisted?.activity?.sessionsCount).toBe(1);
    });

    it('prefers ClickHouse first-touch attribution over post-hydration session payload', async () => {
        // The visitor's first impression was a cookieless crawler GET
        // for `/articles/tron-energy` from a duckduckgo referrer; the
        // middleware bootstrapped them and wrote a CH row. Some time
        // later they hit `/markets` from the homepage with JS enabled,
        // and the frontend fires session/start. Phase 3 says: attribute
        // to the duckduckgo first-touch, not the homepage navigation.
        const firstTouch = {
            event_type: 'bootstrap',
            timestamp: '2026-04-30 10:00:00.000',
            candidate_uid: VALID_UUID,
            path: '/articles/tron-energy',
            referer: 'https://duckduckgo.com/?q=tron+energy',
            original_referrer: null,
            user_agent: 'Mozilla/5.0 (compatible; Googlebot/2.1)',
            accept_language: 'en-US',
            country: 'DE',
            device: 'desktop',
            bot_class: null,
            utm_source: 'duckduckgo',
            utm_medium: 'organic',
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
        const userService = bootService(createMockClickHouse([firstTouch]));

        const session = await userService.startSession({
            userId: VALID_UUID,
            userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
            clientIP: '127.0.0.1',
            landingPage: '/markets',
            bodyReferrer: 'https://tronrelic.com/',
            rawUtm: { source: 'internal', medium: 'nav' }
        });

        // First-touch wins on every dimension it carries.
        expect(session.landingPage).toBe('/articles/tron-energy');
        expect(session.country).toBe('DE');
        expect(session.referrerDomain).toBe('duckduckgo.com');
        expect(session.searchKeyword).toBe('tron energy');
        expect(session.utm).toEqual({
            source: 'duckduckgo',
            medium: 'organic',
            campaign: undefined,
            term: undefined,
            content: undefined
        });

        // The persisted `activity.origin` mirrors the first-touch row.
        const persisted = await mockDb.getCollection('users').findOne({ id: VALID_UUID });
        expect(persisted?.activity?.origin?.landingPage).toBe('/articles/tron-energy');
        expect(persisted?.activity?.origin?.country).toBe('DE');
        expect(persisted?.activity?.origin?.referrerDomain).toBe('duckduckgo.com');
    });

    it('falls back to post-hydration values when ClickHouse has no first-touch row', async () => {
        // No CH first-touch event for this UUID — `startSession` proceeds
        // with the post-hydration payload exactly as it did pre-Phase-3.
        const userService = bootService(createMockClickHouse([]));

        const session = await userService.startSession({
            userId: VALID_UUID,
            userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)',
            landingPage: '/markets',
            bodyReferrer: 'https://twitter.com/some/post',
            rawUtm: { source: 'twitter', medium: 'social' }
        });

        expect(session.landingPage).toBe('/markets');
        expect(session.referrerDomain).toBe('twitter.com');
        expect(session.utm).toEqual({
            source: 'twitter',
            medium: 'social',
            campaign: undefined,
            term: undefined,
            content: undefined
        });
        expect(session.device).toBe('mobile');
    });

    it('falls back to post-hydration values when no TrafficService is injected (no-CH deployment)', async () => {
        // Mirrors a deployment that boots without `CLICKHOUSE_HOST` set:
        // the user module never calls `setTrafficService`, so the service
        // cannot read first-touch events. Behaviour collapses to the
        // pre-Phase-3 path — the orphan-row fix still works because the
        // upsert is independent of the CH read.
        TrafficService.setDependencies(undefined, new NullLogger());
        UserService.setDependencies(
            mockDb,
            mockCache,
            new NullLogger(),
            {
                getSiteUrl: async () => 'http://localhost:3000',
                getConfig: async () => ({ siteUrl: 'http://localhost:3000' }),
                updateConfig: async (u: any) => u,
                clearCache: () => {}
            } as any,
            {} as any
        );
        const userService = UserService.getInstance();
        // Intentionally do NOT call setTrafficService.

        const session = await userService.startSession({
            userId: VALID_UUID,
            userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
            landingPage: '/markets'
        });

        expect(session.landingPage).toBe('/markets');
        expect(session.device).toBe('desktop');
        const persisted = await mockDb.getCollection('users').findOne({ id: VALID_UUID });
        expect(persisted).not.toBeNull();
    });
});
