/// <reference types="vitest" />

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ICacheService, ISystemLogService, IUser } from '@/types';
import { UserIdentityState } from '@/types';
import { createMockDatabaseService } from '../../../tests/vitest/mocks/database-service.js';

// Mock SignatureService so seeded wallets pass through without TRON
// address validation (mirrors the user.service.test.ts pattern).
vi.mock('../../../modules/auth/signature.service.js', () => ({
    SignatureService: class {
        normalizeAddress(a: string) { return a; }
        async verifyMessage(a: string) { return a; }
    }
}));

// Mock the env module with a getter that reads process.env at access
// time. The real env module Zod-parses process.env once at import; tests
// need ADMIN_API_TOKEN to vary across cases without resetting modules
// (which would also wipe UserService's singleton state).
vi.mock('../../../config/env.js', () => ({
    env: new Proxy({} as Record<string, any>, {
        get(_target, key: string) {
            return process.env[key];
        }
    })
}));

import { UserService } from '../../../modules/user/services/user.service.js';
import { UserGroupService, SYSTEM_ADMIN_GROUP_ID } from '../../../modules/user/services/user-group.service.js';
import { USER_ID_COOKIE_NAME } from '../../../modules/user/api/identity-cookie.js';
import { requireAdmin } from '../admin-auth.js';

class MockCache implements ICacheService {
    private store = new Map<string, any>();
    async get<T>(k: string) { return (this.store.get(k) ?? null) as T | null; }
    async set<T>(k: string, v: T) { this.store.set(k, v); }
    async del(k: string) { return this.store.delete(k) ? 1 : 0; }
    async invalidate(tag: string): Promise<void> {
        for (const k of [...this.store.keys()]) if (k.includes(tag)) this.store.delete(k);
    }
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

const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000';
const SERVICE_TOKEN = 'test-service-token-1234567890abcdef';

function makeReqRes(opts: {
    cookieId?: string;
    headerToken?: string;
    bearer?: string;
} = {}) {
    // Admin auth reads identity from `signedCookies` (HMAC-verified by
    // cookie-parser). The `cookies` map is populated too so middleware that
    // reads either path stays exercised, but the admin gate runs off
    // `signedCookies`.
    const req: any = {
        cookies: opts.cookieId ? { [USER_ID_COOKIE_NAME]: opts.cookieId } : {},
        signedCookies: opts.cookieId ? { [USER_ID_COOKIE_NAME]: opts.cookieId } : {},
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

async function seedUser(
    userService: UserService,
    mockDb: ReturnType<typeof createMockDatabaseService>,
    mockCache: MockCache,
    userId: string,
    options: { verified: boolean; admin: boolean; verifiedAt?: Date | null }
): Promise<IUser> {
    await userService.getOrCreate(userId);
    const collection = mockDb.getCollection('users');
    // Default to a fresh `verifiedAt` (now) when verified: true and the
    // caller hasn't explicitly set one, so the ordinary "approves the
    // request" cases pass without every callsite thinking about
    // freshness. Tests passing `verifiedAt: null` (legacy pre-migration
    // simulation) or an old `Date` (stale simulation) get exactly what
    // they asked for — `??` would coalesce explicit null to `now`,
    // which would mask the bug those tests are trying to surface.
    const now = new Date();
    const hasExplicitVerifiedAt = 'verifiedAt' in options;
    const verifiedAt = options.verified
        ? (hasExplicitVerifiedAt ? options.verifiedAt ?? null : now)
        : null;
    await collection.updateOne(
        { id: userId },
        {
            $set: {
                identityState: options.verified ? UserIdentityState.Verified : UserIdentityState.Anonymous,
                // Mirror the per-wallet verifiedAt onto the user-level
                // session clock. The lazy expiry pass in
                // `UserService.getById` reads `identityVerifiedAt` —
                // fixtures explicitly setting `verifiedAt: null` simulate
                // pre-migration legacy data and must end up with a null
                // session clock, which downgrades the user to Registered
                // on read.
                identityVerifiedAt: verifiedAt,
                wallets: options.verified
                    ? [{
                        address: 'TXyz',
                        linkedAt: now,
                        isPrimary: true,
                        verified: true,
                        verifiedAt,
                        lastUsed: now
                    }]
                    : [],
                groups: options.admin ? [SYSTEM_ADMIN_GROUP_ID] : []
            }
        }
    );
    // Drop cache so the next read hits the DB and sees the updated record.
    await mockCache.del(`user:${userId}`);
    return (await userService.getById(userId)) as IUser;
}

describe('requireAdmin middleware', () => {
    let userService: UserService;
    let groupService: UserGroupService;
    let mockDb: ReturnType<typeof createMockDatabaseService>;
    let mockCache: MockCache;

    beforeEach(async () => {
        mockDb = createMockDatabaseService();
        mockCache = new MockCache();
        UserService.resetInstance();
        UserGroupService.resetInstance();

        UserService.setDependencies(
            mockDb, mockCache, new NullLogger(),
            { getSiteUrl: async () => 'http://localhost', getConfig: async () => ({ siteUrl: 'http://localhost' }), updateConfig: async (u: any) => u, clearCache: () => {} } as any,
            {} as any
        );
        userService = UserService.getInstance();

        UserGroupService.setDependencies(mockDb, mockCache, new NullLogger());
        groupService = UserGroupService.getInstance();

        // The mock database service's `updateOne` upsert path doesn't
        // honor `$setOnInsert`, so calling the real `seedSystemGroups`
        // would write an admin row without the `system: true` flag and
        // `isAdmin()` would always return false. Insert the admin row
        // directly to keep the test focused on the middleware behavior
        // rather than mock fidelity.
        await mockDb.getCollection('module_user_groups').insertOne({
            id: SYSTEM_ADMIN_GROUP_ID,
            name: 'Admin',
            description: 'seeded admin group for tests',
            system: true,
            createdAt: new Date(),
            updatedAt: new Date()
        } as any);

        // Default: service token disabled. Each describe sets it as needed.
        delete process.env.ADMIN_API_TOKEN;
    });

    describe('cookie + verified + admin-group path', () => {
        it('approves the request and tags adminVia="user"', async () => {
            await seedUser(userService, mockDb, mockCache, VALID_UUID, { verified: true, admin: true });
            const { req, res, next, called } = makeReqRes({ cookieId: VALID_UUID });
            await requireAdmin(req, res, next);

            expect(called()).toBe(true);
            expect(req.adminVia).toBe('user');
        });

        it('rejects when user is in admin group but identityState is not Verified', async () => {
            // Service token must be set so a failed cookie path returns 401, not 503.
            process.env.ADMIN_API_TOKEN = SERVICE_TOKEN;
            await seedUser(userService, mockDb, mockCache, VALID_UUID, { verified: false, admin: true });
            const { req, res, next, called } = makeReqRes({ cookieId: VALID_UUID });
            await requireAdmin(req, res, next);

            expect(called()).toBe(false);
            expect(res.statusCode).toBe(401);
        });

        it('rejects when user is verified but not in admin group', async () => {
            process.env.ADMIN_API_TOKEN = SERVICE_TOKEN;
            await seedUser(userService, mockDb, mockCache, VALID_UUID, { verified: true, admin: false });
            const { req, res, next, called } = makeReqRes({ cookieId: VALID_UUID });
            await requireAdmin(req, res, next);

            expect(called()).toBe(false);
            expect(res.statusCode).toBe(401);
        });

        it('rejects when cookie is malformed', async () => {
            process.env.ADMIN_API_TOKEN = SERVICE_TOKEN;
            const { req, res, next, called } = makeReqRes({ cookieId: 'not-a-uuid' });
            await requireAdmin(req, res, next);

            expect(called()).toBe(false);
            expect(res.statusCode).toBe(401);
        });
    });

    describe('service-token path', () => {
        beforeEach(() => {
            process.env.ADMIN_API_TOKEN = SERVICE_TOKEN;
        });

        it('approves the request via x-admin-token header and tags adminVia="service-token"', async () => {
            const { req, res, next, called } = makeReqRes({ headerToken: SERVICE_TOKEN });
            await requireAdmin(req, res, next);

            expect(called()).toBe(true);
            expect(req.adminVia).toBe('service-token');
        });

        it('approves the request via Authorization Bearer header', async () => {
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

        it('treats an empty x-admin-token as no candidate (transitional frontend)', async () => {
            const { req, res, next, called } = makeReqRes({ headerToken: '' });
            await requireAdmin(req, res, next);

            expect(called()).toBe(false);
            expect(res.statusCode).toBe(401);
        });
    });

    describe('disabled-token + no-cookie', () => {
        it('returns 503 when ADMIN_API_TOKEN is unset and cookie path fails', async () => {
            // ADMIN_API_TOKEN already deleted in outer beforeEach.
            const { req, res, next, called } = makeReqRes({});
            await requireAdmin(req, res, next);

            expect(called()).toBe(false);
            expect(res.statusCode).toBe(503);
        });
    });

    describe('cookie path takes precedence over service-token', () => {
        it('attributes a request that carries both as adminVia="user"', async () => {
            process.env.ADMIN_API_TOKEN = SERVICE_TOKEN;
            await seedUser(userService, mockDb, mockCache, VALID_UUID, { verified: true, admin: true });

            const { req, res, next, called } = makeReqRes({
                cookieId: VALID_UUID,
                headerToken: SERVICE_TOKEN
            });
            await requireAdmin(req, res, next);

            expect(called()).toBe(true);
            expect(req.adminVia).toBe('user');
        });
    });

    describe('verification freshness', () => {
        // 30 days ago is comfortably past the 14-day window. Picking a
        // round number rather than `freshness + 1ms` keeps the test
        // robust against minor adjustments to the constant — what we're
        // asserting is "much older than the window," not boundary
        // arithmetic.
        const STALE_VERIFIED_AT = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

        // Session freshness is enforced by the lazy session-expiry pass
        // inside `UserService.getById`. A user whose `identityVerifiedAt`
        // has aged past `SESSION_TTL_MS` is downgraded to `Registered`
        // before the middleware ever sees them, so the cookie path
        // rejects with a generic 401 — the same way an unsigned-claim
        // user gets rejected. There is no separate `verification_stale`
        // reason code, no special branch, and no block on service-token
        // fall-through; recovery is the normal verify-wallet flow on
        // /profile.

        it('rejects a stale-only admin via the generic not-Verified branch', async () => {
            // ADMIN_API_TOKEN must be set so the middleware reaches the
            // 401 path; without it, the cookie failure collapses to 503
            // (admin disabled) before reason codes matter.
            process.env.ADMIN_API_TOKEN = SERVICE_TOKEN;
            await seedUser(userService, mockDb, mockCache, VALID_UUID, {
                verified: true,
                admin: true,
                verifiedAt: STALE_VERIFIED_AT
            });
            const { req, res, next, called } = makeReqRes({ cookieId: VALID_UUID });
            await requireAdmin(req, res, next);

            expect(called()).toBe(false);
            expect(res.statusCode).toBe(401);
            // No `verification_stale` reason — stale and absent proof are
            // indistinguishable to the gate.
            expect(res.jsonBody?.reason).toBeUndefined();
        });

        it('lets a service token win when the cookie-only user is stale', async () => {
            // A request carrying both a stale cookie and a valid service
            // token is attributed to the service caller. The stale cookie
            // confers no authority, so it isn't competing for attribution
            // — service-token is the only valid claim on the request.
            // Audit logs will record `adminVia: 'service-token'`, which
            // is the truthful description of what authorized the call.
            process.env.ADMIN_API_TOKEN = SERVICE_TOKEN;
            await seedUser(userService, mockDb, mockCache, VALID_UUID, {
                verified: true,
                admin: true,
                verifiedAt: STALE_VERIFIED_AT
            });
            const { req, res, next, called } = makeReqRes({
                cookieId: VALID_UUID,
                headerToken: SERVICE_TOKEN
            });
            await requireAdmin(req, res, next);

            expect(called()).toBe(true);
            expect(req.adminVia).toBe('service-token');
        });

        it('approves a Verified admin with a fresh session regardless of per-wallet stamp ages', async () => {
            // Per-wallet freshness no longer drives auth — the
            // user-level session clock (`identityVerifiedAt`) does. A
            // user whose session is fresh is approved even if some of
            // their per-wallet `verifiedAt` stamps are old (those are
            // historical audit data, not authentication state).
            await userService.getOrCreate(VALID_UUID);
            const collection = mockDb.getCollection('users');
            const now = new Date();
            await collection.updateOne(
                { id: VALID_UUID },
                {
                    $set: {
                        identityState: UserIdentityState.Verified,
                        identityVerifiedAt: now,
                        groups: [SYSTEM_ADMIN_GROUP_ID],
                        wallets: [
                            {
                                address: 'TStale',
                                linkedAt: STALE_VERIFIED_AT,
                                isPrimary: false,
                                verified: true,
                                verifiedAt: STALE_VERIFIED_AT,
                                lastUsed: STALE_VERIFIED_AT
                            },
                            {
                                address: 'TFresh',
                                linkedAt: now,
                                isPrimary: true,
                                verified: true,
                                verifiedAt: now,
                                lastUsed: now
                            }
                        ]
                    }
                }
            );
            await mockCache.del(`user:${VALID_UUID}`);

            const { req, res, next, called } = makeReqRes({ cookieId: VALID_UUID });
            await requireAdmin(req, res, next);

            expect(called()).toBe(true);
            expect(req.adminVia).toBe('user');
        });

        it('treats Verified users with null identityVerifiedAt as not-Verified (defensive)', async () => {
            // Defensive: a stored `identityState: Verified` paired with a
            // null `identityVerifiedAt` is incoherent (post-refactor, the
            // session clock should always be set when the state is
            // Verified). `isSessionFresh` treats this as expired, the
            // lazy expiry pass downgrades the user to Registered on
            // read, and the gate rejects via the generic not-Verified
            // branch.
            process.env.ADMIN_API_TOKEN = SERVICE_TOKEN;
            await seedUser(userService, mockDb, mockCache, VALID_UUID, {
                verified: true,
                admin: true,
                verifiedAt: null
            });
            const { req, res, next, called } = makeReqRes({ cookieId: VALID_UUID });
            await requireAdmin(req, res, next);

            expect(called()).toBe(false);
            expect(res.statusCode).toBe(401);
            expect(res.jsonBody?.reason).toBeUndefined();
        });
    });
});
