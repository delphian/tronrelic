/**
 * @file IManagedContentType.ts
 *
 * The contract a module or plugin implements to make a content type managed
 * by core. Every create, read, update, delete, and restore of a managed item
 * goes through the core content service first. Core runs the veto hooks,
 * records the operation, decides the review state, and only then calls the
 * same-named method here to do the storage work in the author's own collection.
 *
 * The methods on this interface are storage steps, not entry points. Calling
 * one directly skips the hooks, the audit, and curation, so nothing outside the
 * core content service should call them.
 *
 * Curation comes with the contract. A type lists the fields a curator must
 * review; core detects when a non-curator changes one of them and holds the
 * change in the central curation queue without the type implementing any
 * curation interface of its own.
 *
 * This extends `IContentType`, so a managed type is also an ordinary content
 * type: it appears in the content-type registry, and its `describe` renders
 * the item in the curation queue. `ref` passed to `describe` is `{ id }`.
 *
 * @see ../../../../docs/system/system-content.md — the CRUD path, the review
 *   rules, and the soft-delete requirement.
 */

import type { IContent } from './IContent.js';
import type { IContentActor } from './IContentActor.js';
import type { IContentClassification } from './IContentClassification.js';
import type { IContentReadRequest } from './IContentReadRequest.js';
import type { IContentType } from './IContentType.js';
import type { ContentPayload } from './ContentPayload.js';

/**
 * A content type whose items core manages.
 *
 * @template T - The full item shape: `IContent` plus the type's own fields.
 * @template TCreate - What a caller supplies to create an item.
 * @template TUpdate - What a caller supplies to change an item.
 */
export interface IManagedContentType<T extends IContent = IContent, TCreate = unknown, TUpdate = unknown>
    extends IContentType {
    /**
     * The widest exposure this type's content permits, in the governed
     * classification vocabulary. `audience: 'public'` is what makes a type
     * public; the curation picker never offers a sink whose reach exceeds this.
     */
    classification: IContentClassification;

    /**
     * The type's own fields a curator must review. When a non-curator's create
     * or update leaves any of these different, core holds the item for review.
     * An empty list means the type never enters curation.
     */
    reviewedFields: ReadonlyArray<Exclude<keyof T, keyof IContent> & string>;

    /**
     * Store a new item's type-specific record under the core-issued id. Throw a
     * descriptive Error to refuse invalid input; core then removes the base row
     * it wrote, so nothing is left behind.
     *
     * @param id - The core-issued content id the record must be keyed by.
     * @param input - The caller's creation input, validated here.
     * @param actor - Who is creating the item, for the author's own records.
     */
    create(id: string, input: TCreate, actor: IContentActor): Promise<void>;

    /**
     * Remove the record `create` just stored, because core could not finish
     * creating the item — for example, holding it for review failed. Without
     * this, a create that reported an error would leave a hidden record behind
     * that still holds its unique fields, so retrying the same create would
     * fail. This is not a purge: core calls it only for an item whose create is
     * still in progress, never for one a caller was told exists. Must succeed
     * when no record exists.
     *
     * @param id - The content id whose create is being abandoned.
     */
    discardCreate(id: string): Promise<void>;

    /**
     * Load a batch of items, each at the version core asks for. Omit an id
     * that has no record. An item asked for its `approved` version before any
     * version was approved is also omitted.
     *
     * @param requests - The ids to load and the version of each.
     * @returns The type-specific fields of each found item, keyed by id.
     */
    read(requests: ReadonlyArray<IContentReadRequest>): Promise<Record<string, ContentPayload<T>>>;

    /**
     * Apply a change to an item's working version. Never touch the approved
     * version here — only `approve` moves the working version into it, which is
     * what keeps an approved item live while the change waits for review.
     *
     * @param id - The content id to change.
     * @param patch - The caller's change, validated here.
     * @param actor - Who is making the change, for the author's own records.
     */
    update(id: string, patch: TUpdate, actor: IContentActor): Promise<void>;

    /**
     * Soft-delete the item's record by setting its `deletedAt`. Never remove
     * the record: a restore must be able to bring it back whole.
     *
     * @param id - The content id to soft-delete.
     * @param actor - Who is deleting the item.
     */
    delete(id: string, actor: IContentActor): Promise<void>;

    /**
     * Clear the record's `deletedAt` so the item is live again. Throw a
     * descriptive Error when the item cannot come back as it was (for example,
     * a unique field another item has taken since); core then leaves it deleted.
     *
     * @param id - The content id to restore.
     * @param actor - Who is restoring the item.
     */
    restore(id: string, actor: IContentActor): Promise<void>;

    /**
     * Copy the working version into the approved version. Core calls this when
     * a curator approves the item or writes a reviewed field themselves. Must be
     * safe to call again for the same working version.
     *
     * @param id - The content id whose working version was approved.
     */
    approve(id: string): Promise<void>;
}
