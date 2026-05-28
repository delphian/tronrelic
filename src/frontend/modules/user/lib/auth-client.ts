/**
 * @fileoverview Better Auth React client used by every Phase 3+ component.
 *
 * Single source of truth for the BA client. New code consumes the
 * exports here (`useSession`, `signIn`, `signOut`, `signUp`) instead of
 * importing from `better-auth/react` directly so a future client-side
 * refactor — adding a plugin, swapping the base URL strategy, wrapping
 * a method — happens in one place.
 *
 * The client targets `/api/auth/*` mounted by the backend user module
 * (Phase 1). `baseURL` is intentionally omitted — Better Auth's client
 * defaults to `window.location.origin` and appends its `basePath` of
 * `/api/auth`, so requests land at `<current-origin>/api/auth/*` on
 * whatever domain the page was served from. This keeps the universal
 * Docker image domain-agnostic for the same reason `NEXT_PUBLIC_*` is
 * forbidden — no baked-in origin in the bundle.
 */

'use client';

import { createAuthClient } from 'better-auth/react';
import { magicLinkClient } from 'better-auth/client/plugins';
import { passkeyClient } from '@better-auth/passkey/client';

/**
 * Configured Better Auth client.
 *
 * Plugin list mirrors the backend `auth.ts` plugin list — passkey is
 * always loaded, magic-link client method is registered so the modal
 * can call it whether or not the server side has Resend wired
 * (the server returns an error if magic-link is disabled, which the
 * modal surfaces as a toast).
 */
export const authClient = createAuthClient({
    plugins: [magicLinkClient(), passkeyClient()]
});

/**
 * Reactive session hook re-exported from the configured client.
 *
 * Returns `{ data, isPending, error, refetch }`. Components that need
 * SSR fallback should prefer `useAuthSession` from `SessionProvider` —
 * it merges the SSR-resolved session with this hook's live value so
 * the first render is never a "signed out" flash for users who
 * arrived with a valid Better Auth cookie.
 */
export const { useSession, signIn, signUp, signOut } = authClient;
