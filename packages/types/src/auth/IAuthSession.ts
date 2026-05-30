/**
 * @fileoverview Plugin-facing Better Auth session shape.
 *
 * The core backend resolves the Better Auth session once per request (in
 * the `attachAuthSession` middleware) and stores a richer internal
 * `IAugmentedSession` on the Express request. Plugins receive that same
 * request object (the framework adapter casts it to {@link IHttpRequest}),
 * so this is the narrowed, dependency-free view plugins read through
 * `req.authSession` — without importing Better Auth or any core module.
 *
 * Gate on the presence of `req.authSession` (logged in) and its `groups`
 * (admin / membership) through the {@link isLoggedIn} / {@link isAdmin} /
 * {@link isInGroup} helpers rather than reading the fields directly.
 */

/**
 * Better Auth user fields exposed to plugins.
 *
 * The full Better Auth user record carries more, but plugins only need a
 * stable id plus the common profile fields. `id` is the Better Auth user
 * id (not the legacy UUID) — the durable, cross-device identity key.
 */
export interface IAuthSessionUser {
    /** Better Auth user id — the stable, portable identity key. */
    id: string;
    /** Verified email, when the account has one. */
    email?: string | null;
    /** Whether the email is verified. */
    emailVerified?: boolean;
    /** Display name, when set. */
    name?: string | null;
    /** Avatar/profile image URL, when set. */
    image?: string | null;
}

/**
 * Resolved session a logged-in visitor's request carries.
 *
 * `req.authSession` is `null` for anonymous visitors and an
 * `IAuthSession` for logged-in ones. Group ids drive membership/admin
 * gating; `primaryWallet` is the account's denormalized primary wallet.
 */
export interface IAuthSession {
    /** The authenticated Better Auth user. */
    user: IAuthSessionUser;
    /** Group ids the user belongs to (e.g. `['admin']`). */
    groups: string[];
    /**
     * Primary linked TRON wallet address, when one is set — the single
     * canonical primary for the session. Mirrors core
     * `IAugmentedSession.primaryWallet`; plugins read it here rather than
     * from the user record.
     */
    primaryWallet?: string | null;
}
