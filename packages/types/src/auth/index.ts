/**
 * @fileoverview Barrel for the plugin-facing Better Auth authorization
 * surface: the {@link IAuthSession} shape carried on `req.authSession`
 * and the synchronous {@link isLoggedIn} / {@link isAdmin} predicates
 * plugins use in place of the retired `req.user.identityState` checks.
 */

export type { IAuthSession, IAuthSessionUser } from './IAuthSession.js';
export {
    ADMIN_GROUP_ID,
    isLoggedIn,
    isAnonymous,
    isInGroup,
    isAdmin,
    type IHasAuthSession
} from './authPredicates.js';
