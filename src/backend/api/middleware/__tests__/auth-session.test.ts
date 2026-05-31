/// <reference types="vitest" />

/**
 * @fileoverview Tests for the auth-session middleware.
 *
 * Verifies that the middleware populates `req.authSession` correctly
 * for anonymous and authenticated callers, skips `/api/auth/*` paths
 * to avoid duplicating Better Auth's internal lookup, and degrades
 * gracefully to `null` on resolution errors so the request lifecycle
 * keeps moving.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ObjectId } from 'mongodb';
import type { Request, Response, NextFunction } from 'express';
import type { ISystemLogService } from '@/types';
import { attachAuthSession } from '../auth-session.js';
import {
    setAuthInstance,
    resetAuthInstanceForTests
} from '../../../modules/identity/services/auth-facade.js';
import { GroupService } from '../../../modules/identity/services/group.service.js';
import { AUTH_USERS_COLLECTION } from '../../../modules/identity/services/auth-constants.js';
import { createMockDatabaseService } from '../../../tests/vitest/mocks/database-service.js';

// Better Auth exposes the user id as the 24-char hex form of the ObjectId
// `_id`; the session carries the hex string and the users collection is
// keyed by the matching ObjectId.
const USER_ABC = 'abcabcabcabcabcabcabcabc';

class StubLogger implements ISystemLogService {
    public level: string = 'info';
    info(): void {}
    warn(): void {}
    error(): void {}
    debug(): void {}
    trace(): void {}
    fatal(): void {}
    child(): ISystemLogService { return this; }
    async initialize(): Promise<void> {}
    async saveLog(): Promise<void> {}
    async getLogs(): Promise<any> {
        return { logs: [], total: 0, page: 1, limit: 50, totalPages: 0, hasNextPage: false, hasPrevPage: false };
    }
    async markAsResolved(): Promise<void> {}
    async cleanup(): Promise<number> { return 0; }
    async getStatistics(): Promise<any> { return { total: 0, byLevel: {}, byService: {}, unresolved: 0 }; }
    async getLogById(): Promise<any> { return null; }
    async markAsUnresolved(): Promise<any> { return null; }
    async deleteAllLogs(): Promise<number> { return 0; }
    async getStats(): Promise<any> { return { total: 0, byLevel: {}, resolved: 0, unresolved: 0 }; }
}

/**
 * Build a minimal Express-like request used by the middleware.
 *
 * The middleware only reads `req.path` and `req.headers`; the rest
 * of the Express request surface is unused and can be omitted.
 */
function makeRequest(path: string, headers: Record<string, string> = {}): Request {
    return { path, headers } as unknown as Request;
}

/**
 * Build a stubbed Better Auth instance whose `getSession` returns a
 * fixed value (or throws).
 */
function makeStubAuth(opts: {
    session?: { user: { id: string; email: string }; session?: any } | null;
    throws?: Error;
}) {
    return {
        api: {
            getSession: vi.fn(async () => {
                if (opts.throws) throw opts.throws;
                return opts.session ?? null;
            })
        }
    } as any;
}

describe('attachAuthSession middleware', () => {
    let mockDatabase: ReturnType<typeof createMockDatabaseService>;

    beforeEach(() => {
        mockDatabase = createMockDatabaseService();
        GroupService.resetForTests();
        GroupService.setDependencies(mockDatabase, new StubLogger());
    });

    afterEach(() => {
        resetAuthInstanceForTests();
        GroupService.resetForTests();
    });

    it('sets req.authSession = null for anonymous callers', async () => {
        setAuthInstance(makeStubAuth({ session: null }));
        const req = makeRequest('/api/markets');
        const res = {} as Response;
        const next = vi.fn() as unknown as NextFunction;

        await attachAuthSession(req, res, next);

        const populated = req as Request & { authSession?: unknown };
        expect(populated.authSession).toBeNull();
        expect(next).toHaveBeenCalledOnce();
    });

    it('sets req.authSession to the augmented session for logged-in callers', async () => {
        setAuthInstance(makeStubAuth({
            session: {
                user: { id: USER_ABC, email: 'a@b.com' },
                session: { id: 'sess_1', token: 't', expiresAt: new Date().toISOString() }
            }
        }));
        mockDatabase.getCollectionData(AUTH_USERS_COLLECTION).push({
            _id: new ObjectId(USER_ABC),
            email: 'a@b.com',
            emailVerified: true,
            groups: ['admin', 'vip']
        });

        const req = makeRequest('/api/markets');
        const res = {} as Response;
        const next = vi.fn() as unknown as NextFunction;

        await attachAuthSession(req, res, next);

        const populated = req as Request & { authSession?: { user: { id: string }; groups: string[] } | null };
        expect(populated.authSession).not.toBeNull();
        expect(populated.authSession?.user.id).toBe(USER_ABC);
        expect(populated.authSession?.groups).toEqual(expect.arrayContaining(['admin', 'vip']));
        expect(next).toHaveBeenCalledOnce();
    });

    it('skips resolution and leaves req.authSession undefined on /api/auth paths', async () => {
        const stubAuth = makeStubAuth({ session: null });
        setAuthInstance(stubAuth);
        const req = makeRequest('/api/auth/sign-in/email');
        const res = {} as Response;
        const next = vi.fn() as unknown as NextFunction;

        await attachAuthSession(req, res, next);

        const populated = req as Request & { authSession?: unknown };
        expect(populated.authSession).toBeUndefined();
        expect(stubAuth.api.getSession).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalledOnce();
    });

    it('skips on the exact /api/auth root path too', async () => {
        const stubAuth = makeStubAuth({ session: null });
        setAuthInstance(stubAuth);
        const req = makeRequest('/api/auth');
        const res = {} as Response;
        const next = vi.fn() as unknown as NextFunction;

        await attachAuthSession(req, res, next);

        expect((req as Request & { authSession?: unknown }).authSession).toBeUndefined();
        expect(stubAuth.api.getSession).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalledOnce();
    });

    it('sets req.authSession = null and still calls next() when resolution throws', async () => {
        setAuthInstance(makeStubAuth({ throws: new Error('mongo unreachable') }));
        const req = makeRequest('/api/markets');
        const res = {} as Response;
        const next = vi.fn() as unknown as NextFunction;

        await attachAuthSession(req, res, next);

        const populated = req as Request & { authSession?: unknown };
        expect(populated.authSession).toBeNull();
        expect(next).toHaveBeenCalledOnce();
    });
});
