/**
 * @file ICurationType.ts
 *
 * The curation **binding**: the review verbs a provider adds onto a reusable
 * {@link IContentType} to make its content reviewable in the central queue. The
 * content half — `typeId`, `label`, `describe()` — is inherited from
 * `IContentType` and is shared with every other pipeline; only `onApprove`,
 * `onReject`, and the optional `applyEdit` are curation-specific, because only
 * curation has an approve/reject lifecycle. A provider still passes one object
 * to `registerType`; the registry separates the content facet from the binding.
 *
 * Editing routes through the provider's own record — core passes a neutral
 * patch and the type owns the write — so `applyEdit` stays on the curation
 * binding rather than the content type until a second pipeline needs content
 * mutation.
 */

import type { ICurationItem } from './ICurationItem.js';
import type { IContentType, IContentEditPatch } from '../content/IContentType.js';
import type { IContentClassification } from '../content/IContentClassification.js';

/**
 * Retained alias of the platform-wide {@link IContentEditPatch}. Editing a held
 * item is content self-mutation, so the patch shape is shared with every
 * pipeline rather than owned by curation; the name is kept so existing curation
 * code compiles unchanged.
 */
export type ICurationEditPatch = IContentEditPatch;

/**
 * A reviewable content type: a content type plus the curation lifecycle verbs.
 * One provider may register several — a tweet, a generated image — each with its
 * own namespaced `typeId` inherited from {@link IContentType}. `describe` and
 * `applyEdit` are inherited too — both operate on the originator's own record —
 * leaving only the approve/reject decision semantics curation-specific.
 *
 * A type expresses those decision semantics one of two ways. The imperative form
 * supplies `onApprove`/`onReject` callbacks. The declarative form omits them and
 * supplies `decisionStatus` — the originator's status word per decision — which
 * core applies through the inherited `applyEdit({ status })` seam, so the
 * terminal bookkeeping is data the platform can read and introspect rather than
 * opaque callback code. Both verbs are optional; a type that declares neither a
 * verb nor a `decisionStatus` word for a decision makes that decision a
 * deliberate no-op (e.g. an approval carried entirely by a routed publish sink).
 */
export interface ICurationType extends IContentType {
    /**
     * Opt this type into interactive destination selection on approval. When
     * true, the review surface computes the content router's `publish` sinks
     * admitted for the item (within this type's `classification` ceiling) and
     * lets the curator pick which fire on approval — the human review gate
     * doubling as the mandated-subset selector. "Destination" is curation's
     * curator-facing name for a content-router publish sink: the same target
     * named at two layers — the router owns which sinks are *eligible*, curation
     * owns which the human *picked*.
     *
     * The selection is required, not optional. When the item has at least one
     * eligible publish sink, curation blocks an approval that selects none (at
     * the service, mirrored by the picker's disabled Approve button) — a decision
     * must never record while publishing nowhere. When zero sinks are eligible (a
     * classic type, or a destinations type whose transports are all disabled)
     * there is nothing to select, so approval proceeds and routes nowhere — the
     * guard never deadlocks a queue.
     *
     * When false or omitted, the type is "classic": approval has no picker and is
     * the single commit its `onApprove` verb or `decisionStatus.approved` word
     * performs (release an AI action, apply a moderation decision), unaffected by
     * the selection guard. The flag is the explicit boundary between "approve =
     * do the one thing" and "approve = route to chosen destinations".
     */
    publishesToDestinations?: boolean;

    /**
     * The content's exposure ceiling, used by the router's classification gate to
     * bound which sinks the picker may offer (`reach ≤ classification`). A type
     * that omits it is treated as the most restrictive ceiling
     * (`{ internal, admin }`), so a type publishes externally only by explicitly
     * raising its ceiling — fail-safe, never accidental external egress. Ignored
     * unless `publishesToDestinations` is true.
     */
    classification?: IContentClassification;

    /**
     * Declarative alternative to the imperative `onApprove`/`onReject` verbs: the
     * originator's own status word to write when core resolves each decision. When
     * a type omits the matching verb, core applies the mapped word through the
     * inherited `applyEdit({ status })` seam — so the decision's terminal
     * bookkeeping is readable data, not a callback. Omit a key to make that
     * decision a no-op: a `publishesToDestinations` type whose approval is carried
     * entirely by its routed publish sink declares only `rejected`. Ignored for a
     * decision whose imperative verb is present — the verb wins.
     */
    decisionStatus?: {
        /** Status word written to the record on approval; omit when a routed sink carries the publish. */
        approved?: string;

        /** Status word written to the record on rejection. */
        rejected?: string;
    };

    /**
     * Commit the held effect imperatively. Optional — a type may instead declare
     * `decisionStatus.approved` and let core apply it through `applyEdit`. When
     * present, core records the approval first, then calls this; the provider does
     * whatever "approved" means for the type (release for publication, enqueue,
     * schedule). When the type publishes to destinations, routed fan-out is lifted
     * *out* of this verb — it runs before `onApprove`, and the decided `item` it
     * receives carries the per-destination outcomes — so `onApprove` is left for
     * the type's own bookkeeping (mark its record published, decrement a quota).
     * Throwing surfaces the failure to the admin but does not roll the recorded
     * decision back — design `onApprove` to be safe to retry.
     *
     * @param item - The decided envelope, including `ref`, metadata, and (when
     *   the type publishes to destinations) the `destinations` outcomes.
     */
    onApprove?(item: ICurationItem): void | Promise<void>;

    /**
     * Discard the held effect imperatively. Optional — a type may instead declare
     * `decisionStatus.rejected` and let core apply it through `applyEdit`. When
     * present, core records the rejection first, then calls this so the provider
     * can clean up its own record.
     *
     * @param item - The decided envelope, including `ref` and metadata.
     */
    onReject?(item: ICurationItem): void | Promise<void>;
}
