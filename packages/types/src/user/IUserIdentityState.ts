/**
 * Canonical identity-state taxonomy for TronRelic users.
 *
 * Every user is in exactly one of three states ordered by claim strength:
 * `Anonymous` → `Registered` → `Verified`. The string values are the wire and
 * database format. They appear in MongoDB documents
 * (`IUserDocument.identityState`), HTTP responses (`IUser.identityState`),
 * filter queries, log messages, and admin URLs.
 *
 * Defined as a string-valued enum so consumer code references members by name
 * (`UserIdentityState.Verified`) instead of bare string literals — the
 * compiler catches typos and refactors are safe.
 *
 * | Member       | Value          | Meaning                                                    |
 * |--------------|----------------|------------------------------------------------------------|
 * | `Anonymous`  | `'anonymous'`  | UUID only. No wallets linked.                              |
 * | `Registered` | `'registered'` | One or more linked wallets, none cryptographically signed. |
 * | `Verified`   | `'verified'`   | At least one linked wallet has been cryptographically signed. |
 *
 * The state is **stored**, not derived at read time. `UserService` recomputes
 * and persists it on every wallet mutation. Consumers must read
 * `user.identityState` rather than reconstruct the value from `user.wallets`.
 *
 * See `src/backend/modules/user/README.md` for the full taxonomy documentation,
 * including security implications and the mapping to existing API surface
 * (`connectWallet`/`linkWallet` and the `verified: boolean` per-wallet flag).
 */
export enum UserIdentityState {
    Anonymous = 'anonymous',
    Registered = 'registered',
    Verified = 'verified'
}

/**
 * Ordered list of identity states by claim strength (Anonymous → Registered →
 * Verified). Useful for index-based comparisons or iteration.
 */
export const USER_IDENTITY_STATES = [
    UserIdentityState.Anonymous,
    UserIdentityState.Registered,
    UserIdentityState.Verified
] as const;
