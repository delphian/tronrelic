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
import { emailOTPClient } from 'better-auth/client/plugins';
import { passkeyClient } from '@better-auth/passkey/client';

/**
 * Configured Better Auth client.
 *
 * Plugin list mirrors the backend `auth.ts` plugin list — passkey is
 * always loaded, the email-OTP client methods are registered so the
 * modal can request and verify codes whether or not the server side
 * has Resend wired (the server returns an error if email-OTP is
 * disabled, which the modal surfaces as a toast).
 */
export const authClient = createAuthClient({
    plugins: [emailOTPClient(), passkeyClient()]
});

/**
 * Reactive session hook plus the auth actions used across the app.
 *
 * `emailOtp.sendVerificationOtp({ email, type: 'sign-in' })` mails a
 * code; `signIn.emailOtp({ email, otp })` verifies it and creates the
 * session. Components that need SSR fallback should prefer
 * `useAuthSession` from `SessionProvider` — it merges the SSR-resolved
 * session with `useSession`'s live value so the first render is never a
 * "signed out" flash for users who arrived with a valid BA cookie.
 */
export const { useSession, signIn, signUp, signOut, emailOtp } = authClient;
