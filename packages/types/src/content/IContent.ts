/**
 * @file IContent.ts
 *
 * The base type every piece of managed content extends. Its fields are the
 * ones every content type shares — identity, ownership, review state, audit,
 * and soft deletion — and core stores them in its own collection, apart from
 * the content itself. The author of a content type (a module or plugin) stores
 * only the type-specific fields, keyed by the same `id`.
 *
 * A reader never has to join the two by hand. The core content service reads
 * the base row, asks the author for the type-specific fields, and returns one
 * merged object, so a page read through core is an `IPageContent` — an
 * `IContent` plus the page's own fields.
 *
 * @see ../../../../docs/system/system-content.md — the managed content model,
 *   the CRUD path through core, and how review state is decided.
 */

import type { ContentCurationState } from './ContentCurationState.js';

/**
 * The shared fields of one managed content item, as core stores them.
 * Extend this interface to describe a content type's full shape; every field
 * declared here is owned and written by core alone.
 */
export interface IContent {
    /**
     * Core-issued UUID. The single identifier for the item everywhere — the
     * author keys its own record by it, and curation, hooks, and admin routes
     * all address the item by it.
     */
    id: string;

    /** Namespaced content type id, for example `core:page`. */
    typeId: string;

    /** Id of the module or plugin that registered the content type. */
    providerId: string;

    /**
     * Review state of the working version. Absent when the item has never had
     * a reviewed field written by a non-curator, which includes every item of a
     * type that declares no reviewed fields. Absent content is served as-is.
     */
    curation?: ContentCurationState;

    /**
     * Whether a curator has approved some version of this item. While true,
     * public reads are served the approved version even when a newer edit is
     * pending or was rejected.
     */
    hasApprovedVersion: boolean;

    /**
     * Id of the curation queue item holding the pending edit for review.
     * Present only while `curation` is `pending`.
     */
    curationItemId?: string;

    /**
     * Id of the current review hold, issued by core before the edit enters
     * the curation queue and copied into the queue item's ref. More than one
     * queue item can end up open for the same item, so a decision is applied
     * only when its ref carries this id. Present only while `curation` is
     * `pending`.
     */
    holdId?: string;

    /** When the item was created. */
    createdAt: Date;

    /** Actor id that created the item. */
    createdBy: string;

    /** When the item was last changed through core. */
    updatedAt: Date;

    /** Actor id that last changed the item. */
    updatedBy: string;

    /**
     * When the item was soft-deleted. Deletion never removes the core row or
     * the author's record; it hides the item from every public read until an
     * admin restores it.
     */
    deletedAt?: Date;

    /** Actor id that soft-deleted the item. */
    deletedBy?: string;
}
