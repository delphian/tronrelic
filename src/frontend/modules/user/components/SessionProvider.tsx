'use client';

/**
 * @fileoverview Better Auth session context for the React tree.
 *
 * Wraps `authClient.useSession()` with an SSR seed so the first render
 * of a logged-in visitor sees their session immediately instead of
 * flashing the signed-out state while BA's client fetches
 * `/api/auth/get-session` on mount.
 *
 * Better Auth is the sole identity layer. This provider seeds the merged
 * session from the SSR resolver and republishes BA's live client value to
 * the React tree so every consumer reads identity from one place.
 */

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useSession } from '../lib/auth-client';
import type { ISSRSession } from '../lib/session-server';

/**
 * Value exposed to consumers of {@link useAuthSession}.
 *
 * `session` is the merged read: live data from the BA client when
 * present, otherwise the SSR seed for the first render. `isLoggedIn`
 * is the binary identity flag plugin and core code should use in
 * Phase 3+ in place of the legacy `identityState === Verified` check.
 */
export interface IAuthSessionContext {
    /**
     * Current session payload. Reflects the live BA client value once
     * it has fetched; falls back to the SSR seed during the
     * pre-hydration window.
     */
    session: ISSRSession | null;

    /**
     * True when the visitor has an authenticated BA session. This is the
     * single binary identity flag core and plugin code consume.
     */
    isLoggedIn: boolean;

    /**
     * True while the BA client is fetching the live session and the
     * SSR seed is absent. Stays false when the SSR seed is present —
     * we treat the SSR value as authoritative for the first paint.
     */
    isPending: boolean;
}

const AuthSessionContext = createContext<IAuthSessionContext | null>(null);

/**
 * Props accepted by {@link SessionProvider}.
 */
export interface ISessionProviderProps {
    /**
     * Children to render under the session context.
     */
    children: ReactNode;

    /**
     * Session resolved by SSR via `getServerSession()`. When present,
     * consumers see a logged-in session on the very first render —
     * no flash to signed-out while the BA client fetches.
     */
    initialSession?: ISSRSession | null;
}

/**
 * Provider wrapping the React tree with a merged BA session.
 *
 * Calls `authClient.useSession()` once at the provider level and
 * publishes the merged value over context. Consumers read via
 * {@link useAuthSession} instead of subscribing to BA's hook
 * individually so the SSR seed is applied consistently everywhere.
 *
 * @param props - {@link ISessionProviderProps}.
 * @returns Provider element with the merged session in context.
 */
export function SessionProvider({ children, initialSession }: ISessionProviderProps) {
    const { data, isPending } = useSession();

    const value = useMemo<IAuthSessionContext>(() => {
        // BA's useSession returns `{ user, session }` once loaded.
        // The shape matches ISSRSession by construction (same backend
        // endpoint), so we treat it as such for downstream consumers.
        const live = (data ?? null) as ISSRSession | null;
        // The SSR seed is a pre-hydration fallback used only while BA
        // has produced no data yet. Once `data` is present (even null
        // after sign-out), `live` wins, so sign-out propagates and a
        // background revalidation never resurrects the stale seed.
        const merged: ISSRSession | null = isPending && !data ? (initialSession ?? null) : live;
        return {
            session: merged,
            isLoggedIn: Boolean(merged?.user?.id),
            // The SSR seed answering the question — even with `null` —
            // means we are not pending. Only an absent seed
            // (`undefined`) leaves us genuinely waiting on BA.
            isPending: isPending && initialSession === undefined
        };
    }, [data, initialSession, isPending]);

    return <AuthSessionContext.Provider value={value}>{children}</AuthSessionContext.Provider>;
}

/**
 * Hook returning the merged BA session.
 *
 * Throws when called outside a {@link SessionProvider} — every
 * consumer must be inside the provider tree mounted in
 * `app/providers.tsx`. The thrown error names the missing provider
 * so misconfiguration surfaces with an actionable message instead of
 * a generic "context is null" downstream.
 *
 * @returns Merged session context.
 */
export function useAuthSession(): IAuthSessionContext {
    const ctx = useContext(AuthSessionContext);
    if (!ctx) {
        throw new Error('useAuthSession must be used within a SessionProvider');
    }
    return ctx;
}
