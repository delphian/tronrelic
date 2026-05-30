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
  }
}
