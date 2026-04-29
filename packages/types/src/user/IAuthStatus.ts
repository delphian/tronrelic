/**
 * Server-computed authorization snapshot attached to user payloads.
 *
 * The platform answers "is this person an admin right now?" in three
 * places — the `requireAdmin` middleware (action authorization), the
 * `MenuService` filter that controls navbar visibility (affordance),
 * and the frontend `SystemAuthGate` that decides whether to admit the
 * visitor to `/system` (page entry). Each tier asks the same question,
 * and they all reduce to two primitives: identity-state verification
 * (`identityState === Verified`, the authoritative stored field whose
 * freshness is enforced by the lazy session-expiry pass inside
 * `UserService.getById`), and admin-group membership through
 * `IUserGroupService.isAdmin` (which matches the reserved-admin slug
 * pattern, not just the literal `'admin'`).
 *
 * The server computes the snapshot once via `computeUserAuthStatus`,
 * ships it on every `IUser` payload as `authStatus`, and consumers
 * read these booleans rather than re-deriving them from raw fields.
 *
 * Two booleans cover every gate the platform has. Session expiry is
 * not a separate field because by the time the predicate runs the
 * user has already been passed through `getById`, which lazily
 * downgrades a stale Verified user to Registered before returning —
 * `isVerified` is therefore false for an expired session, and the
 * gate falls to the generic "not-Verified" branch. Recovery is the
 * normal verify-wallet flow on `/profile`; no special UI surface.
 */
export interface IAuthStatus {
    /**
     * True iff `user.identityState === Verified` at the moment the
     * snapshot was computed. The lazy session-expiry pass inside
     * `UserService.getById` has already demoted any stale Verified
     * user to Registered before this predicate sees them, so a `true`
     * value here means "session is currently within `SESSION_TTL_MS`".
     */
    isVerified: boolean;
    /**
     * True iff the user is in any system-flagged admin-pattern group.
     * Independent of verification freshness. The action gate is
     * `isVerified && isAdmin`; consumers can compute that one
     * conjunction at the call site.
     */
    isAdmin: boolean;
}
