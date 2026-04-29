/// <reference types="vitest" />

/**
 * Unit tests for the canonical `computeUserAuthStatus` predicate.
 *
 * The predicate is the single source of truth that every gate in the
 * platform consults — `requireAdmin` middleware, the user controller's
 * response helper, the frontend `SystemAuthGate` (via the snapshot
 * shipped on `IUser.authStatus`). These tests pin the four meaningful
 * states (anonymous / verified-not-admin / fresh-admin / stale-admin)
 * so any future change to the rule causes a failing test rather than a
 * silent divergence between gates.
 */

import { describe, it, expect, vi } from 'vitest';
import { UserIdentityState } from '@/types';
import type { IUser, IUserGroupService } from '@/types';
import { computeUserAuthStatus, withAuthStatus } from '../services/auth-status.js';

function makeGroupService(isAdminResult: boolean): IUserGroupService {
    return {
        isAdmin: vi.fn(async () => isAdminResult),
        isMember: vi.fn(async () => false),
        getUserGroups: vi.fn(async () => []),
        addMember: vi.fn(async () => undefined),
        removeMember: vi.fn(async () => undefined),
        setUserGroups: vi.fn(async () => []),
        getMembers: vi.fn(async () => ({ userIds: [], total: 0 }))
    } as unknown as IUserGroupService;
}

function makeUser(overrides: Partial<IUser> = {}): IUser {
    return {
        id: '550e8400-e29b-41d4-a716-446655440000',
        identityState: UserIdentityState.Anonymous,
        identityVerifiedAt: null,
        wallets: [],
        preferences: {},
        activity: {
            firstSeen: new Date(0),
            lastSeen: new Date(0),
            pageViews: 0,
            sessionsCount: 0,
            totalDurationSeconds: 0,
            sessions: [],
            pageViewsByPath: {},
            countryCounts: {}
        },
        groups: [],
        createdAt: new Date(0),
        updatedAt: new Date(0),
        ...overrides
    };
}

const FRESH = new Date(Date.now() - 1000);

describe('computeUserAuthStatus', () => {
    it('returns the anonymous-default shape for an anonymous user', async () => {
        const user = makeUser();
        const status = await computeUserAuthStatus(user, makeGroupService(false));
        expect(status).toEqual({ isVerified: false, isAdmin: false });
    });

    it('flags verified-not-admin without conferring admin authority', async () => {
        // Caller has already passed `user` through the lazy session-expiry
        // pass, so `identityState` reflects current truth — Verified iff
        // identityVerifiedAt is within the live window.
        const user = makeUser({
            identityState: UserIdentityState.Verified,
            identityVerifiedAt: FRESH,
            wallets: [{
                address: 'TXyz...',
                linkedAt: new Date(0),
                isPrimary: true,
                verified: true,
                verifiedAt: FRESH,
                lastUsed: new Date(0)
            }]
        });
        const status = await computeUserAuthStatus(user, makeGroupService(false));
        expect(status).toEqual({ isVerified: true, isAdmin: false });
    });

    it('confers admin authority when Verified and in an admin group', async () => {
        const user = makeUser({
            identityState: UserIdentityState.Verified,
            identityVerifiedAt: FRESH,
            wallets: [{
                address: 'TXyz...',
                linkedAt: new Date(0),
                isPrimary: true,
                verified: true,
                verifiedAt: FRESH,
                lastUsed: new Date(0)
            }]
        });
        const status = await computeUserAuthStatus(user, makeGroupService(true));
        expect(status).toEqual({ isVerified: true, isAdmin: true });
    });

    it('an expired-session user reads as not-Verified — there is no special "stale admin" state', async () => {
        // The previous design distinguished stale-Verified from
        // unverified to surface a bespoke recovery prompt. With the
        // session clock enforced lazily inside `UserService.getById`,
        // an expired session reads as `Registered` before this
        // predicate ever sees it, and the gate uses the same "not
        // Verified" branch as any unsigned user. Recovery is the
        // normal verify-wallet flow on /profile.
        const user = makeUser({
            // Caller has already passed the user through the lazy
            // session-expiry pass at the read boundary, which collapsed
            // the expired session to Registered.
            identityState: UserIdentityState.Registered,
            identityVerifiedAt: null,
            wallets: [{
                address: 'TXyz...',
                linkedAt: new Date(0),
                isPrimary: true,
                verified: true,
                verifiedAt: new Date(0),
                lastUsed: new Date(0)
            }]
        });
        const status = await computeUserAuthStatus(user, makeGroupService(true));
        expect(status).toEqual({ isVerified: false, isAdmin: true });
    });
});

describe('withAuthStatus', () => {
    it('returns a new object with authStatus populated and does not mutate input', async () => {
        const user = makeUser();
        const decorated = await withAuthStatus(user, makeGroupService(false));
        expect(decorated).not.toBe(user);
        expect(decorated.authStatus).toBeDefined();
        expect(decorated.authStatus?.isVerified).toBe(false);
        expect(decorated.authStatus?.isAdmin).toBe(false);
        // Input must remain untouched so callers holding the storage-shape
        // user aren't surprised by a transient field on it.
        expect((user as IUser).authStatus).toBeUndefined();
    });
});
