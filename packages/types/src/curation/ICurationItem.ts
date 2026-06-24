/**
 * @file ICurationItem.ts
 *
 * The envelope core stores for one held effect in the central curation queue.
 * Core owns the envelope and the decision; the owning curation type owns the
 * payload. The envelope therefore carries an opaque `ref` (a pointer the type
 * resolves back to its own record) and a cached `preview` (the disabled-owner
 * fallback), never the content itself.
 */

import type { ICurationPreview } from './ICurationPreview.js';
import type { ICurationDestinationOutcome } from './ICurationDestination.js';

/**
 * Lifecycle status of a held item. Core advances `pending` to a terminal
 * `approved` or `rejected`; the owning type's `onApprove` / `onReject` runs
 * after the decision is recorded and owns whatever happens next (publish,
 * schedule, discard). Downstream states (scheduled, posted, failed) belong to
 * the provider, not to core.
 */
export type CurationItemStatus = 'pending' | 'approved' | 'rejected';

/**
 * One held effect awaiting (or having received) a curator decision.
 */
export interface ICurationItem {
    /** Server-assigned id (string form of the stored document `_id`). */
    id: string;

    /** Namespaced curation type id, e.g. `x-poster:tweet`. */
    typeId: string;

    /**
     * Id of the plugin or module that registered the owning type. Drives queue
     * grouping and tells core which provider must be present to resolve or
     * commit the item.
     */
    providerId: string;

    /**
     * Opaque pointer the owning type resolves back to its own record (e.g.
     * `{ postId: '...' }`). Core never interprets it — it is passed verbatim to
     * `describe()`, `onApprove()`, and `onReject()`.
     */
    ref: Record<string, unknown>;

    /**
     * Preview snapshot cached when the item was held. Core renders the queue
     * from a live `describe()` while the owner is registered and falls back to
     * this snapshot when the owning plugin is disabled.
     */
    preview: ICurationPreview;

    /** Current lifecycle status. */
    status: CurationItemStatus;

    /**
     * Free-form attribution of what produced the item (e.g.
     * `ai-tool:x-post-tweet`). Provider-neutral so any producer, not only AI
     * tools, can record where a held effect came from.
     */
    source?: string;

    /** When the item was held. */
    createdAt: Date;

    /** When a curator decided it; absent while pending. */
    decidedAt?: Date;

    /** Better Auth user id of the deciding curator; absent while pending. */
    decidedBy?: string;

    /**
     * The destinations a curator selected at approval, with their delivery
     * outcomes. Present only for an approved item of a type that publishes to
     * destinations; absent for rejected items, pending items, and types without
     * destination selection. Written `pending` in the same atomic transition as
     * the decision, then advanced to `delivered`/`failed` as each leg is sent —
     * the audit of exactly where the approved content landed.
     */
    destinations?: ICurationDestinationOutcome[];
}
