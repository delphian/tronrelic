import 'express-serve-static-core';
import type { IAugmentedSession } from '../modules/identity/services/auth-facade.js';

declare module 'express-serve-static-core' {
  interface Request {
    id?: string;
    /**
     * Better Auth session augmented with group membership and primary
     * wallet, populated by the `attachAuthSession` middleware mounted
     * in the Express loader (`loaders/express.ts`).
     *
     * - `undefined` — middleware has not run (test harnesses,
     *   pre-mount internal calls).
     * - `null` — middleware ran, no valid session present
     *   (anonymous visitor).
     * - `IAugmentedSession` — middleware ran, session present.
     *
     * Plugins, controllers, and route guards should not read this
     * directly; call the {@link isLoggedIn} / {@link isAdmin} /
     * {@link isInGroup} predicates from the auth facade instead.
     */
    authSession?: IAugmentedSession | null;
    /**
     * Admin auth path that approved the request, set by `requireAdmin`
     * (`api/middleware/admin-auth.ts`).
     *
     * - `'user'` — approved via a Better Auth session whose user is a
     *   member of the `admin` group. `req.userId` carries that BA user
     *   id; audit logs should record it.
     * - `'service-token'` — request carried a valid `ADMIN_API_TOKEN`.
     *   Used by CI scripts and the bootstrap-first-admin recipe. No human
     *   attribution; audit logs note this fact explicitly.
     */
    adminVia?: 'user' | 'service-token';
    /**
     * Better Auth user id of the authenticated caller, populated by
     * `requireAdmin` on the session path and by `requireLogin` for
     * login-gated routes. Declared here so audit-logging handlers can
     * read it without ad-hoc casts.
     */
    userId?: string;
  }
}
