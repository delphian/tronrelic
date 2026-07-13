/**
 * @fileoverview Payload for the `content.published` observer hook.
 *
 * When a curator approves a held item and the owning type commits that decision,
 * the item's canonical content becomes live — a blog post flips to `published`, a
 * social draft is marked sent, and so on. That transition is a domain fact other
 * components want to react to — announce it on social, index it for search, warm
 * a cache — without the curation module learning about any of them. Curation
 * fires this observer seam once per approved item, from inside its decision
 * commit, the moment the approved-status `applyEdit` succeeds.
 *
 * The payload is deliberately type-agnostic and self-sufficient: it names the
 * owning content type (`typeId`) and carries the opaque provider pointer (`ref`,
 * e.g. `{ postId }`) so a subscriber that recognizes the type can load the full
 * live record through existing tools, plus the decision-time `descriptor` for a
 * reactor that only needs the rendered snapshot. Core never interprets `ref`'s
 * shape — the subscriber scopes itself by `typeId` and resolves `ref` on its own.
 *
 * @module types/hooks/IContentPublishedContext
 */

import type { IContentDescriptor } from '../content/IContentDescriptor.js';

/**
 * Context handed to handlers of the `content.published` hook — the identity and
 * decision-time snapshot of one approved curation item whose canonical content
 * is now live.
 */
export interface IContentPublishedContext {
    /**
     * The owning content type id (e.g. the blog type). With `ref`, the complete
     * coordinate a subscriber needs to resolve the provider's own live record.
     */
    typeId: string;

    /**
     * The opaque provider pointer, resolved verbatim by the owning content type
     * back to its record (e.g. `{ postId: '...' }`). Core never interprets it.
     */
    ref: Record<string, unknown>;

    /**
     * The decision-time content descriptor — the snapshot the curator approved,
     * for a reactor that needs only the rendered view rather than the live record.
     */
    descriptor: IContentDescriptor;
}
