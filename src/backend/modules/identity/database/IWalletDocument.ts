/**
 * @fileoverview MongoDB document interface for Better Auth-keyed wallet links.
 *
 * The `module_user_wallets` collection is keyed by the Better Auth user id.
 * Better Auth identity is portable across devices via email-OTP / OAuth /
 * passkey, so the model needs no register/verify two-stage flow or
 * cross-browser identity reconciliation, and is deliberately simple:
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
