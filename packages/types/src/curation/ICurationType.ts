/**
 * @file ICurationType.ts
 *
 * The curation **binding**: the declarative decision bookkeeping a provider adds
 * onto a reusable {@link IContentType} to make its content reviewable in the
 * central queue. The content half — `typeId`, `label`, `describe()` — is
 * inherited from `IContentType` and shared with every other pipeline; only
 * `decisionStatus` (which status word to write per decision) is curation-specific,
 * because only curation has an approve/reject lifecycle. A provider still passes
 * one object to `registerType`; the registry separates the content facet from the
 * binding.
 *
 * Decisions are declarative only. Core resolves a decision to `approved` /
 * `rejected`, looks up the type's declared status word, and applies it through the
 * inherited `applyEdit({ status })` seam — so the terminal bookkeeping is data the
 * platform can read and introspect, never opaque callback code. There is no
 * imperative approve/reject verb: a type that needs a side effect on approval
 * routes it through a content-router publish sink, not through the binding.
 */

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
 * A reviewable content type: a content type plus curation's declarative decision
 * bookkeeping. One provider may register several — a tweet, a generated image —
 * each with its own namespaced `typeId` inherited from {@link IContentType}.
 * `describe` and `applyEdit` are inherited too — both operate on the originator's
 * own record — leaving only the `decisionStatus` map curation-specific.
 *
 * A decision resolves through the `decisionStatus` word core writes via
 * `applyEdit({ status })`. `rejected` is required — rejection is intrinsic to
 * being reviewable and nothing else can carry it. `approved` is optional: a
 * `publishesToSinks` type omits it when a routed publish sink carries the
 * approval, so an approve-time status write would double-publish. `applyEdit` is
 * required (narrowed from optional on `IContentType`) because it is the sole
 * commit seam every decision lands through.
 */
export interface ICurationType extends IContentType {
    /**
     * Opt this type into interactive sink selection on approval. When true, the
     * review surface computes the content router's `publish` sinks admitted for
     * the item (within this type's `classification` ceiling) and lets the curator
     * pick which fire on approval — the human review gate doubling as the
     * mandated-subset selector. The router owns which sinks are *eligible*;
     * curation owns which the human *picked*.
     *
     * The selection is required, not optional. When the item has at least one
     * eligible publish sink, curation blocks an approval that selects none (at
     * the service, mirrored by the picker's disabled Approve button) — a decision
     * must never record while publishing nowhere. When zero sinks are eligible (a
     * classic type, or a publishes-to-sinks type whose transports are all
     * disabled) there is nothing to select, so approval proceeds and routes
     * nowhere — the guard never deadlocks a queue.
     *
     * When false or omitted, the type is "classic": approval has no picker and is
     * the single commit its `decisionStatus.approved` word performs (release an AI
     * action, apply a moderation decision), unaffected by the selection guard. The
     * flag is the explicit boundary between "approve = do the one thing" and
     * "approve = route to chosen sinks".
     */
    publishesToSinks?: boolean;

    /**
     * The content's exposure ceiling, used by the router's classification gate to
     * bound which sinks the picker may offer (`reach ≤ classification`). A type
     * that omits it is treated as the most restrictive ceiling
     * (`{ internal, admin }`), so a type publishes externally only by explicitly
     * raising its ceiling — fail-safe, never accidental external egress. Ignored
     * unless `publishesToSinks` is true.
     */
    classification?: IContentClassification;

    /**
     * The originator's own status word core writes when it resolves each decision,
     * applied through the inherited `applyEdit({ status })` seam so the decision's
     * terminal bookkeeping is readable data rather than a callback.
     *
     * `rejected` is required: every reviewable item can be rejected, persist-then-
     * hold guarantees a record to mark, and nothing else carries a rejection.
     * `approved` is optional — omit it on a `publishesToSinks` type whose
     * approval is carried entirely by its routed publish sink, so core writes no
     * approve-time transition and the sink flips the record itself.
     */
    decisionStatus: {
        /** Status word written to the record on approval; omit when a routed sink carries the publish. */
        approved?: string;

        /** Status word written to the record on rejection. Required. */
        rejected: string;
    };

    /**
     * Apply a generic, payload-agnostic edit to the content's own record. Required
     * on a curation type (narrowed from optional on `IContentType`) because it is
     * the sole seam every decision commits through — core writes the
     * `decisionStatus` word here as a `{ status }` patch — and also carries a
     * curator's inline `{ body }` edit. The type maps the patch onto its record,
     * enforces its own validation, and throws a descriptive Error the consumer
     * surfaces. Addressed by the same opaque `ref` as `describe()`.
     *
     * @param ref - The opaque pointer identifying the record to edit.
     * @param patch - The generic edit to apply — a `{ status }` transition or a `{ body }` edit.
     */
    applyEdit(ref: Record<string, unknown>, patch: IContentEditPatch): void | Promise<void>;
}
