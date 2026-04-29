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
 * | Member       | Value          | Meaning                                                                  |
 * |--------------|----------------|--------------------------------------------------------------------------|
 * | `Anonymous`  | `'anonymous'`  | UUID only. No wallets linked.                                            |
 * | `Registered` | `'registered'` | One or more linked wallets; no live verified session.                    |
 * | `Verified`   | `'verified'`   | A wallet was signed and the resulting session is within `SESSION_TTL_MS`.|
 *
 * `identityState` is the **authoritative stored field**. `UserService`
 * writes it exactly once per state transition (connectWallet,
 * linkWallet, unlinkWallet, logout, identity reconciliation, lazy
 * session expiry on read). Consumers read `user.identityState`
 * directly — there is no derivation step. Session freshness lives in
 * the sibling field `IUser.identityVerifiedAt` and is enforced by the
 * lazy-expiry pass inside `UserService.getById` (and the related
 * lookup paths), which downgrades a stale Verified user to Registered
 * and persists the change before returning the user payload.
 *
 * See `src/backend/modules/user/README.md` for the full taxonomy
 * documentation, including security implications and the mapping to
 * existing API surface (`connectWallet`/`linkWallet` and the
 * `verified: boolean` per-wallet historical audit flag).
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
