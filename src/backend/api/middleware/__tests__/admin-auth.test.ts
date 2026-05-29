/// <reference types="vitest" />

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ISystemLogService } from '@/types';
import { createMockDatabaseService } from '../../../tests/vitest/mocks/database-service.js';

// Mock the env module with a getter that reads process.env at access time.
// The real env module Zod-parses process.env once at import; tests need
// ADMIN_API_TOKEN to vary across cases without resetting modules.
vi.mock('../../../config/env.js', () => ({
    env: new Proxy({} as Record<string, any>, {
        get(_target, key: string) {
            return process.env[key];
        }
    })
}));

import { GroupService } from '../../../modules/user/services/group.service.js';
import { AUTH_USERS_COLLECTION } from '../../../modules/user/services/auth-constants.js';
import {
    setAuthInstance,
    resetAuthInstanceForTests
} from '../../../modules/user/services/auth-facade.js';
import { requireAdmin } from '../admin-auth.js';

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

const SERVICE_TOKEN = 'test-service-token-1234567890abcdef';

function makeReqRes(opts: { headerToken?: string; bearer?: string } = {}) {
    const req: any = {
        headers: {} as Record<string, string>,
        adminVia: undefined as 'user' | 'service-token' | undefined,
        userId: undefined as string | undefined
    };
    if (opts.headerToken !== undefined) req.headers['x-admin-token'] = opts.headerToken;
    if (opts.bearer !== undefined) req.headers['authorization'] = `Bearer ${opts.bearer}`;

    let status = 200;
    let body: any = null;
    const res: any = {
        status(code: number) { status = code; return res; },
        json(data: any) { body = data; return res; },
        get statusCode() { return status; },
        get jsonBody() { return body; }
    };

    let nextCalled = false;
    const next = () => { nextCalled = true; };

    return { req, res, next, called: () => nextCalled };
}

/**
 * Build a stubbed Better Auth instance whose `getSession` returns a fixed
 * value regardless of input headers.
 */
function makeStubAuth(session: { user: { id: string; email: string }; session?: unknown } | null) {
    return {
        api: {
            getSession: vi.fn(async () => session)
        }
    } as any;
}

describe('requireAdmin middleware', () => {
    let mockDb: ReturnType<typeof createMockDatabaseService>;

    /**
     * Seed a Better Auth user row directly into the auth users collection
     * so GroupService.getUserGroups resolves the caller's groups during
     * facade session augmentation.
     */
    function seedBaUser(userId: string, groups: string[]): void {
        mockDb.getCollectionData(AUTH_USERS_COLLECTION).push({
            _id: userId,
            email: `${userId}@example.com`,
            emailVerified: true,
            groups
        });
    }

    beforeEach(() => {
        mockDb = createMockDatabaseService();
        GroupService.resetForTests();
        GroupService.setDependencies(mockDb, new NullLogger());
        resetAuthInstanceForTests();
        // Default: service token disabled. Each describe sets it as needed.
        delete process.env.ADMIN_API_TOKEN;
    });

    afterEach(() => {
        resetAuthInstanceForTests();
        GroupService.resetForTests();
    });

    describe('Better Auth session path', () => {
        it('approves a BA admin session and tags adminVia="user" with the BA user id', async () => {
            setAuthInstance(makeStubAuth({
                user: { id: 'ba_admin_1', email: 'a@b.com' },
                session: { id: 's1', token: 't', expiresAt: new Date().toISOString() }
            }));
            seedBaUser('ba_admin_1', ['admin']);

            const { req, res, next, called } = makeReqRes();
            await requireAdmin(req, res, next);

            expect(called()).toBe(true);
            expect(req.adminVia).toBe('user');
            expect(req.userId).toBe('ba_admin_1');
        });

        it('rejects a non-admin BA session — there is no legacy fallback', async () => {
            // Service token set so the failed session path lands on 401, not 503.
            process.env.ADMIN_API_TOKEN = SERVICE_TOKEN;
            setAuthInstance(makeStubAuth({
                user: { id: 'ba_plain', email: 'p@b.com' },
                session: { id: 's2', token: 't', expiresAt: new Date().toISOString() }
            }));
            seedBaUser('ba_plain', ['vip']);

            const { req, res, next, called } = makeReqRes();
            await requireAdmin(req, res, next);

            expect(called()).toBe(false);
            expect(res.statusCode).toBe(401);
        });

        it('rejects when no BA session is present (401 with service token configured)', async () => {
            process.env.ADMIN_API_TOKEN = SERVICE_TOKEN;
            setAuthInstance(makeStubAuth(null));

            const { req, res, next, called } = makeReqRes();
            await requireAdmin(req, res, next);

            expect(called()).toBe(false);
            expect(res.statusCode).toBe(401);
        });
    });

    describe('service-token path', () => {
        beforeEach(() => {
            process.env.ADMIN_API_TOKEN = SERVICE_TOKEN;
            // No admin session — exercise the service-token fallback in isolation.
            setAuthInstance(makeStubAuth(null));
        });

        it('approves via x-admin-token header and tags adminVia="service-token"', async () => {
            const { req, res, next, called } = makeReqRes({ headerToken: SERVICE_TOKEN });
            await requireAdmin(req, res, next);

            expect(called()).toBe(true);
            expect(req.adminVia).toBe('service-token');
        });

        it('approves via Authorization Bearer header', async () => {
            const { req, res, next, called } = makeReqRes({ bearer: SERVICE_TOKEN });
            await requireAdmin(req, res, next);

            expect(called()).toBe(true);
            expect(req.adminVia).toBe('service-token');
        });

        it('rejects when token is wrong', async () => {
            const { req, res, next, called } = makeReqRes({ headerToken: 'wrong-token' });
            await requireAdmin(req, res, next);

            expect(called()).toBe(false);
            expect(res.statusCode).toBe(401);
        });

        it('treats an empty x-admin-token as no candidate', async () => {
            const { req, res, next, called } = makeReqRes({ headerToken: '' });
            await requireAdmin(req, res, next);

            expect(called()).toBe(false);
            expect(res.statusCode).toBe(401);
        });
    });

    describe('admin disabled', () => {
        it('returns 503 when ADMIN_API_TOKEN is unset and no admin session resolves', async () => {
            // ADMIN_API_TOKEN already deleted in the outer beforeEach.
            setAuthInstance(makeStubAuth(null));

            const { req, res, next, called } = makeReqRes();
            await requireAdmin(req, res, next);

            expect(called()).toBe(false);
            expect(res.statusCode).toBe(503);
        });
    });

    describe('session path precedence', () => {
        it('admits the BA admin session even when a service token is also present', async () => {
            process.env.ADMIN_API_TOKEN = SERVICE_TOKEN;
            setAuthInstance(makeStubAuth({
                user: { id: 'ba_admin_3', email: 'a@b.com' },
                session: { id: 's3', token: 't', expiresAt: new Date().toISOString() }
            }));
            seedBaUser('ba_admin_3', ['admin']);

            const { req, res, next, called } = makeReqRes({ headerToken: SERVICE_TOKEN });
            await requireAdmin(req, res, next);

            expect(called()).toBe(true);
            expect(req.adminVia).toBe('user');
            expect(req.userId).toBe('ba_admin_3');
        });
    });
});
