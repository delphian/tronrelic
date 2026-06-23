/**
 * @file IContentClassification.ts
 *
 * The governed sensitivity vocabulary the content router routes against. A
 * content type carries a classification (`{ egress, audience }`) describing the
 * *ceiling* on how far and how broadly its content may be exposed; a sink
 * declares its `reach` — the exposure it causes — in the same vocabulary. The
 * classification gate admits a sink only when its `reach` stays within the
 * content's ceiling on every dimension, so a `{ internal, admin }` audit record
 * never becomes a candidate for a `{ external, public }` Twitter sink.
 *
 * The vocabulary is governed, not free-form strings: both authors import these
 * enums, and the router refuses a sink whose `reach` carries an unknown
 * dimension or level (fail-fast, the way the hook registry refuses an unknown
 * descriptor). The ordered level tuples below are the single source of truth for
 * both the membership check and the `reach ≤ classification` comparison — the
 * index of a level in its tuple is its rank, ascending from least to most
 * exposed. Keep the set coarse and orthogonal to a content type's id; a
 * dimension that re-encodes the `typeId` would rebuild the coupling the router
 * exists to remove.
 *
 * @see ../../../../docs/system/system-content-routing.md — the design that
 *   prescribes classification-as-ceiling and the `reach ≤ classification` gate.
 */

/**
 * Egress levels in ascending order of how far content may travel. `internal`
 * never leaves the platform, `user` reaches an authenticated user surface,
 * `external` leaves the building entirely (a third-party API). The tuple order
 * is load-bearing — it defines the rank used by the gate's `reach ≤ ceiling`
 * comparison — so new levels must be inserted at the correct exposure position,
 * never appended for convenience.
 */
export const CONTENT_EGRESS_LEVELS = ['internal', 'user', 'external'] as const;

/**
 * Audience levels in ascending order of how broadly content may be seen.
 * `admin` is the narrowest, `public` the widest. Ordered for the same
 * rank-comparison reason as {@link CONTENT_EGRESS_LEVELS}.
 */
export const CONTENT_AUDIENCE_LEVELS = ['admin', 'user', 'public'] as const;

/**
 * How far content may be exposed. Derived from {@link CONTENT_EGRESS_LEVELS} so
 * the type and the runtime membership/rank check can never drift apart.
 */
export type ContentEgress = typeof CONTENT_EGRESS_LEVELS[number];

/**
 * How broadly content may be exposed. Derived from
 * {@link CONTENT_AUDIENCE_LEVELS} for the same single-source-of-truth reason.
 */
export type ContentAudience = typeof CONTENT_AUDIENCE_LEVELS[number];

/**
 * A content type's sensitivity label and, in the same shape, a sink's `reach`.
 * On a content type it is a *ceiling* — the maximum exposure the content
 * permits, data about the content and never a destination. On a sink it is the
 * exposure that sink *causes*. The gate compares the two componentwise; the
 * label caps where content may go, it never grants exposure.
 *
 * The two dimensions are orthogonal on purpose: `{ external, admin }` ("may
 * leave the building, but only to admins at the far end") is a coherent label,
 * and the componentwise rule handles it without special cases.
 */
export interface IContentClassification {
    /** How far the content may be exposed (a ceiling). */
    egress: ContentEgress;

    /** How broadly the content may be exposed (a ceiling). */
    audience: ContentAudience;
}
