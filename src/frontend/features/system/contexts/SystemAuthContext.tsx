'use client';

/**
 * @fileoverview Authentication context for the `/system/*` admin surface.
 *
 * Admin status is derived from the Better Auth session: a visitor is an
 * admin iff they are logged in AND their account is in the `admin` group
 * (the single literal admin group — `isAdmin === isInGroup('admin')`). The
 * session is resolved once at the app root (SessionProvider, SSR-seeded)
 * and read here via `useAuthSession()`; this context does not re-derive
 * identity from cookies or Redux.
 *
 * Two flags surface for the gate's branching:
 *
 *   - `needsLogin` — no authenticated session. Recovery: sign in via the
 *     auth affordance in the page header.
 *   - `needsAdminGroupMembership` — logged in, but not in the `admin`
 *     group. Recovery: an existing admin must add them.
 *
 * `isAuthenticated` is the single boolean the gate consults to admit the
 * visitor — it is `isLoggedIn && isAdmin`.
 *
 * The trust boundary is the backend `requireAdmin` middleware, which reads
 * the Better Auth session cookie. Same-origin fetches carry it
 * automatically, so there is no JS-readable admin secret on the client.
 */

import { createContext, useContext, useMemo, type ReactNode } from 'react';
// Direct import (not the modules/user barrel) keeps component CSS out of the
// system bundle.
import { useAuthSession } from '../../../modules/user/components/SessionProvider';

interface ISystemAuthContext {
    /** True when the session belongs to a member of the `admin` group. */
    isAuthenticated: boolean;
    /** True once the session has resolved; lets gates render a loading
     *  state instead of flashing the not-admin UI. */
    isHydrated: boolean;
    /** True when there is no authenticated session. */
    needsLogin: boolean;
    /** True when logged in but not in the `admin` group. */
    needsAdminGroupMembership: boolean;
}

const SystemAuthContext = createContext<ISystemAuthContext | undefined>(undefined);

export function SystemAuthProvider({ children }: { children: ReactNode }) {
    const { session, isLoggedIn, isPending } = useAuthSession();

    const isAdmin = session?.user?.groups?.includes('admin') ?? false;
    const isHydrated = !isPending;

    const value = useMemo<ISystemAuthContext>(() => ({
        isAuthenticated: isLoggedIn && isAdmin,
        isHydrated,
        needsLogin: isHydrated && !isLoggedIn,
        needsAdminGroupMembership: isHydrated && isLoggedIn && !isAdmin
    }), [isLoggedIn, isAdmin, isHydrated]);

    return (
        <SystemAuthContext.Provider value={value}>
            {children}
        </SystemAuthContext.Provider>
    );
}

/**
 * Hook to access system authentication context.
 *
 * Provides admin status derived from the Better Auth session and group
 * membership, not from any client-stored secret. Must be used within a
 * SystemAuthProvider.
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
