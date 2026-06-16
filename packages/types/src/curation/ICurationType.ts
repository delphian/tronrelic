/**
 * @file ICurationType.ts
 *
 * The contract a provider registers with the curation service to make a content
 * type reviewable in the central queue. It is the three delegations core needs
 * to stay content-agnostic: how to *preview* an item, what to do on *approve*,
 * and what to do on *reject*. Editing is a frontend concern (an `EditorComponent`
 * registered separately) and writes through the provider's own routes, so it is
 * not part of this backend contract.
 */

import type { ICurationItem } from './ICurationItem.js';
import type { ICurationPreview } from './ICurationPreview.js';

/**
 * A generic, payload-agnostic edit an operator applies to a held item before
 * deciding it. Core knows only these neutral fields; the owning type maps them
 * onto its own record. Today just the body text — the one field the preview
 * already exposes as editable — kept small and extensible.
 */
export interface ICurationEditPatch {
    /** Replacement body text for the held content. */
    body?: string;
}

/**
 * A reviewable content type. One provider may register several — a tweet, a
 * generated image — each with its own namespaced `typeId`.
 */
export interface ICurationType {
    /**
     * Namespaced id `<provider>:<name>`, e.g. `x-poster:tweet`. The prefix
     * mirrors plugin collection and WebSocket namespacing and is how an AI
     * tool's `curationTypeId` binding is verified.
     */
    typeId: string;

    /** Human-readable label for queue grouping and headings. */
    label: string;

    /**
     * Flatten the record identified by `ref` into a content-agnostic preview
     * core can render. Runs server-side and may resolve cross-plugin references
     * (e.g. a file id to a public URL). Core calls this at hold time to cache a
     * snapshot and again live while the type is registered, so it must be safe
     * to call repeatedly and must not mutate the record.
     *
     * @param ref - The opaque pointer supplied when the item was held.
     * @returns The preview descriptor, or a promise of it.
     */
    describe(ref: Record<string, unknown>): ICurationPreview | Promise<ICurationPreview>;

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

    /**
     * Apply an operator's inline edit to the held content before a decision.
     * Optional — a type that omits it is not editable and core surfaces no edit
     * affordance. Core passes a generic, payload-agnostic patch; the type maps it
     * onto its own record and enforces its own validation, throwing a descriptive
     * Error the queue surfaces. Invoked only while the item is pending; core
     * re-derives the cached preview from `describe()` afterward.
     *
     * @param item - The held envelope (its `ref` addresses the record).
     * @param patch - The generic edit to apply.
     */
    applyEdit?(item: ICurationItem, patch: ICurationEditPatch): void | Promise<void>;
}
