/**
 * Server-computed authorization snapshot attached to user payloads.
 *
 * The platform answers "is this person an admin right now?" in three
 * places — the `requireAdmin` middleware (action authorization), the
 * `MenuService` filter that controls navbar visibility (affordance),
 * and the frontend `SystemAuthGate` that decides whether to admit the
 * visitor to `/system` (page entry). Each tier asks the same question,
 * and they all reduce to two primitives: identity-state verification
 * (`identityState === Verified`, which itself folds in freshness via
 * `deriveIdentityState`), and admin-group membership through
 * `IUserGroupService.isAdmin` (which matches the reserved-admin slug
 * pattern, not just the literal `'admin'`).
 *
 * The server computes the snapshot once via `computeUserAuthStatus`,
 * ships it on every `IUser` payload as `authStatus`, and consumers
 * read these booleans rather than re-deriving them from raw fields.
 *
 * Two booleans cover every gate the platform has. Verification
 * freshness is no longer a separate field because `Verified` itself
 * means "fresh-Verified" — a stale-signature user reads as
 * `Registered` and `isVerified` is false. There is no "admin but
 * stale" state: if the user is in the admin group but no wallet is
 * fresh, `isVerified` is false and the gate falls to the generic
 * "not-Verified" branch, recovering through the normal verify-wallet
 * flow on `/profile`. Recovery has no special UI surface.
 */
export interface IAuthStatus {
    /**
     * True iff the user's current identity state is `Verified` — at
     * least one linked wallet has a `verifiedAt` within the freshness
     * window. The "ever proven" flag (`wallets[].verified === true`)
     * alone is not enough; the proof must be recent.
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
