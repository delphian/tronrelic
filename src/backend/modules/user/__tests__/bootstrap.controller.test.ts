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
        controller = new UserController(userService, {} as any, new NullLogger());
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
            signedCookies: {}
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
