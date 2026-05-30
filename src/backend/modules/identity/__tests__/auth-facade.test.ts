/// <reference types="vitest" />

/**
 * @fileoverview Phase 1 sanity tests for the auth facade.
 *
 * Covers the configuration contract (must call setAuthInstance before
 * any predicate) and the four predicate functions against a stubbed
 * auth instance. The facade routes group checks through the live
 * {@link GroupService} singleton, so tests configure both in
 * lockstep — same wiring as `IdentityModule.init()`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Request } from 'express';
import type { ISystemLogService } from '@/types';
import {
    isLoggedIn,
    isAnonymous,
    isInGroup,
    isAdmin,
    setAuthInstance,
    resetAuthInstanceForTests
} from '../services/auth-facade.js';
import { GroupService, ADMIN_GROUP_ID } from '../services/group.service.js';
import { AUTH_USERS_COLLECTION } from '../services/auth-constants.js';
import { createMockDatabaseService } from '../../../tests/vitest/mocks/database-service.js';

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
 * Construct an Express-like request stub with headers populated.
 *
 * The facade only reads `req.headers` (via {@link fromNodeHeaders} from
 * better-auth/node), so the rest of the Express request surface is
 * unused and can be omitted from the stub.
 */
function makeRequest(headers: Record<string, string> = {}): Request {
    return { headers } as unknown as Request;
}

/**
 * Build a stubbed Better Auth instance that returns a fixed session
 * (or null) regardless of the headers passed in.
 *
 * Sufficient for facade contract tests; full session validation lives
 * in Better Auth's own test suite.
 */
function makeStubAuth(session: { user: { id: string; email: string } } | null) {
    return {
        api: {
            getSession: vi.fn(async () => session)
        }
    } as any;
}

describe('auth facade', () => {
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

    describe('configuration contract', () => {
        it('degrades to anonymous when a predicate runs before setAuthInstance', async () => {
            // Phase 2 contract: a missing auth instance is treated as
            // a recoverable failure inside computeAugmentedSession.
            // The cached Promise resolves to null and predicates
            // return their anonymous default rather than throwing —
            // anonymous-allowed routes keep working even if the auth
            // tier is unconfigured or degraded.
            expect(await isLoggedIn(makeRequest())).toBe(false);
        });

        it('accepts a fresh auth instance via setAuthInstance', () => {
            const auth = makeStubAuth(null);
            expect(() => setAuthInstance(auth)).not.toThrow();
        });
    });

    describe('isLoggedIn / isAnonymous', () => {
        it('returns false / true respectively when no session resolves', async () => {
            setAuthInstance(makeStubAuth(null));
            const req = makeRequest();
            expect(await isLoggedIn(req)).toBe(false);
            expect(await isAnonymous(req)).toBe(true);
        });

        it('returns true / false respectively when a session resolves', async () => {
            setAuthInstance(makeStubAuth({ user: { id: 'user_abc', email: 'a@b.com' } }));
            const req = makeRequest();
            expect(await isLoggedIn(req)).toBe(true);
            expect(await isAnonymous(req)).toBe(false);
        });

        it('caches the resolved session on the request object', async () => {
            const auth = makeStubAuth({ user: { id: 'user_abc', email: 'a@b.com' } });
            setAuthInstance(auth);
            const req = makeRequest();
            await isLoggedIn(req);
            await isAnonymous(req);
            await isAdmin(req);
            expect(auth.api.getSession).toHaveBeenCalledTimes(1);
        });
    });

    describe('isInGroup / isAdmin', () => {
        it('returns false for anonymous callers regardless of group', async () => {
            setAuthInstance(makeStubAuth(null));
            const req = makeRequest();
            expect(await isInGroup(req, 'admin')).toBe(false);
            expect(await isInGroup(req, 'vip')).toBe(false);
            expect(await isAdmin(req)).toBe(false);
        });

        it('returns true for a logged-in user with the requested group', async () => {
            setAuthInstance(makeStubAuth({ user: { id: 'user_abc', email: 'a@b.com' } }));
            mockDatabase.getCollectionData(AUTH_USERS_COLLECTION).push({
                _id: 'user_abc',
                email: 'a@b.com',
                emailVerified: true,
                groups: ['admin', 'vip']
            });
            const req = makeRequest();
            expect(await isInGroup(req, 'admin')).toBe(true);
            expect(await isInGroup(req, 'vip')).toBe(true);
            expect(await isAdmin(req)).toBe(true);
        });

        it('routes isAdmin through the ADMIN_GROUP_ID constant', async () => {
            setAuthInstance(makeStubAuth({ user: { id: 'user_abc', email: 'a@b.com' } }));
            mockDatabase.getCollectionData(AUTH_USERS_COLLECTION).push({
                _id: 'user_abc',
                email: 'a@b.com',
                emailVerified: true,
                groups: [ADMIN_GROUP_ID]
            });
            const req = makeRequest();
            expect(await isAdmin(req)).toBe(true);
        });

        it('returns false for a logged-in user not in the group', async () => {
            setAuthInstance(makeStubAuth({ user: { id: 'user_plain', email: 'p@b.com' } }));
            mockDatabase.getCollectionData(AUTH_USERS_COLLECTION).push({
                _id: 'user_plain',
                email: 'p@b.com',
                emailVerified: true,
                groups: ['vip']
            });
            const req = makeRequest();
            expect(await isAdmin(req)).toBe(false);
            expect(await isInGroup(req, 'admin')).toBe(false);
        });
    });
});
