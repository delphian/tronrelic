/**
 * @fileoverview The core content service — the single entry point for every
 * operation on managed content, published on the service registry as
 * `'content'`.
 *
 * Why it exists: before it, each content owner decided on its own what
 * "reviewed", "visible", and "deleted" meant, and wired curation by hand. Every
 * managed operation now passes through here first. The service runs the
 * `content.before*` veto hooks, records who acted and when on the core
 * `content_items` row, detects changes to the fields a type declares as
 * reviewed, holds them in the curation queue or approves them for a curator,
 * and only then calls the content author's same-named storage method. Public
 * reads pass through here as well, so the visibility rules live in one place.
 *
 * Storage is split on purpose. Core owns the shared `IContent` fields in its
 * own collection and never writes into an author's collection; the author owns
 * the type-specific fields and keeps two versions of them (working and
 * approved), so an approved item stays live while an edit waits for review.
 *
 * @see ../../../docs/system/system-content.md — the managed content model.
 * @module backend/services/content-service
 */

import { randomUUID } from 'node:crypto';
import type {
    ContentCurationState,
    ContentPayload,
    ContentTypeDisposer,
    IContent,
    IContentActor,
    IContentListQuery,
    IContentReadRequest,
    IContentService,
    IContentWriteContext,
    ICurationService,
    IDatabaseService,
    IHookRegistry,
    IManagedContentType,
    IServiceRegistry,
    ISystemLogService,
    HookDescriptor
} from '@/types';
import { isHookAbortError } from '@/types';
import { HOOKS } from '../hooks/registry.js';
import { assertValidClassification } from './content-classification.js';
import { createContentCurationType } from './content-curation-adapter.js';
import { ContentError } from './content-error.js';

/** Service-registry name the content service is published under. */
export const CONTENT_SERVICE = 'content';

/** Core-owned collection holding the shared fields of every managed item. */
export const CONTENT_COLLECTION = 'content_items';

/** Service-registry name of the curation queue the service holds changes in. */
const CURATION_SERVICE = 'curation';

/** Default and maximum page sizes for `list`. */
const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 500;

/**
 * A managed type stored with its owner. The type is widened to the base
 * `IContent` shape because the registry holds types of many different shapes;
 * each public method narrows its result back for the caller.
 */
interface IRegisteredManagedType {
    type: IManagedContentType<IContent, unknown, unknown>;
    providerId: string;
}

/**
 * Registry, write path, and read path for managed content. A singleton because
 * `IContentService` is a public API over shared state: configured once at
 * bootstrap and consumed by every content owner.
 */
export class ContentService implements IContentService {
    private static instance: ContentService | undefined;
    private readonly types = new Map<string, IRegisteredManagedType>();

    /**
     * @param database - Core database holding the `content_items` collection.
     * @param hookRegistry - Runs the `content.before*` veto hooks.
     * @param serviceRegistry - Resolves the curation service lazily, since
     *   curation initializes after this service is constructed.
     * @param logger - Scoped logger for registration and decision diagnostics.
     */
    private constructor(
        private readonly database: IDatabaseService,
        private readonly hookRegistry: IHookRegistry,
        private readonly serviceRegistry: IServiceRegistry,
        private readonly logger: ISystemLogService
    ) {}

    /**
     * Configure the singleton. The first call wins; later calls are ignored so
     * bootstrap cannot accidentally replace a service consumers already hold.
     *
     * @param database - Core database.
     * @param hookRegistry - Core hook registry.
     * @param serviceRegistry - Core service registry.
     * @param logger - Scoped logger.
     */
    public static setDependencies(
        database: IDatabaseService,
        hookRegistry: IHookRegistry,
        serviceRegistry: IServiceRegistry,
        logger: ISystemLogService
    ): void {
        if (!ContentService.instance) {
            ContentService.instance = new ContentService(database, hookRegistry, serviceRegistry, logger);
        }
    }

    /**
     * Return the configured singleton.
     *
     * @returns The content service.
     * @throws When `setDependencies` has not run yet.
     */
    public static getInstance(): ContentService {
        if (!ContentService.instance) {
            throw new Error('ContentService.setDependencies() must be called before getInstance()');
        }

        return ContentService.instance;
    }

    /**
     * Drop the singleton so each test builds a fresh service against its own
     * mocks.
     */
    public static resetForTests(): void {
        ContentService.instance = undefined;
    }

    /**
     * Create the indexes the read and list paths depend on. Called once at
     * bootstrap.
     *
     * @returns Resolves when every index exists.
     */
    async ensureIndexes(): Promise<void> {
        await this.database.createIndex(CONTENT_COLLECTION, { id: 1 }, { unique: true });
        await this.database.createIndex(CONTENT_COLLECTION, { typeId: 1, curation: 1, createdAt: -1 });
        await this.database.createIndex(CONTENT_COLLECTION, { typeId: 1, deletedAt: 1, createdAt: -1 });
    }

    // ------------------------------------------------------------ registration

    /**
     * Register a managed content type and make it reviewable in the curation
     * queue. Watches the curation service rather than resolving it once, so
     * the binding is made whenever curation becomes available.
     *
     * @param type - The type contract, including its storage callbacks.
     * @param providerId - Id of the registering module or plugin.
     * @returns A disposer that unregisters the type and its curation binding.
     * @throws When the type is malformed.
     */
    registerType<T extends IContent, TCreate, TUpdate>(
        type: IManagedContentType<T, TCreate, TUpdate>,
        providerId: string
    ): ContentTypeDisposer {
        this.assertValidType(type);
        const entry: IRegisteredManagedType = {
            type: type as unknown as IManagedContentType<IContent, unknown, unknown>,
            providerId
        };
        if (this.types.has(type.typeId)) {
            this.logger.warn({ typeId: type.typeId }, 'Managed content type re-registered; replacing prior registration');
        }
        this.types.set(type.typeId, entry);
        this.logger.info({ typeId: type.typeId, providerId }, 'Managed content type registered');

        const unwatch = this.serviceRegistry.watch<ICurationService>(CURATION_SERVICE, {
            /**
             * Bind the type into the curation queue each time curation appears.
             *
             * @param curation - The curation service that just became available.
             */
            onAvailable: (curation) => this.bindCuration(curation, entry)
        });

        /**
         * Undo this exact registration: stop watching curation, and drop the
         * type and its curation binding unless a later registration of the same
         * id has already replaced them.
         */
        return () => {
            unwatch();
            if (this.types.get(type.typeId) === entry) {
                this.types.delete(type.typeId);
                this.serviceRegistry.get<ICurationService>(CURATION_SERVICE)?.unregisterType(type.typeId);
                this.logger.info({ typeId: type.typeId }, 'Managed content type unregistered');
            }
        };
    }

    // ------------------------------------------------------------------ writes

    /**
     * Create an item: issue the id, run the veto hooks, write the core row, and
     * call the author. If the author refuses, or approving or holding the new
     * item fails, both records are removed again, so a failed create leaves
     * nothing behind and a retry does not collide with its own leftovers.
     *
     * @param typeId - The managed content type.
     * @param input - The type's creation input.
     * @param actor - Who is creating the item.
     * @returns The created item, working version.
     */
    async create<T extends IContent>(typeId: string, input: unknown, actor: IContentActor): Promise<T> {
        const entry = this.requireType(typeId);
        const id = randomUUID();
        await this.runVeto(HOOKS.content.beforeCreate, { operation: 'create', typeId, id, actor, input });

        const reviewed = entry.type.reviewedFields.length > 0;
        // Refuse before writing anything when the item would need review but
        // there is no queue to hold it in — never create it unreviewed.
        const curation = reviewed && !actor.isCurator ? this.requireCuration() : undefined;

        const now = new Date();
        // An item that will be held starts out `pending`, so public readers
        // never see it between the author's write and the hold — and still
        // don't if the hold fails.
        const row: IContent = {
            id,
            typeId,
            providerId: entry.providerId,
            hasApprovedVersion: false,
            ...(curation ? { curation: 'pending' as const } : {}),
            createdAt: now,
            createdBy: actor.id,
            updatedAt: now,
            updatedBy: actor.id
        };
        await this.collection().insertOne({ ...row });
        try {
            await entry.type.create(id, input, actor);
        } catch (error) {
            await this.collection().deleteOne({ id });
            throw error;
        }

        try {
            if (reviewed && actor.isCurator) {
                await this.markApproved(entry, id);
            } else if (curation) {
                await this.holdForReview(curation, entry, id, actor);
            }
        } catch (error) {
            await this.discardCreate(entry, id);
            throw error;
        }
        this.logger.info({ typeId, id, actor: actor.id }, 'Managed content created');

        return this.readOneAdmin<T>(entry, id);
    }

    /**
     * Change an item, then compare its reviewed fields before and after. A
     * curator's reviewed change is approved at once (closing any open queue
     * item as approved by that curator); anyone else's is held for review.
     * An item left `pending` with no open queue item is treated the same way
     * even when no reviewed field changed, since nothing else can decide it.
     *
     * @param typeId - The managed content type.
     * @param id - The content id.
     * @param patch - The type's change input.
     * @param actor - Who is making the change.
     * @returns The changed item, working version.
     */
    async update<T extends IContent>(typeId: string, id: string, patch: unknown, actor: IContentActor): Promise<T> {
        const entry = this.requireType(typeId);
        const row = await this.requireLiveRow(typeId, id);
        await this.runVeto(HOOKS.content.beforeUpdate, { operation: 'update', typeId, id, actor, input: patch });

        const reviewed = entry.type.reviewedFields.length > 0;
        const curation = reviewed && !actor.isCurator ? this.requireCuration() : undefined;
        const before = reviewed ? await this.readPayload(entry, id, 'working') : undefined;

        // A never-reviewed item is served at its working version, so a change
        // that may need review must hide it before the author writes, not after.
        const hiddenForWrite = curation !== undefined && row.curation === undefined;
        if (hiddenForWrite) {
            await this.collection().updateOne({ id, curation: { $exists: false } }, { $set: { curation: 'pending' } });
        }
        try {
            await entry.type.update(id, patch, actor);
        } catch (error) {
            if (hiddenForWrite) {
                await this.unhideUnheld(id);
            }
            throw error;
        }
        await this.collection().updateOne({ id }, { $set: { updatedAt: new Date(), updatedBy: actor.id } });

        if (reviewed) {
            const after = await this.readPayload(entry, id, 'working');
            // A pending item with no open queue item has nothing a curator can
            // decide: its hold failed, or its queue item closed without
            // promoting it. Any save of it needs a decision, or it stays stuck.
            const orphaned = row.curation === 'pending' && !row.curationItemId;
            if (orphaned || this.reviewedFieldsChanged(entry, before, after)) {
                if (actor.isCurator) {
                    await this.approveByCurator(entry, id, actor);
                } else if (curation) {
                    await this.holdForReview(curation, entry, id, actor);
                }
            } else if (hiddenForWrite) {
                await this.unhideUnheld(id);
            }
        }
        this.logger.info({ typeId, id, actor: actor.id }, 'Managed content updated');

        return this.readOneAdmin<T>(entry, id);
    }

    /**
     * Soft-delete an item. Never held for review and never removes data: the
     * author marks its record deleted and core marks the row deleted.
     *
     * @param typeId - The managed content type.
     * @param id - The content id.
     * @param actor - Who is deleting the item.
     */
    async delete(typeId: string, id: string, actor: IContentActor): Promise<void> {
        const entry = this.requireType(typeId);
        const row = await this.requireLiveRow(typeId, id);
        await this.runVeto(HOOKS.content.beforeDelete, { operation: 'delete', typeId, id, actor });

        // Hide the item from public readers before the author runs, so a read
        // landing between the two writes cannot re-cache the item the author's
        // delete just dropped from its caches.
        const now = new Date();
        await this.collection().updateOne(
            { id },
            { $set: { deletedAt: now, deletedBy: actor.id, updatedAt: now, updatedBy: actor.id } }
        );
        try {
            await entry.type.delete(id, actor);
        } catch (error) {
            await this.collection().updateOne(
                { id },
                {
                    $set: { updatedAt: row.updatedAt, updatedBy: row.updatedBy },
                    $unset: { deletedAt: '', deletedBy: '' }
                }
            );
            throw error;
        }
        this.logger.info({ typeId, id, actor: actor.id }, 'Managed content soft-deleted');

        return;
    }

    /**
     * Bring a soft-deleted item back. The author may refuse (for example when
     * a unique field was taken while the item was deleted), in which case the
     * item stays deleted.
     *
     * @param typeId - The managed content type.
     * @param id - The content id.
     * @param actor - Who is restoring the item.
     * @returns The restored item, working version.
     */
    async restore<T extends IContent>(typeId: string, id: string, actor: IContentActor): Promise<T> {
        const entry = this.requireType(typeId);
        const row = await this.findRow(typeId, id);
        if (!row) {
            throw new ContentError('not-found', `No ${entry.type.label} with id ${id}`);
        }
        if (!row.deletedAt) {
            throw new ContentError('not-deleted', `${entry.type.label} ${id} is not deleted`);
        }
        await this.runVeto(HOOKS.content.beforeRestore, { operation: 'restore', typeId, id, actor });

        await entry.type.restore(id, actor);
        await this.collection().updateOne(
            { id },
            {
                $set: { updatedAt: new Date(), updatedBy: actor.id },
                $unset: { deletedAt: '', deletedBy: '' }
            }
        );
        this.logger.info({ typeId, id, actor: actor.id }, 'Managed content restored');

        return this.readOneAdmin<T>(entry, id);
    }

    /**
     * Record a curator's decision on an item and, on approval, ask the author
     * to promote the working version. Called by the curation adapter when the
     * queue commits a decision. A decision for an item that no longer exists
     * is logged and ignored, because the queue treats a repeated or stale
     * commit as benign.
     *
     * A decision is applied only when the queue item's `holdId` matches the
     * row's. Two queue items can be open for the same content: two saves can
     * both hold before either records its queue item, and a curator's save
     * approves the row directly when the open item cannot be approved through
     * curation. Acting on the older item would promote or reject whatever the
     * working version holds now, which is not what that item was opened for.
     * A stale approval throws `superseded`, for the same reason a deleted one
     * does; a stale rejection changes nothing and is only logged.
     *
     * Approving a soft-deleted item is refused. Deletion leaves the queue item
     * open, and approving it would promote an edit nobody can see and fire
     * `content.published` for content that is not live. The throw fails the
     * queue's commit, which stops that hook and tells the curator why. The
     * row keeps `pending` but drops the closed hold, so the first save after
     * a restore holds the item again or, from a curator, approves it.
     *
     * An approval whose promotion fails drops the hold the same way. The
     * queue records a decision before committing it, so that queue item is
     * closed even though nothing was published.
     *
     * @param typeId - The managed content type.
     * @param ref - The queue item's ref, `{ id, holdId }`, identifying the
     *   content and the hold the decision was made on.
     * @param decision - The curator's decision.
     * @throws ContentError `superseded` when approving an item that is no
     *   longer the current hold, or `deleted` when approving a soft-deleted item.
     */
    async applyDecision(
        typeId: string,
        ref: Record<string, unknown>,
        decision: Exclude<ContentCurationState, 'pending'>
    ): Promise<void> {
        const entry = this.requireType(typeId);
        const id = String(ref.id ?? '');
        const holdId = typeof ref.holdId === 'string' ? ref.holdId : undefined;
        const row = await this.findRow(typeId, id);
        if (!row) {
            this.logger.warn({ typeId, id, decision }, 'Curation decision for missing managed content ignored');
        } else if (row.holdId !== holdId) {
            this.logger.warn({ typeId, id, decision, holdId, currentHoldId: row.holdId }, 'Curation decision on a superseded hold ignored');
            if (decision === 'approved') {
                throw new ContentError(
                    'superseded',
                    `This review item no longer holds the current edit of ${entry.type.label} ${id}; nothing was published`
                );
            }
        } else if (decision === 'approved' && row.deletedAt) {
            await this.collection().updateOne({ id }, { $unset: { curationItemId: '', holdId: '' } });
            throw new ContentError('deleted', `${entry.type.label} ${id} was deleted; restore it before approving its edit`);
        } else if (decision === 'approved') {
            try {
                await this.markApproved(entry, id);
            } catch (error) {
                // The queue has already recorded this item as decided, so it
                // can never be decided again. Drop the hold so the row stops
                // pointing at it and the next save opens a fresh one.
                await this.collection().updateOne({ id, holdId }, { $unset: { curationItemId: '', holdId: '' } });
                throw error;
            }
            this.logger.info({ typeId, id }, 'Managed content approved by curator');
        } else {
            await this.collection().updateOne(
                { id },
                { $set: { curation: 'rejected' }, $unset: { curationItemId: '', holdId: '' } }
            );
            this.logger.info({ typeId, id }, 'Managed content rejected by curator');
        }

        return;
    }

    // ------------------------------------------------------------------- reads

    /**
     * Read items for a public reader. Omits deleted items and items that are
     * under review with no approved version; serves the approved version of an
     * item under review and the working version of an item never reviewed.
     *
     * @param typeId - The managed content type.
     * @param ids - The content ids to read.
     * @returns The visible items, in the order of `ids`.
     */
    async readPublic<T extends IContent>(typeId: string, ids: ReadonlyArray<string>): Promise<T[]> {
        const entry = this.requireType(typeId);
        const rows = await this.findRows(typeId, ids, { deletedAt: { $exists: false } });
        const requests: IContentReadRequest[] = [];
        for (const row of rows.values()) {
            if (row.curation === undefined) {
                requests.push({ id: row.id, version: 'working' });
            } else if (row.hasApprovedVersion) {
                requests.push({ id: row.id, version: 'approved' });
            }
        }

        return this.mergeRead<T>(entry, ids, rows, requests);
    }

    /**
     * Read items for an admin view: every review state, deleted or not, always
     * the working version.
     *
     * @param typeId - The managed content type.
     * @param ids - The content ids to read.
     * @returns The found items, in the order of `ids`.
     */
    async readAdmin<T extends IContent>(typeId: string, ids: ReadonlyArray<string>): Promise<T[]> {
        const entry = this.requireType(typeId);
        const rows = await this.findRows(typeId, ids, {});
        const requests: IContentReadRequest[] = Array.from(rows.keys()).map((id) => ({ id, version: 'working' }));

        return this.mergeRead<T>(entry, ids, rows, requests);
    }

    /**
     * Read only core rows, without calling the author — for decorating an
     * author-side list with review state.
     *
     * @param typeId - The managed content type.
     * @param ids - The content ids.
     * @returns The core rows found, keyed by id.
     */
    async getEntries(typeId: string, ids: ReadonlyArray<string>): Promise<Record<string, IContent>> {
        const rows = await this.findRows(typeId, ids, {});

        return Object.fromEntries(rows);
    }

    /**
     * List core rows matching a review or deletion filter, newest first.
     * The `id` tie-breaker keeps the order fixed between calls, so a caller
     * paging with `skip` neither repeats nor misses rows that share a
     * `createdAt`, as rows written by an adoption migration can.
     *
     * @param query - The type and filters.
     * @returns The matching core rows.
     */
    async list(query: IContentListQuery): Promise<IContent[]> {
        const limit = Math.min(Math.max(1, query.limit ?? DEFAULT_LIST_LIMIT), MAX_LIST_LIMIT);
        const skip = Math.max(0, query.skip ?? 0);
        const rows = await this.collection()
            .find(this.buildListFilter(query), { projection: { _id: 0 } })
            .sort({ createdAt: -1, id: -1 })
            .skip(skip)
            .limit(limit)
            .toArray();

        return rows as IContent[];
    }

    /**
     * Count core rows matching a filter.
     *
     * @param query - The type and filters; paging fields are ignored.
     * @returns The number of matching rows.
     */
    async count(query: IContentListQuery): Promise<number> {
        return this.collection().countDocuments(this.buildListFilter(query));
    }

    // ---------------------------------------------------------------- internals

    /**
     * The typed handle on the core content collection.
     *
     * @returns The raw `content_items` collection.
     */
    private collection() {
        return this.database.getCollection<IContent>(CONTENT_COLLECTION);
    }

    /**
     * Reject a malformed type at registration so a broken author fails at
     * boot, not on the first write.
     *
     * @param type - The type being registered.
     * @throws Error naming the first problem found.
     */
    private assertValidType<T extends IContent, TCreate, TUpdate>(type: IManagedContentType<T, TCreate, TUpdate>): void {
        if (typeof type.typeId !== 'string' || !type.typeId.includes(':')) {
            throw new Error(`Managed content type id '${String(type.typeId)}' must be namespaced as <provider>:<name>`);
        }
        assertValidClassification(type.classification, `managed content type '${type.typeId}' classification`);
        if (!Array.isArray(type.reviewedFields)) {
            throw new Error(`Managed content type '${type.typeId}' must declare reviewedFields as an array`);
        }
        const methods = ['describe', 'create', 'discardCreate', 'read', 'update', 'delete', 'restore', 'approve'] as const;
        for (const method of methods) {
            if (typeof type[method] !== 'function') {
                throw new Error(`Managed content type '${type.typeId}' must implement ${method}()`);
            }
        }

        return;
    }

    /**
     * Register the generated curation binding for a managed type. Runs on every
     * (re)appearance of the curation service, so it must stay idempotent —
     * curation replaces a binding registered under the same id.
     *
     * @param curation - The live curation service.
     * @param entry - The managed type to bind.
     */
    private bindCuration(curation: ICurationService, entry: IRegisteredManagedType): void {
        const typeId = entry.type.typeId;
        /**
         * Route a queue decision on this type back into the content service.
         *
         * @param ref - The queue item's ref, naming the content and its hold.
         * @param decision - The curator's approve or reject.
         * @returns Resolves once the decision is recorded.
         */
        const onDecision = (
            ref: Record<string, unknown>,
            decision: Exclude<ContentCurationState, 'pending'>
        ): Promise<void> => this.applyDecision(typeId, ref, decision);
        curation.registerType(createContentCurationType(entry.type, onDecision), entry.providerId);

        return;
    }

    /**
     * Resolve a registered managed type.
     *
     * @param typeId - The managed content type id.
     * @returns The registration.
     * @throws ContentError `unknown-type` when none is registered.
     */
    private requireType(typeId: string): IRegisteredManagedType {
        const entry = this.types.get(typeId);
        if (!entry) {
            throw new ContentError('unknown-type', `No managed content type registered for '${typeId}'`);
        }

        return entry;
    }

    /**
     * Resolve the curation service for a change that needs review.
     *
     * @returns The live curation service.
     * @throws ContentError `curation-unavailable` when it is not running, so
     *   the change is refused rather than written unreviewed.
     */
    private requireCuration(): ICurationService {
        const curation = this.serviceRegistry.get<ICurationService>(CURATION_SERVICE);
        if (!curation) {
            throw new ContentError(
                'curation-unavailable',
                'This change needs curator review, but the curation service is not available.'
            );
        }

        return curation;
    }

    /**
     * Load one core row.
     *
     * @param typeId - The managed content type the row must belong to.
     * @param id - The content id.
     * @returns The row, or null when none matches.
     */
    private async findRow(typeId: string, id: string): Promise<IContent | null> {
        const row = await this.collection().findOne({ id: String(id), typeId }, { projection: { _id: 0 } });

        return row as IContent | null;
    }

    /**
     * Load a live (not deleted) core row for a write.
     *
     * @param typeId - The managed content type.
     * @param id - The content id.
     * @returns The row.
     * @throws ContentError `not-found` or `deleted`.
     */
    private async requireLiveRow(typeId: string, id: string): Promise<IContent> {
        const row = await this.findRow(typeId, id);
        if (!row) {
            throw new ContentError('not-found', `No content with id ${id} for type '${typeId}'`);
        }
        if (row.deletedAt) {
            throw new ContentError('deleted', `Content ${id} is deleted; restore it before changing it`);
        }

        return row;
    }

    /**
     * Load a batch of core rows keyed by id.
     *
     * @param typeId - The managed content type.
     * @param ids - The content ids.
     * @param extra - Additional filter conditions, such as excluding deleted rows.
     * @returns The found rows, keyed by id.
     */
    private async findRows(
        typeId: string,
        ids: ReadonlyArray<string>,
        extra: Record<string, unknown>
    ): Promise<Map<string, IContent>> {
        const unique = Array.from(new Set(ids.map((id) => String(id))));
        const rows = unique.length === 0
            ? []
            : await this.collection()
                .find({ typeId, id: { $in: unique }, ...extra }, { projection: { _id: 0 } })
                .toArray();

        return new Map((rows as IContent[]).map((row) => [row.id, row]));
    }

    /**
     * Ask the author for the requested versions and merge each onto its core
     * row. The core row is spread last so an author can never override a
     * shared field.
     *
     * @param entry - The managed type.
     * @param order - The caller's ids, fixing the result order.
     * @param rows - The core rows, keyed by id.
     * @param requests - Which items to load and at which version.
     * @returns The merged items, in the order of `order`, omitting any the
     *   author did not return.
     */
    private async mergeRead<T extends IContent>(
        entry: IRegisteredManagedType,
        order: ReadonlyArray<string>,
        rows: Map<string, IContent>,
        requests: IContentReadRequest[]
    ): Promise<T[]> {
        const payloads = requests.length > 0 ? await entry.type.read(requests) : {};
        const merged: T[] = [];
        const seen = new Set<string>();
        for (const rawId of order) {
            const id = String(rawId);
            const row = rows.get(id);
            const payload = payloads[id];
            if (row && payload && !seen.has(id)) {
                seen.add(id);
                merged.push({ ...payload, ...row } as unknown as T);
            }
        }

        return merged;
    }

    /**
     * Read one item for the admin view, used to return the result of a write.
     *
     * @param entry - The managed type.
     * @param id - The content id.
     * @returns The item, working version.
     * @throws ContentError `not-found` when the author has no record for it.
     */
    private async readOneAdmin<T extends IContent>(entry: IRegisteredManagedType, id: string): Promise<T> {
        const [item] = await this.readAdmin<T>(entry.type.typeId, [id]);
        if (!item) {
            throw new ContentError('not-found', `${entry.type.label} ${id} has no stored record`);
        }

        return item;
    }

    /**
     * Load one item's type-specific fields at a version, for comparing
     * reviewed fields around a write.
     *
     * @param entry - The managed type.
     * @param id - The content id.
     * @param version - The version to load.
     * @returns The payload, or undefined when the author has none.
     */
    private async readPayload(
        entry: IRegisteredManagedType,
        id: string,
        version: IContentReadRequest['version']
    ): Promise<ContentPayload<IContent> | undefined> {
        const payloads = await entry.type.read([{ id, version }]);

        return payloads[id];
    }

    /**
     * Whether any reviewed field differs between two loads of the same item.
     * Values are compared by their JSON form, which treats arrays, nested
     * objects, and dates by content rather than by reference.
     *
     * @param entry - The managed type, supplying the reviewed field list.
     * @param before - The item before the write.
     * @param after - The item after the write.
     * @returns True when at least one reviewed field changed.
     */
    private reviewedFieldsChanged(
        entry: IRegisteredManagedType,
        before: ContentPayload<IContent> | undefined,
        after: ContentPayload<IContent> | undefined
    ): boolean {
        const beforeRecord = (before ?? {}) as Record<string, unknown>;
        const afterRecord = (after ?? {}) as Record<string, unknown>;

        return entry.type.reviewedFields.some(
            (field) => JSON.stringify(beforeRecord[field]) !== JSON.stringify(afterRecord[field])
        );
    }

    /**
     * Put an item's working version into review. Marks the row `pending`
     * before holding it, so if the hold fails the item is still treated as
     * unreviewed (public readers keep the approved version) and the next write
     * retries the hold. An item already waiting in the queue is not held twice:
     * the queue renders the working version live, so the open item already
     * shows the new change.
     *
     * Each hold gets a fresh `holdId`, written to the row before the queue
     * item exists and carried in the item's ref. Two concurrent saves can both
     * get past the check above and open two queue items; only the one whose
     * `holdId` is still on the row can decide the content.
     *
     * @param curation - The live curation service.
     * @param entry - The managed type.
     * @param id - The content id.
     * @param actor - Who made the change, recorded as the queue item's source.
     */
    private async holdForReview(
        curation: ICurationService,
        entry: IRegisteredManagedType,
        id: string,
        actor: IContentActor
    ): Promise<void> {
        const row = await this.findRow(entry.type.typeId, id);
        if (row?.curation === 'pending' && row.curationItemId) {
            return;
        }
        const holdId = randomUUID();
        await this.collection().updateOne(
            { id },
            { $set: { curation: 'pending', holdId }, $unset: { curationItemId: '' } }
        );
        const item = await curation.hold({ typeId: entry.type.typeId, ref: { id, holdId }, source: actor.id });
        // A policy bypass may approve the item inside hold(), in which case the
        // decision has already been applied and cleared the hold. A concurrent
        // save may also have replaced it. Either way the filter no longer
        // matches, so only the current hold records its queue item.
        if (item.status === 'pending') {
            await this.collection().updateOne({ id, holdId }, { $set: { curationItemId: item.id } });
        }
        this.logger.info({ typeId: entry.type.typeId, id, curationItemId: item.id }, 'Managed content held for review');

        return;
    }

    /**
     * Undo a create that failed after the author stored its record, so the
     * caller's error is true: no item exists. The author's record goes first,
     * because it holds the unique fields a retry needs. A failure here is
     * logged rather than thrown, so the caller still sees the error that
     * actually stopped the create. The item is then left in place, and the
     * next save of it gets a decision, since `update` treats a `pending` row
     * with no open queue item as needing one.
     *
     * @param entry - The managed type whose create is being abandoned.
     * @param id - The content id issued for that create.
     */
    private async discardCreate(entry: IRegisteredManagedType, id: string): Promise<void> {
        try {
            await entry.type.discardCreate(id);
            await this.collection().deleteOne({ id });
        } catch (error) {
            this.logger.error({ error, typeId: entry.type.typeId, id }, 'Failed to discard a managed content create; the item is left in place');
        }

        return;
    }

    /**
     * Return a never-reviewed item to having no review state after `update`
     * hid it for a write that turned out not to need review, or that failed.
     * The filter only matches a row still `pending` with no hold started, so
     * it never undoes a hold or a decision that landed in between.
     *
     * @param id - The content id `update` hid.
     */
    private async unhideUnheld(id: string): Promise<void> {
        await this.collection().updateOne(
            { id, curation: 'pending', holdId: { $exists: false } },
            { $unset: { curation: '' } }
        );

        return;
    }

    /**
     * Approve a curator's reviewed change. When a queue item is open, approve
     * it through curation so the queue history records the curator's decision;
     * otherwise record the approval directly.
     *
     * @param entry - The managed type.
     * @param id - The content id.
     * @param actor - The curator, recorded as the decider.
     */
    private async approveByCurator(entry: IRegisteredManagedType, id: string, actor: IContentActor): Promise<void> {
        const row = await this.findRow(entry.type.typeId, id);
        const curation = this.serviceRegistry.get<ICurationService>(CURATION_SERVICE);
        let decided = false;
        if (row?.curation === 'pending' && row.curationItemId && curation) {
            // approve() commits through the adapter, which calls applyDecision.
            decided = (await curation.approve(row.curationItemId, actor.id)) !== null;
        }
        if (!decided) {
            await this.markApproved(entry, id);
        }

        return;
    }

    /**
     * Promote the working version to approved and record it on the row.
     * Clearing the hold means any queue item still open for the item, such as
     * one a curator's direct approval could not close, can no longer decide it.
     *
     * @param entry - The managed type.
     * @param id - The content id.
     */
    private async markApproved(entry: IRegisteredManagedType, id: string): Promise<void> {
        await entry.type.approve(id);
        await this.collection().updateOne(
            { id },
            {
                $set: { curation: 'approved', hasApprovedVersion: true },
                $unset: { curationItemId: '', holdId: '' }
            }
        );

        return;
    }

    /**
     * Run one of the `content.before*` veto hooks, translating a handler's
     * `HookAbortError` into a `vetoed` refusal.
     *
     * @param descriptor - The hook to run.
     * @param context - What is about to happen.
     * @throws ContentError `vetoed` when a handler aborts.
     */
    private async runVeto(
        descriptor: HookDescriptor<IContentWriteContext, void, 'series'>,
        context: IContentWriteContext
    ): Promise<void> {
        try {
            await this.hookRegistry.invoke(descriptor, context);
        } catch (error) {
            if (isHookAbortError(error)) {
                throw new ContentError('vetoed', error.message || `A content hook refused the ${context.operation}`);
            }
            throw error;
        }

        return;
    }

    /**
     * Translate a list query into a Mongo filter.
     *
     * @param query - The type and filters.
     * @returns The filter document.
     */
    private buildListFilter(query: IContentListQuery): Record<string, unknown> {
        const filter: Record<string, unknown> = {
            typeId: query.typeId,
            deletedAt: { $exists: query.deleted === true }
        };
        if (query.curation === 'none') {
            filter.curation = { $exists: false };
        } else if (query.curation !== undefined) {
            filter.curation = query.curation;
        }

        return filter;
    }
}
