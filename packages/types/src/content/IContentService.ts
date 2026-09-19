/**
 * @file IContentService.ts
 *
 * The core content service — the single entry point for every operation on
 * managed content, published on the service registry as `'content'`.
 *
 * Every write passes through here before it reaches the content author. The
 * service runs the `content.before*` veto hooks, records who acted and when on
 * the core content row, detects changes to reviewed fields, holds them in the
 * curation queue or approves them for a curator, and only then calls the
 * author's same-named storage method. Reads pass through here too: the service
 * decides which items a public reader may see and which version of each, so an
 * author never re-implements the visibility rules.
 *
 * Errors carry a `code` from `ContentErrorCode`.
 *
 * @see ../../../../docs/system/system-content.md — the managed content model.
 */

import type { IContent } from './IContent.js';
import type { IContentActor } from './IContentActor.js';
import type { IContentListQuery } from './IContentListQuery.js';
import type { IManagedContentType } from './IManagedContentType.js';
import type { ContentTypeDisposer } from './IContentRegistry.js';

/**
 * CRUD, review, and visibility for every managed content type.
 */
export interface IContentService {
    /**
     * Register a managed content type. Also makes the type reviewable in the
     * central curation queue, with no curation code in the type itself.
     *
     * @param type - The type contract, including its storage callbacks.
     * @param providerId - Id of the registering module or plugin.
     * @returns A disposer that unregisters the type; call it on plugin disable.
     */
    registerType<T extends IContent, TCreate, TUpdate>(
        type: IManagedContentType<T, TCreate, TUpdate>,
        providerId: string
    ): ContentTypeDisposer;

    /**
     * Create an item. Issues the id, writes the core row, runs the
     * `content.beforeCreate` hooks, and calls the type's `create`. A curator's
     * item is approved at once; anyone else's item with reviewed fields is held.
     *
     * @param typeId - The managed content type.
     * @param input - The type's creation input.
     * @param actor - Who is creating the item.
     * @returns The created item, working version.
     */
    create<T extends IContent>(typeId: string, input: unknown, actor: IContentActor): Promise<T>;

    /**
     * Change an item. Runs `content.beforeUpdate`, calls the type's `update`,
     * and compares the reviewed fields before and after to decide whether the
     * change needs review.
     *
     * @param typeId - The managed content type.
     * @param id - The content id.
     * @param patch - The type's change input.
     * @param actor - Who is making the change.
     * @returns The changed item, working version.
     */
    update<T extends IContent>(typeId: string, id: string, patch: unknown, actor: IContentActor): Promise<T>;

    /**
     * Soft-delete an item. Runs `content.beforeDelete`, then the type's
     * `delete`. Deletion is never held for review and never removes data.
     *
     * @param typeId - The managed content type.
     * @param id - The content id.
     * @param actor - Who is deleting the item.
     */
    delete(typeId: string, id: string, actor: IContentActor): Promise<void>;

    /**
     * Bring a soft-deleted item back. Runs `content.beforeRestore`, then the
     * type's `restore`.
     *
     * @param typeId - The managed content type.
     * @param id - The content id.
     * @param actor - Who is restoring the item.
     * @returns The restored item, working version.
     */
    restore<T extends IContent>(typeId: string, id: string, actor: IContentActor): Promise<T>;

    /**
     * Read items for a public reader. Omits deleted items, items never
     * approved that are pending or rejected, and ids with no record. Serves the
     * approved version of any item that has one under review, and the working
     * version of an item that never entered review.
     *
     * @param typeId - The managed content type.
     * @param ids - The content ids to read.
     * @returns The visible items, in the order of `ids`.
     */
    readPublic<T extends IContent>(typeId: string, ids: ReadonlyArray<string>): Promise<T[]>;

    /**
     * Read items for an admin view: any review state, deleted or not, always
     * the working version.
     *
     * @param typeId - The managed content type.
     * @param ids - The content ids to read.
     * @returns The found items, in the order of `ids`.
     */
    readAdmin<T extends IContent>(typeId: string, ids: ReadonlyArray<string>): Promise<T[]>;

    /**
     * Read only the core rows for a batch of ids, without calling the author.
     * For decorating an author-side list with review state.
     *
     * @param typeId - The managed content type.
     * @param ids - The content ids.
     * @returns The core rows found, keyed by id.
     */
    getEntries(typeId: string, ids: ReadonlyArray<string>): Promise<Record<string, IContent>>;

    /**
     * List core rows matching a review or deletion filter, newest first — the
     * "ask core first" half of a filtered listing.
     *
     * @param query - The type and filters.
     * @returns The matching core rows.
     */
    list(query: IContentListQuery): Promise<IContent[]>;

    /**
     * Count core rows matching a filter. `limit` and `skip` are ignored.
     *
     * @param query - The type and filters.
     * @returns The number of matching rows.
     */
    count(query: IContentListQuery): Promise<number>;
}
