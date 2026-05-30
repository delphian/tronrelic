/**
 * User module library utilities barrel export.
 *
 * Better Auth is the sole identity layer. The legacy UUID identity
 * constants/validators, the SSR Redux-state builder, and the TronLink
 * provider utilities were removed in the Phase 6 cutover.
 */

// Better Auth client — exposed for hook-level access from non-Provider call
// sites. New code should prefer `useAuthSession` from the SessionProvider for
// SSR-aware reads; this surface is for sign-out triggers, programmatic
// redirects, and other one-off invocations.
export { authClient, useSession, signIn, signOut, signUp } from './auth-client';

// Better Auth session shape consumed by frontend code. The SSR resolver lives
// at './session-server' and must be imported directly from server components
// (uses `next/headers`).
export type { ISSRSession } from './session-server';

// NOTE: Server-side utilities (getServerSession) must be imported directly
// from './session-server' in Server Components only. They use next/headers
// which cannot be bundled into client components.
