/**
 * Single source of truth for `IAuthStatus` computation.
 *
 * Every gate in the platform — `requireAdmin` middleware, the
 * `MenuService` affordance filter, the frontend `SystemAuthGate` —
 * reduces to the same two questions: is this user currently Verified,
 * and are they in an admin group. Verification freshness is folded
 * into `Verified` itself (see `deriveIdentityState`), so a stale
 * signature reads as `Registered` and the gate falls to the generic
 * "not Verified" branch — no separate stale-admin state, no special
 * recovery branch.
 *
 * This module centralizes that snapshot. `requireAdmin`, `isAdmin(req)`,
 * and the user controller's response-shaping helper all consume it;
 * the payload travels to the client as `IUser.authStatus`; the
 * frontend reads booleans rather than re-deriving from raw fields.
 *
 * The function is async because `IUserGroupService.isAdmin` round-trips
 * to the database to evaluate the reserved-admin pattern with
 * `system: true`. Centralizing the logic keeps every caller on the same
 * semantics, but it does not make that query free: because
 * `withAuthStatus` decorates every user-controller response, response
 * shaping now performs an `isAdmin` lookup on paths that previously
 * needed no admin check (e.g. user bootstrap, profile reads). That
 * cost is the price of a single freshness-aware predicate everywhere —
 * worth measuring under load if the user-controller hot path widens.
 */

import { UserIdentityState } from '@/types';
import type { IAuthStatus, IUser, IUserGroupService } from '@/types';

/**
 * Compute the canonical authorization snapshot for a resolved user.
 *
 * Accepts an `IUser` whose `identityState` already reflects current
 * truth (i.e. has been derived through `deriveIdentityState` at the
 * serialization boundary) and a reference to the user-group service.
 *
 * The function intentionally does not accept a request, a cookie, or a
 * service token — those are concerns of the middleware that wraps it.
 * Keeping the predicate request-agnostic lets the bootstrap controller,
 * the user-update broadcast, and any future server-side consumer use
 * the same code path without faking a request object.
 */
export async function computeUserAuthStatus(
    user: IUser,
    groupService: IUserGroupService
): Promise<IAuthStatus> {
    return {
        isVerified: user.identityState === UserIdentityState.Verified,
        isAdmin: await groupService.isAdmin(user.id)
    };
}

/**
 * Attach a freshly computed `authStatus` to an `IUser` for response
 * shaping. Returns a new object — does not mutate the input — so callers
 * that hold onto the original storage-shape `IUser` aren't surprised by
 * a transient field appearing on it.
 */
export async function withAuthStatus(
    user: IUser,
    groupService: IUserGroupService
): Promise<IUser> {
    const authStatus = await computeUserAuthStatus(user, groupService);
    return { ...user, authStatus };
}
