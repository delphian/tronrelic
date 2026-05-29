/**
 * @fileoverview MongoDB document interface for Better Auth-keyed wallet links.
 *
 * Phase 4 of the Better Auth refactor introduces a dedicated
 * `module_user_wallets` collection keyed by the Better Auth user id,
 * replacing the legacy `users.wallets[]` embedded array that was keyed
 * by the UUID identity. The legacy embedded model carried a
 * register/verify two-stage flow and cross-browser identity
 * reconciliation because UUIDs were browser-local; Better Auth identity
 * is portable across devices via email-OTP / OAuth / passkey, so the
 * new model is deliberately simpler:
 *
 * - A wallet is only stored after a signature proves ownership, so
 *   there is no "registered (unverified)" wallet state and no `verified`
 *   flag — every persisted row is verified by construction.
 * - A wallet belongs to exactly one Better Auth account (unique index
 *   on `address`); claiming a wallet already linked elsewhere is a hard
 *   conflict, not a merge.
 *
 * The user's primary wallet is denormalized onto the Better Auth user
 * record's `primaryWallet` additional field (see `auth.ts`) so it
 * surfaces on the session without a second query; this collection holds
 * the full list and is the source of truth the denormalized pointer is
 * derived from.
 */

import type { ObjectId } from 'mongodb';

/**
 * Persisted wallet link, keyed by Better Auth user id.
 *
 * One document per (account, address). All rows are verified —
 * ownership is proven by a TronLink signature over a server-issued
 * challenge before the row is written.
 */
export interface IWalletDocument {
    /** MongoDB primary key. */
    _id: ObjectId;

    /**
     * Better Auth user id (the `module_user_auth_users._id` value, also
     * returned as `user.id` from the BA session API). Not a UUID — the
     * legacy UUID identity is decommissioned in Phase 6.
     */
    userId: string;

    /** Normalized base58 TRON address. Globally unique across accounts. */
    address: string;

    /** Whether this is the account's primary wallet. Exactly one per account. */
    isPrimary: boolean;

    /** When the wallet was first linked to this account. */
    linkedAt: Date;

    /** Most recent signature/use timestamp; drives primary recomputation on unlink. */
    lastUsedAt: Date;
}

/**
 * Public wire shape returned by the wallet service and API.
 *
 * Strips the Mongo `_id` and `userId` (implied by the authenticated
 * session) and exposes only what the profile UI needs. Date fields are
 * serialized to ISO strings by Express `res.json`.
 */
export interface ILinkedWallet {
    /** Normalized base58 TRON address. */
    address: string;

    /** Whether this is the account's primary wallet. */
    isPrimary: boolean;

    /** When the wallet was first linked to this account. */
    linkedAt: Date;

    /** Most recent signature/use timestamp. */
    lastUsedAt: Date;
}
