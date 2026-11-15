/**
 * @fileoverview The columns the admin account list can be sorted by, shared so
 * the Users tab, the admin endpoint, and the identity AI tools accept exactly
 * the same names.
 */

/**
 * Every field an account list may be sorted by.
 *
 * - `email`, `name`: alphabetical, ignoring case.
 * - `status`: deleted first, then unverified, then verified (ascending).
 * - `primaryWallet`: accounts without a primary wallet first (ascending).
 * - `groups`: by how many groups the account belongs to.
 * - `createdAt`: when the account was created.
 * - `lastSeenAt`: when the account last made a signed-in request; accounts
 *   never seen sort as the oldest.
 */
export const ACCOUNT_SORT_FIELDS = ['email', 'name', 'status', 'primaryWallet', 'groups', 'createdAt', 'lastSeenAt'] as const;
