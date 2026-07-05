/**
 * @file IContentType.ts
 *
 * The reusable, pipeline-agnostic definition of a provider-owned piece of
 * content. It is the platform "noun": a content type knows its own identity and
 * how to flatten its record into a generic {@link IContentDescriptor}, and it
 * knows nothing about the pipelines that consume it. Curation binds review verbs
 * (approve / reject) onto a content type; a future notification pipeline binds
 * delivery onto the same type — neither concern lives here.
 *
 * The originator owns the content. Core holds only an opaque `ref` (a pointer
 * the type resolves back to its own record) and reaches the content on demand
 * through `describe()`; the payload itself never enters core. Because content
 * round-trips persistence and is recovered by the runtime `typeId` tag, the
 * concrete payload type lives only at the provider's edge — core stays
 * content-agnostic behind this interface.
 */

import type { IContentDescriptor } from './IContentDescriptor.js';

/**
 * A generic, payload-agnostic edit a consumer applies to a content instance
 * through its owning type. Core knows only these neutral fields; the owning type
 * maps them onto its own record and enforces its own validation. Today just the
 * body text — the one field the descriptor already exposes as editable — kept
 * small and extensible so a new editable field is an additive change.
 */
export interface IContentEditPatch {
    /** Replacement body text for the content. */
    body?: string;

    /**
     * A lifecycle status transition to apply to the content's own record,
     * expressed in the originator's own status vocabulary (e.g. `'published'`,
     * `'rejected'`). Core writes this when a pipeline resolves a decision
     * declaratively — a curation type that declares `decisionStatus` instead of
     * imperative `onApprove`/`onReject` verbs — and the owning type maps the word
     * onto its record, validating it and treating an already-decided record as a
     * benign no-op rather than an error. Distinct from `body`: a body edit is the
     * curator changing content, a status transition is the decision taking hold.
     */
    status?: string;
}

/**
 * A reusable content type a provider registers once and any pipeline consumes.
 * One provider may define several — a tweet, a generated image — each with its
 * own namespaced `typeId`.
 */
export interface IContentType {
    /**
     * Namespaced id `<provider>:<name>`, e.g. `x-poster:tweet`. The prefix
     * mirrors plugin collection and WebSocket namespacing and is the stable key
     * every pipeline and binding references the content type by.
     */
    typeId: string;

    /** Human-readable label for queue grouping, headings, and admin listing. */
    label: string;

    /**
     * Flatten the record identified by `ref` into a content-agnostic descriptor
     * a pipeline can render. Runs server-side and may resolve cross-plugin
     * references (e.g. a file id to a public URL). A consumer may call this at
     * hold time to cache a snapshot and again live while the type is registered,
     * so it must be safe to call repeatedly and must not mutate the record.
     *
     * @param ref - The opaque pointer supplied when the content was held or fired.
     * @returns The descriptor, or a promise of it.
     */
    describe(ref: Record<string, unknown>): IContentDescriptor | Promise<IContentDescriptor>;

    /**
     * Apply a generic, payload-agnostic edit to the content's own record before
     * a consuming pipeline acts on it. Optional — a type that omits it is not
     * editable and consumers surface no edit affordance. The type maps the patch
     * onto its record and enforces its own validation, throwing a descriptive
     * Error the consumer surfaces. Addressed by the same opaque `ref` as
     * `describe()`, because editing the content is the originator's concern, not
     * any one pipeline's.
     *
     * @param ref - The opaque pointer identifying the record to edit.
     * @param patch - The generic edit to apply.
     */
    applyEdit?(ref: Record<string, unknown>, patch: IContentEditPatch): void | Promise<void>;
}
