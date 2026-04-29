/// <reference types="vitest" />

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ICacheService, ISystemLogService } from '@/types';
import { UserService } from '../services/user.service.js';
import { UserController } from '../api/user.controller.js';
import { USER_ID_COOKIE_NAME } from '../api/identity-cookie.js';
import { createMockDatabaseService } from '../../../tests/vitest/mocks/database-service.js';

vi.mock('../../auth/signature.service.js', () => ({
    SignatureService: class { normalizeAddress(a: string) { return a; } async verifyMessage(a: string) { return a; } }
}));

class MockCache implements ICacheService {
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
 * Stub Express response that captures cookie writes and JSON payloads so
 * tests can assert what the controller sent without booting Express.
 */
function makeRes() {
    const cookies: Array<{ name: string; value: string; options: any }> = [];
    let jsonBody: any = null;
    let statusCode = 200;
    return {
        cookies,
        get jsonBody() { return jsonBody; },
        get statusCode() { return statusCode; },
        cookie(name: string, value: string, options: any) {
            cookies.push({ name, value, options });
            return this as any;
        },
        status(code: number) { statusCode = code; return this as any; },
        json(body: any) { jsonBody = body; return this as any; }
    };
}

/**
 * Minimal `IUserGroupService` stand-in for the controller's response-shaping
 * helper. Bootstrap-controller tests don't exercise admin gating, so all
 * predicates collapse to "not an admin / no membership" and the
 * authStatus snapshot the response includes is the safe-default shape.
 */
function mockGroupService(): any {
    return {
        isAdmin: async () => false,
        isMember: async () => false,
        getUserGroups: async () => [],
        addMember: async () => {},
        removeMember: async () => {},
        setUserGroups: async () => [],
        getMembers: async () => ({ userIds: [], total: 0 })
    };
}

const VALID_UUID_A = '550e8400-e29b-41d4-a716-446655440000';
const VALID_UUID_B = '660e8400-e29b-41d4-a716-446655440001';

describe('UserController.bootstrap', () => {
    let userService: UserService;
    let controller: UserController;
    let mockDb: ReturnType<typeof createMockDatabaseService>;
    let mockCache: MockCache;

    beforeEach(() => {
        mockDb = createMockDatabaseService();
        mockCache = new MockCache();
        UserService.resetInstance();
        UserService.setDependencies(
            mockDb,
            mockCache,
            new NullLogger(),
            { getSiteUrl: async () => 'http://localhost:3000', getConfig: async () => ({ siteUrl: 'http://localhost:3000' }), updateConfig: async (u: any) => u, clearCache: () => {} } as any,
            {} as any
        );
        userService = UserService.getInstance();
        controller = new UserController(userService, {} as any, mockGroupService(), new NullLogger());
    });

    it('mints a fresh UUID and sets the HttpOnly cookie when no cookie is present', async () => {
        const req: any = { cookies: {}, signedCookies: {} };
        const res = makeRes();

        await controller.bootstrap(req, res as any);

        expect(res.statusCode).toBe(200);
        expect(res.jsonBody).not.toBeNull();
        expect(res.jsonBody.id).toMatch(/^[0-9a-f-]{36}$/);

        // Cookie must be set with HttpOnly and the same UUID returned in the body.
        expect(res.cookies).toHaveLength(1);
        expect(res.cookies[0].name).toBe(USER_ID_COOKIE_NAME);
        expect(res.cookies[0].value).toBe(res.jsonBody.id);
        expect(res.cookies[0].options.httpOnly).toBe(true);
        expect(res.cookies[0].options.sameSite).toBe('lax');
        expect(res.cookies[0].options.path).toBe('/');
    });

    it('returns the existing user and refreshes the cookie when a valid signed cookie is present', async () => {
        // Seed a user record.
        await userService.getOrCreate(VALID_UUID_A);

        // cookie-parser places HMAC-verified values on `signedCookies` and
        // strips them from `cookies`. The bootstrap controller reads from
        // signedCookies first.
        const req: any = {
            cookies: {},
            signedCookies: { [USER_ID_COOKIE_NAME]: VALID_UUID_A }
        };
        const res = makeRes();

        await controller.bootstrap(req, res as any);

        expect(res.jsonBody.id).toBe(VALID_UUID_A);
        // Cookie still set on every call — refreshes max-age and rewrites
        // legacy non-HttpOnly cookies into HttpOnly.
        expect(res.cookies).toHaveLength(1);
        expect(res.cookies[0].value).toBe(VALID_UUID_A);
        expect(res.cookies[0].options.httpOnly).toBe(true);
    });

    it('accepts an unsigned legacy cookie and re-anchors the user as signed', async () => {
        // Cookies issued before HMAC signing was introduced still carry
        // raw UUID values on `req.cookies`. The bootstrap controller falls
        // back to that path so visitors keep their identity during rollout;
        // `setIdentityCookie` then re-issues the cookie as signed.
        await userService.getOrCreate(VALID_UUID_A);

        const req: any = {
            cookies: { [USER_ID_COOKIE_NAME]: VALID_UUID_A },
            signedCookies: {},
            headers: {}
        };
        const res = makeRes();

        await controller.bootstrap(req, res as any);

        expect(res.jsonBody.id).toBe(VALID_UUID_A);
        expect(res.cookies[0].value).toBe(VALID_UUID_A);
        expect(res.cookies[0].options.signed).toBe(true);
    });

    it('treats a malformed cookie as missing and mints fresh', async () => {
        const req: any = {
            cookies: { [USER_ID_COOKIE_NAME]: 'not-a-uuid' },
            signedCookies: {}
        };
        const res = makeRes();

        await controller.bootstrap(req, res as any);

        expect(res.jsonBody.id).not.toBe('not-a-uuid');
        expect(res.jsonBody.id).toMatch(/^[0-9a-f-]{36}$/);
        expect(res.cookies[0].value).toBe(res.jsonBody.id);
    });

    it('resolves a merged tombstone and re-anchors the cookie to the canonical user', async () => {
        // Create canonical user A, then create B as a tombstone pointing to A.
        await userService.getOrCreate(VALID_UUID_A);
        await userService.getOrCreate(VALID_UUID_B);
        const collection = mockDb.getCollection('users');
        await collection.updateOne(
            { id: VALID_UUID_B },
            { $set: { mergedInto: VALID_UUID_A, wallets: [] } }
        );
        // Drop the cached pre-merge B so the next read hits the DB and
        // follows the merge pointer.
        await mockCache.del('user:' + VALID_UUID_B);

        const req: any = {
            cookies: {},
            signedCookies: { [USER_ID_COOKIE_NAME]: VALID_UUID_B }
        };
        const res = makeRes();

        await controller.bootstrap(req, res as any);

        // The body and the cookie should both reference the canonical user,
        // not the tombstone the request arrived with.
        expect(res.jsonBody.id).toBe(VALID_UUID_A);
        expect(res.cookies[0].value).toBe(VALID_UUID_A);
    });
});

describe('UserController.validateCookie', () => {
    let controller: UserController;
    let mockDb: ReturnType<typeof createMockDatabaseService>;
    let mockCache: MockCache;

    beforeEach(() => {
        mockDb = createMockDatabaseService();
        mockCache = new MockCache();
        UserService.resetInstance();
        UserService.setDependencies(
            mockDb,
            mockCache,
            new NullLogger(),
            { getSiteUrl: async () => 'http://localhost:3000', getConfig: async () => ({ siteUrl: 'http://localhost:3000' }), updateConfig: async (u: any) => u, clearCache: () => {} } as any,
            {} as any
        );
        controller = new UserController(UserService.getInstance(), {} as any, mockGroupService(), new NullLogger());
    });

    it('accepts the signed cookie and does NOT re-issue (avoids per-request Set-Cookie spam)', () => {
        // After PR #197 cookie-parser exposes verified UUIDs on
        // `signedCookies` and removes them from `cookies`. validateCookie
        // must read signedCookies first, otherwise every signed visitor
        // 401s on `/api/user/:id/...` calls (the original logout bug).
        // The re-issue path is unsigned-only — the signed visitor is
        // already in the target state, so emitting another Set-Cookie
        // header here would be pure noise on every authenticated call.
        const req: any = {
            params: { id: VALID_UUID_A },
            cookies: {},
            signedCookies: { [USER_ID_COOKIE_NAME]: VALID_UUID_A }
        };
        const res = makeRes();
        const next = vi.fn();

        controller.validateCookie(req, res as any, next);

        expect(next).toHaveBeenCalledOnce();
        expect(res.statusCode).toBe(200);
        expect(res.jsonBody).toBeNull();
        expect(res.cookies).toHaveLength(0);
    });

    it('falls back to the unsigned cookie and re-anchors it as signed on the response', () => {
        // Visitors whose cookie was minted before HMAC signing arrive
        // with a bare UUID on `req.cookies`. We accept it so they don't
        // lose access mid-rollout — and re-issue as signed on the same
        // response so the upgrade is universal across HTTP entry points,
        // not just bootstrap/userContextMiddleware. Without this a
        // non-browser caller hitting only /api/user/:id/... would never
        // visit a path that re-anchors.
        const req: any = {
            params: { id: VALID_UUID_A },
            cookies: { [USER_ID_COOKIE_NAME]: VALID_UUID_A },
            signedCookies: {},
            headers: {},
            path: '/api/user/' + VALID_UUID_A + '/logout'
        };
        const res = makeRes();
        const next = vi.fn();

        controller.validateCookie(req, res as any, next);

        expect(next).toHaveBeenCalledOnce();
        expect(res.statusCode).toBe(200);
        expect(res.cookies).toHaveLength(1);
        expect(res.cookies[0].name).toBe(USER_ID_COOKIE_NAME);
        expect(res.cookies[0].value).toBe(VALID_UUID_A);
        expect(res.cookies[0].options.signed).toBe(true);
        expect(res.cookies[0].options.httpOnly).toBe(true);
    });

    it('returns 401 when neither cookie source carries an identity', () => {
        const req: any = {
            params: { id: VALID_UUID_A },
            cookies: {},
            signedCookies: {}
        };
        const res = makeRes();
        const next = vi.fn();

        controller.validateCookie(req, res as any, next);

        expect(next).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(401);
        expect(res.jsonBody).toMatchObject({ error: 'Unauthorized' });
    });

    it('rejects a tampered signed cookie (signedCookies value is `false`)', () => {
        // cookie-parser surfaces forged signed cookies as the literal `false`.
        // The signed branch's `typeof === "string"` guard must reject it,
        // and the unsigned branch is empty, so the request 401s.
        const req: any = {
            params: { id: VALID_UUID_A },
            cookies: {},
            signedCookies: { [USER_ID_COOKIE_NAME]: false }
        };
        const res = makeRes();
        const next = vi.fn();

        controller.validateCookie(req, res as any, next);

        expect(next).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(401);
    });

    it('returns 403 when the cookie identity does not match :id', () => {
        const req: any = {
            params: { id: VALID_UUID_A },
            cookies: {},
            signedCookies: { [USER_ID_COOKIE_NAME]: VALID_UUID_B }
        };
        const res = makeRes();
        const next = vi.fn();

        controller.validateCookie(req, res as any, next);

        expect(next).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(403);
        expect(res.jsonBody).toMatchObject({ error: 'Forbidden' });
    });

    it('prefers the signed cookie over a stale unsigned cookie when both are present', () => {
        // Defensive: if both arrive (e.g. during the brief window after
        // the backend re-issued as signed but before the legacy cookie
        // has been overwritten), the signed value wins.
        const req: any = {
            params: { id: VALID_UUID_A },
            cookies: { [USER_ID_COOKIE_NAME]: VALID_UUID_B },
            signedCookies: { [USER_ID_COOKIE_NAME]: VALID_UUID_A }
        };
        const res = makeRes();
        const next = vi.fn();

        controller.validateCookie(req, res as any, next);

        expect(next).toHaveBeenCalledOnce();
        expect(res.statusCode).toBe(200);
    });
});
