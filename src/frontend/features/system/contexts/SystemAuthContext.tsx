'use client';

/**
 * @fileoverview Authentication context for the `/system/*` admin surface.
 *
 * Admin status is the server-computed `authStatus` snapshot attached to
 * every `IUser` payload by the backend's response helper (see
 * `computeUserAuthStatus`). The client does not re-derive admin status
 * from raw fields. Verification freshness is folded into
 * `identityState === Verified` itself — a stale-signed user reads as
 * `Registered`, the gate falls to the generic "not Verified" branch,
 * and recovery is the normal verify-wallet flow on `/profile`. There
 * is no special "stale admin" state, no special recovery branch, and
 * no inline re-sign affordance: the affordance disappearing _is_ the
 * signal, and `/profile` is where wallet management already lives.
 *
 * Two flags surface for the gate's branching:
 *
 *   - `needsVerification` — visitor is not currently `Verified` (no
 *     wallets, only unsigned wallets, or every signature is stale).
 *     Recovery: connect or re-sign a wallet on `/profile`.
 *   - `needsAdminGroupMembership` — visitor is `Verified`, but not in
 *     any admin group. Recovery: an existing admin must add them.
 *
 * `isAuthenticated` is the single boolean the gate consults to admit
 * the visitor — it is `isVerified && isAdmin`, both server-computed.
 *
 * The legacy `localStorage.getItem('admin_token')` flow is gone — there
 * is no JS-readable admin secret on the client. Same-origin fetches
 * carry the signed `tronrelic_uid` cookie automatically, which is what
 * `requireAdmin` consults; the `token` field below stays as an empty
 * string for transitional callers that still build an `x-admin-token`
 * header so those sites need no edits.
 */

import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import { useAppSelector } from '../../../store/hooks';
import {
    selectUserData,
    selectUserInitialized
} from '../../../modules/user/slice';

interface ISystemAuthContext {
    /**
     * Empty string. Retained for transitional API compatibility with
     * fetch sites that still build an `x-admin-token` header — those
     * sites authenticate via the cookie now; the empty string is
     * treated as "no token" by the backend middleware.
     */
    token: string;
    /** True when the cookie-resolved user is a Verified admin. */
    isAuthenticated: boolean;
    /** True until the bootstrap call completes; lets gates render a
     *  loading state instead of flashing the not-admin UI. */
    isHydrated: boolean;
    /** True when the visitor is not currently `Verified`. */
    needsVerification: boolean;
    /** True when the visitor is `Verified` but not in an admin group. */
    needsAdminGroupMembership: boolean;
    /** Best-effort logout: clears the in-tab admin gate. The cookie
     *  itself is HttpOnly and survives — admin status is derived from
     *  group membership, not any tab-local state. */
    logout: () => void;
}

const SystemAuthContext = createContext<ISystemAuthContext | undefined>(undefined);

export function SystemAuthProvider({ children }: { children: ReactNode }) {
    const userData = useAppSelector(selectUserData);
    const initialized = useAppSelector(selectUserInitialized);

    // Read the server's verdict directly. Falling back to safe defaults
    // when `authStatus` is missing handles the legacy-payload edge case
    // (Redux state hydrated from a snapshot taken before the field
    // existed) and the "no user yet" state without admitting anyone the
    // server didn't already approve.
    const status = userData?.authStatus;
    const isVerified = status?.isVerified ?? false;
    const isAdmin = status?.isAdmin ?? false;

    const logout = useCallback(() => {
        // Cookie is HttpOnly; nothing meaningful to clear here. The page
        // navigation that follows takes the operator out of the admin
        // surface, which is the only "logout" the UI cares about.
    }, []);

    const value = useMemo<ISystemAuthContext>(() => ({
        token: '',
        isAuthenticated: isVerified && isAdmin,
        isHydrated: initialized,
        needsVerification: initialized && !isVerified,
        needsAdminGroupMembership: initialized && isVerified && !isAdmin,
        logout
    }), [isVerified, isAdmin, initialized, logout]);

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
