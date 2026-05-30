/**
 * @fileoverview Synchronous, plugin-facing authorization predicates.
 *
 * Plugins cannot import the core backend's authorization facade (it
 * depends on Better Auth and lives outside the plugin workspace), so
 * these dependency-free helpers read the pre-resolved
 * {@link IAuthSession} the core middleware already attached to the
 * request.
 *
 * Unlike the core facade's async `isLoggedIn(req)` (which resolves the
 * session from cookies), these are synchronous pure reads of
 * `req.authSession` — the session was resolved once by the
 * `attachAuthSession` middleware before the request reached the plugin.
 */

import type { IAuthSession } from './IAuthSession.js';

/**
 * Group id reserved for administrators.
 *
 * Mirrors the core `ADMIN_GROUP_ID`. Exported so callers reference a
 * symbol rather than a bare `'admin'` literal.
 */
export const ADMIN_GROUP_ID = 'admin';

/**
 * Minimal request shape these predicates read.
 *
 * Declared structurally (rather than importing `IHttpRequest`) so the
 * helpers also accept any object carrying an `authSession` — test stubs,
 * the core Express request, a websocket-derived context.
 */
export interface IHasAuthSession {
    /** Resolved session: `null`/absent for anonymous, populated for logged-in. */
    authSession?: IAuthSession | null;
}

/**
 * Is the caller authenticated?
 *
 * `true` when the request carries a resolved Better Auth session.
 *
 * Acts as a TypeScript type guard: on the truthy branch `req.authSession`
 * narrows to {@link IAuthSession}, so plugins read `req.authSession.user.id`
 * without a non-null assertion.
 *
 * @param req - Request-like object with an `authSession`.
 * @returns Whether a session is present.
 */
export function isLoggedIn<T extends IHasAuthSession>(
    req: T
): req is T & { authSession: IAuthSession } {
    return req.authSession != null;
}

/**
 * Is the caller anonymous? Inverse of {@link isLoggedIn}.
 *
 * @param req - Request-like object with an `authSession`.
 * @returns Whether the caller has no session.
 */
export function isAnonymous<T extends IHasAuthSession>(
    req: T
): req is T & { authSession: null | undefined } {
    return req.authSession == null;
}

/**
 * Is the caller a member of a given group?
 *
 * Anonymous callers are always `false`. Group ids are case-sensitive.
 *
 * @param req - Request-like object with an `authSession`.
 * @param groupId - Group id to test.
 * @returns Whether the session's groups include `groupId`.
 */
export function isInGroup<T extends IHasAuthSession>(
    req: T,
    groupId: string
): req is T & { authSession: IAuthSession } {
    return req.authSession != null && req.authSession.groups.includes(groupId);
}

/**
 * Is the caller an administrator?
 *
 * Sugar for {@link isInGroup} with {@link ADMIN_GROUP_ID}, mirroring the
 * core facade so a future admin-tier change updates one place.
 *
 * @param req - Request-like object with an `authSession`.
 * @returns Whether the caller is in the `admin` group.
 */
export function isAdmin<T extends IHasAuthSession>(
    req: T
): req is T & { authSession: IAuthSession } {
    return isInGroup(req, ADMIN_GROUP_ID);
}

/**
 * Does the caller have a linked primary TRON wallet?
 *
 * Better Auth separates "logged in" from "owns a wallet": a visitor can
 * authenticate via email-OTP / OAuth / passkey with no wallet at all.
 * Use THIS predicate, not {@link isLoggedIn}, for wallet-gated routes, or
 * they would open to wallet-less accounts. Every wallet in the store is
 * signature-proven at link time, so a present `primaryWallet` is a proven
 * wallet.
 *
 * @param req - Request-like object with an `authSession`.
 * @returns Whether a logged-in caller has a primary wallet set.
 */
export function hasPrimaryWallet<T extends IHasAuthSession>(
    req: T
): req is T & { authSession: IAuthSession } {
    return req.authSession != null && req.authSession.primaryWallet != null;
}
