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
 * | Member       | Value          | Meaning                                                                       |
 * |--------------|----------------|-------------------------------------------------------------------------------|
 * | `Anonymous`  | `'anonymous'`  | UUID only. No wallets linked.                                                 |
 * | `Registered` | `'registered'` | One or more linked wallets; no current cryptographic proof of ownership.      |
 * | `Verified`   | `'verified'`   | At least one linked wallet has been signed within `VERIFICATION_FRESHNESS_MS`. |
 *
 * Verification freshness is folded into `Verified`. A user whose every
 * wallet's `verifiedAt` has aged past the freshness window collapses to
 * `Registered` until they re-sign — an expired proof and an absent
 * proof are functionally indistinguishable for any consumer gating on
 * `Verified`. The whole platform reads one field; there is no separate
 * "stale" gate anywhere.
 *
 * The wire form is **always derived** at the API boundary by
 * `deriveIdentityState(wallets)` (in `IUser.ts`). `UserService.toPublicUser`
 * computes through it on every read so the value reflects current truth
 * even when storage drifted because no wallet mutation triggered a
 * recompute. Storage may hold a denormalized copy for indexes and admin
 * filter queries, but storage is a cache — wire form is canonical.
 * Consumers must read `user.identityState` directly rather than
 * reconstruct from `user.wallets`; that's still the rule, just enforced
 * from the serialization boundary instead of the storage path.
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
