/**
 * User module library utilities barrel export.
 */

// Identity constants and validators. The server owns cookie writes; this
// module is intentionally minimal now that JS UUID generation,
// setUserIdCookie, and the localStorage mirror have been removed.
export {
    USER_ID_COOKIE_NAME,
    isValidUUID
} from './identity';

// TronLink wallet provider utilities (client-side)
export {
    getTronWeb,
    getTronLink,
    assertTronWeb
} from './tronWeb';

export type { TronWebProvider, TronLinkProvider, TronLinkRequestResponse } from './tronWeb';

// SSR state building utilities (safe for client components)
export { buildSSRUserState } from './ssr-state';
export type { SSRUserData } from './ssr-state';

// Better Auth client (Phase 3) — exposed for hook-level access from
// non-Provider call sites. New code should prefer `useAuthSession` from
// the SessionProvider for SSR-aware reads; this surface is for sign-out
// triggers, programmatic redirects, and other one-off invocations.
export { authClient, useSession, signIn, signOut, signUp } from './auth-client';

// Better Auth session shape consumed by frontend code. The SSR
// resolver lives at './session-server' and must be imported directly
// from server components (uses `next/headers`).
export type { ISSRSession } from './session-server';

// NOTE: Server-side utilities (getServerUserId, getServerUser, hasServerUserIdentity,
// getServerSession) must be imported directly from './server' / './session-server'
// in Server Components only. They use next/headers which cannot be bundled into
// client components.
