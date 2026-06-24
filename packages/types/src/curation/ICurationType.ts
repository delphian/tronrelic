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
 */
export interface ICurationType extends IContentType {
    /**
     * Opt this type into interactive destination selection. When true, the
     * review surface computes the publish sinks the content router admits for
     * the item and lets the curator pick one or more to deliver to on approval —
     * the human review gate doubling as the mandated-subset selector. When false
     * or omitted, approval is the classic single `onApprove` effect with no
     * picker, so existing types (an AI action held for review, a moderation
     * decision) are unaffected. The flag is the explicit boundary between
     * "approve = do the one thing" and "approve = route to chosen destinations".
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
     * Commit the held effect. Core records the approval first, then calls this;
     * the provider does whatever "approved" means for the type (release for
     * publication, enqueue, schedule). When the type publishes to destinations,
     * routed fan-out is lifted *out* of this verb — it runs before `onApprove`,
     * and the decided `item` it receives carries the per-destination outcomes —
     * so `onApprove` is left for the type's own bookkeeping (mark its record
     * published, decrement a quota). Throwing surfaces the failure to the admin
     * but does not roll the recorded decision back — design `onApprove` to be
     * safe to retry.
     *
     * @param item - The decided envelope, including `ref`, metadata, and (when
     *   the type publishes to destinations) the `destinations` outcomes.
     */
    onApprove(item: ICurationItem): void | Promise<void>;

    /**
     * Discard the held effect. Core records the rejection first, then calls
     * this so the provider can clean up its own record.
     *
     * @param item - The decided envelope, including `ref` and metadata.
     */
    onReject(item: ICurationItem): void | Promise<void>;
}
