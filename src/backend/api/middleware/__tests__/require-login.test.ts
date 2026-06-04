/// <reference types="vitest" />

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ObjectId } from 'mongodb';
import type { ISystemLogService } from '@/types';
import { createMockDatabaseService } from '../../../tests/vitest/mocks/database-service.js';

import { GroupService } from '../../../modules/identity/services/group.service.js';
import { AUTH_USERS_COLLECTION } from '../../../modules/identity/services/auth-constants.js';
import {
    setAuthInstance,
    resetAuthInstanceForTests
} from '../../../modules/identity/services/auth-facade.js';
import { requireLogin } from '../require-login.js';

/**
 * No-op ISystemLogService implementation injected into GroupService so
 * facade session augmentation runs without console noise during tests.
 */
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
    level = 'info';
}

// Better Auth exposes user ids as the 24-char hex form of the ObjectId
// `_id`; sessions carry the hex string and the users collection is keyed by
// the matching ObjectId.
const PLAIN_USER = 'd1d1d1d1d1d1d1d1d1d1d1d1';

/**
 * Build minimal Express req/res/next doubles for exercising the middleware:
 * the res records `status()`/`json()` calls for assertion, and `called()`
 * reports whether `next()` ran.
 */
function makeReqRes() {
    const req: any = {
        headers: {} as Record<string, string>,
        userId: undefined as string | undefined
    };

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

describe('requireLogin middleware', () => {
    let mockDb: ReturnType<typeof createMockDatabaseService>;

    /**
     * Seed a Better Auth user row directly into the auth users collection
     * so GroupService.getUserGroups resolves the caller's groups during
     * facade session augmentation.
     */
    function seedBaUser(userId: string, groups: string[]): void {
        mockDb.getCollectionData(AUTH_USERS_COLLECTION).push({
            _id: new ObjectId(userId),
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
    });

    afterEach(() => {
        resetAuthInstanceForTests();
        GroupService.resetForTests();
    });

    it('admits any authenticated account and sets req.userId for audit logging', async () => {
        setAuthInstance(makeStubAuth({
            user: { id: PLAIN_USER, email: 'p@b.com' },
            session: { id: 's1', token: 't', expiresAt: new Date().toISOString() }
        }));
        seedBaUser(PLAIN_USER, []);

        const { req, res, next, called } = makeReqRes();
        await requireLogin(req, res, next);

        expect(called()).toBe(true);
        expect(req.userId).toBe(PLAIN_USER);
        expect(res.statusCode).toBe(200);
    });

    it('rejects anonymous callers with 401', async () => {
        setAuthInstance(makeStubAuth(null));

        const { req, res, next, called } = makeReqRes();
        await requireLogin(req, res, next);

        expect(called()).toBe(false);
        expect(res.statusCode).toBe(401);
        expect(res.jsonBody).toEqual({ success: false, error: 'Authentication required' });
    });

    it('degrades a failed session resolution to 401, not a thrown error', async () => {
        // The facade swallows resolution failures and resolves to null, so
        // a BA/Mongo hiccup on a login-gated route surfaces as 401.
        setAuthInstance({
            api: {
                getSession: vi.fn(async () => { throw new Error('BA down'); })
            }
        } as any);

        const { req, res, next, called } = makeReqRes();
        await requireLogin(req, res, next);

        expect(called()).toBe(false);
        expect(res.statusCode).toBe(401);
    });
});
