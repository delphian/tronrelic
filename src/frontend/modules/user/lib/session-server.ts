/**
 * @fileoverview SSR helper for resolving the Better Auth session.
 *
 * Mirrors `server.ts` for the new BA-based identity: forwards the
 * inbound request cookies to `/api/auth/get-session` so the first
 * render of a logged-in visitor never flashes the signed-out state.
 *
 * Why a server-side fetch instead of importing the BA instance: the
 * backend Better Auth instance lives in `src/backend/modules/user/`
 * and depends on a native MongoDB driver — it cannot be loaded into
 * the Next.js process. Calling the HTTP endpoint over the internal
 * Docker URL (SITE_BACKEND) keeps the boundary clean and reuses the
 * same auth pipeline production browsers will hit.
 */

import { cookies } from 'next/headers';

/**
 * Minimal SSR-safe shape of the Better Auth session response.
 *
 * BA's `/api/auth/get-session` returns `null` (or an empty body) when
 * no session is present and `{ user, session }` otherwise. We pick
 * only the fields the frontend needs so a library version bump that
 * adds fields to BA's internal types does not require a frontend
 * type refactor. Client code that needs richer shapes reads
 * `authClient.useSession()` directly.
 */
export interface ISSRSession {
    user: {
        id: string;
        email?: string | null;
        emailVerified?: boolean;
        name?: string | null;
        image?: string | null;
        /** Group ids from the BA additionalFields config. */
        groups?: string[];
        /** Primary wallet — reserved for Phase 4, currently always absent. */
        primaryWallet?: string | null;
    };
    session: {
        id?: string;
        expiresAt?: string;
        token?: string;
    };
}

/**
 * Fetch the current Better Auth session for SSR.
 *
 * Forwards every inbound cookie to the backend's `/api/auth/get-session`
 * endpoint so the BA session cookie reaches the auth pipeline. Returns
 * `null` when no session is active, the backend is unreachable, or the
 * response is malformed — every failure mode collapses to "render
 * signed-out" rather than throwing, which keeps SSR resilient.
 *
 * @returns Resolved session for the inbound request, or null.
 */
export async function getServerSession(): Promise<ISSRSession | null> {
    try {
        const backendUrl = process.env.SITE_BACKEND || 'http://localhost:4000';
        const cookieStore = await cookies();
        const cookieHeader = cookieStore
            .getAll()
            .map((c) => `${c.name}=${c.value}`)
            .join('; ');

        if (!cookieHeader) {
            return null;
        }

        const response = await fetch(`${backendUrl}/api/auth/get-session`, {
            headers: { Cookie: cookieHeader },
            cache: 'no-store',
            signal: AbortSignal.timeout(5000)
        });

        if (!response.ok) {
            return null;
        }

        const text = await response.text();
        if (!text) {
            return null;
        }

        const data = JSON.parse(text) as Partial<ISSRSession> | null;
        if (!data || !data.user || !data.session) {
            return null;
        }

        return data as ISSRSession;
    } catch {
        return null;
    }
}
