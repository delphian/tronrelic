/**
 * Canonical identity-state taxonomy for TronRelic users.
 *
 * Every user is in exactly one of three states. The states are ordered by
 * claim strength: anonymous → registered → verified. The array order encodes
 * this progression so claim-strength comparisons are an index lookup.
 *
 * The literal string values are the wire and database format. They appear in
 * MongoDB documents (`IUserDocument.identityState`), HTTP responses
 * (`IUser.identityState`), filter queries, log messages, and admin URLs.
 *
 * | Value          | Meaning                                                              |
 * |----------------|----------------------------------------------------------------------|
 * | `'anonymous'`  | UUID only. No wallets linked.                                        |
 * | `'registered'` | One or more linked wallets, none cryptographically signed.           |
 * | `'verified'`   | At least one linked wallet has been cryptographically signed.        |
 *
 * The state is **stored**, not derived at read time. `UserService` recomputes
 * and persists it on every wallet mutation. Consumers must read
 * `user.identityState` rather than reconstruct the value from `user.wallets`.
 *
 * See `src/backend/modules/user/README.md` for the full taxonomy documentation,
 * including security implications and the mapping to existing API surface
 * (`connectWallet`/`linkWallet` and the `verified: boolean` per-wallet flag).
 */
export const USER_IDENTITY_STATES = ['anonymous', 'registered', 'verified'] as const;

/**
 * The user's canonical identity state. See `USER_IDENTITY_STATES` for the
 * full taxonomy and storage rules.
 */
export type UserIdentityState = (typeof USER_IDENTITY_STATES)[number];
