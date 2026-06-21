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
     * Commit the held effect. Core records the approval first, then calls this;
     * the provider does whatever "approved" means for the type (release for
     * publication, enqueue, schedule). Throwing surfaces the failure to the
     * admin but does not roll the recorded decision back — design `onApprove`
     * to be safe to retry.
     *
     * @param item - The decided envelope, including `ref` and metadata.
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
