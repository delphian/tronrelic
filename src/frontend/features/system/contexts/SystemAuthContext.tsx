'use client';

/**
 * @fileoverview Authentication context for the `/system/*` admin surface.
 *
 * Admin status is derived from the cookie-resolved user, not from any
 * client-readable secret. The user must satisfy three conditions:
 *
 *   1. `identityState === Verified` — they have cryptographically proven
 *      wallet ownership via TronLink signature.
 *   2. At least one wallet has `verifiedAt` within
 *      `VERIFICATION_FRESHNESS_MS` (14 days). A months-old signature is
 *      not load-bearing for admin authority — the operator must have
 *      proved control of a wallet recently.
 *   3. The user belongs to the `admin` group.
 *
 * All three checks are non-bypassable: a stolen cookie cannot promote a
 * user to admin (verification requires a live wallet signature),
 * freshness decays without a new signature, and group membership is
 * server-controlled.
 *
 * `needsRefreshVerification` exposes the stale-Verified state distinctly
 * so the gate component can show a "refresh verification" recovery path
 * instead of the generic "not an admin" screen — these are two different
 * problems with different solutions.
 *
 * The legacy `localStorage.getItem('admin_token')` flow is gone — there
 * is no JS-readable admin secret on the client. The 62-ish fetch sites
 * across `/system/*` that still send an `x-admin-token` header continue
 * to work because (a) the request includes the `tronrelic_uid` cookie
 * automatically (same-origin), and (b) the backend `requireAdmin`
 * middleware now accepts cookie+verified+admin-group+fresh as an
 * alternative to the shared service token. The `token` field below
 * remains in the context shape and returns empty string so those sites
 * need no edits.
 */

import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import { UserIdentityState } from '@/types';
import { useAppSelector } from '../../../store/hooks';
import {
    selectUserData,
    selectUserInitialized,
    selectHasFreshVerification
} from '../../../modules/user/slice';

/** Slug of the seeded admin group. Mirrors the backend's seeded row. */
const ADMIN_GROUP_ID = 'admin';

interface ISystemAuthContext {
    /**
     * Empty string. Retained for transitional API compatibility with
     * fetch sites that still build an `x-admin-token` header — those
     * sites authenticate via the cookie now; the empty string is
     * treated as "no token" by the backend middleware.
     */
    token: string;
    /** True when the cookie-resolved user is a verified admin with a
     *  wallet signature inside the freshness window. */
    isAuthenticated: boolean;
    /** True until the bootstrap call completes; lets gates render a
     *  loading state instead of flashing the not-admin UI. */
    isHydrated: boolean;
    /** True when the visitor exists but isn't a verified admin yet. */
    needsVerification: boolean;
    /** True when the visitor is verified but not yet in the admin group. */
    needsAdminGroupMembership: boolean;
    /** True when the visitor is a verified admin whose wallet
     *  signature has aged past the freshness window. The recovery
     *  path is to re-sign any attached wallet via the dedicated
     *  refresh-verification endpoint. */
    needsRefreshVerification: boolean;
    /** Best-effort logout: clears the in-tab admin gate. The cookie
     *  itself is HttpOnly and survives — admin status is derived from
     *  group membership, not any tab-local state. */
    logout: () => void;
}

const SystemAuthContext = createContext<ISystemAuthContext | undefined>(undefined);

export function SystemAuthProvider({ children }: { children: ReactNode }) {
    const userData = useAppSelector(selectUserData);
    const initialized = useAppSelector(selectUserInitialized);
    const hasFresh = useAppSelector(selectHasFreshVerification);

    const isVerified = userData?.identityState === UserIdentityState.Verified;
    const isInAdminGroup = userData?.groups?.includes(ADMIN_GROUP_ID) ?? false;
    const isAuthenticated = isVerified && isInAdminGroup && hasFresh;

    const logout = useCallback(() => {
        // Cookie is HttpOnly; nothing meaningful to clear here. The page
        // navigation that follows takes the operator out of the admin
        // surface, which is the only "logout" the UI cares about.
    }, []);

    const value = useMemo<ISystemAuthContext>(() => ({
        token: '',
        isAuthenticated,
        isHydrated: initialized,
        needsVerification: initialized && !isVerified,
        needsAdminGroupMembership: initialized && isVerified && !isInAdminGroup,
        needsRefreshVerification: initialized && isVerified && isInAdminGroup && !hasFresh,
        logout
    }), [isAuthenticated, initialized, isVerified, isInAdminGroup, hasFresh, logout]);

    return (
        <SystemAuthContext.Provider value={value}>
            {children}
        </SystemAuthContext.Provider>
    );
}

/**
 * Hook to access system authentication context.
 *
 * Provides admin status derived from cookie+group, not from any
 * client-stored secret. Must be used within a SystemAuthProvider.
 *
 * @returns Auth context with admin status and helper flags
 * @throws Error if used outside SystemAuthProvider
 */
export function useSystemAuth(): ISystemAuthContext {
    const context = useContext(SystemAuthContext);
    if (!context) {
        throw new Error('useSystemAuth must be used within SystemAuthProvider');
    }
    return context;
}
