/**
 * @fileoverview Conversion between the Better Auth user id and the MongoDB
 * `_id` stored on `module_user_auth_users`.
 *
 * **The contract this module enforces.** Better Auth's `mongodbAdapter` lets
 * MongoDB generate each user document's `_id` as a native `ObjectId` and
 * exposes it to application code as that ObjectId's 24-character hex string
 * (`session.user.id`, `req.authSession.user.id`). The rest of the codebase
 * treats that hex string as the canonical, *opaque* user id: it is stored
 * verbatim as a foreign key in module/plugin collections, compared verbatim,
 * and never cast to an `ObjectId` by consumers. The single place the string
 * must become an `ObjectId` is here — the boundary where identity services
 * read or write the Better Auth user collection by `_id`. Confining the
 * conversion to one module keeps every other surface (and every plugin)
 * ignorant of the storage type, and means a future change to Better Auth's id
 * strategy touches exactly this file.
 *
 * Code outside the identity module must not import these helpers to hand-roll
 * Better Auth collection access. It consumes account, wallet, and group data
 * through the registered `'accounts'` / `'wallets'` / `'user-groups'` service
 * contracts, which return the opaque hex string.
 */

import { ObjectId } from 'mongodb';

/** A Better Auth user id is the 24-character hex form of its ObjectId `_id`. */
const USER_ID_HEX = /^[0-9a-fA-F]{24}$/;

/**
 * Convert a Better Auth user id (hex string) to the `ObjectId` stored as
 * `_id` on `module_user_auth_users`.
 *
 * Returns `null` for any value that is not a 24-character hex string, so
 * callers treat a malformed id as "no such user" — a no-match read or a
 * no-op write — rather than throwing. This mirrors the auth facade's
 * graceful-degradation contract: a bad id never escalates to a 500.
 *
 * @param userId - Better Auth user id as exposed on the resolved session.
 * @returns The matching `ObjectId`, or `null` when `userId` is malformed.
 */
export function toUserKey(userId: string): ObjectId | null {
    const key = typeof userId === 'string' && USER_ID_HEX.test(userId) ? new ObjectId(userId) : null;
    return key;
}

/**
 * Convert the stored `_id` `ObjectId` back to the canonical hex-string user
 * id the rest of the application consumes.
 *
 * Identity services call this on every id value leaving their surface so an
 * `ObjectId` never crosses the module boundary — callers always receive the
 * same opaque string they passed in.
 *
 * @param id - The `_id` ObjectId from a `module_user_auth_users` document.
 * @returns The 24-character hex user id.
 */
export function userIdFromKey(id: ObjectId): string {
    const userId = id.toHexString();
    return userId;
}
