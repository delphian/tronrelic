/**
 * @fileoverview Widget placement service implementation.
 *
 * Singleton that owns the `module_widgets_placements` collection.
 * Plugin lifecycle invokes `ensurePluginPlacement` on enable and
 * `softDisableForPlugin` on disable; the placement resolver queries
 * `findByRoute` per SSR request; the admin API surface (forthcoming)
 * uses `create` / `update` / `delete` / `list`.
 *
 * Soft-disable semantics: plugin-source placements with `enabled:
 * false` remain in the database, preserving operator customisations
 * to `order` / `routes` / `title` across the plugin's
 * disable/re-enable cycle. Hard delete is reserved for operator
 * action via the admin API.
 *
 * @module backend/modules/widgets/placements/placement.service
 */

import { ObjectId } from 'mongodb';
import type {
    IDatabaseService,
    ISystemLogService,
    IPlacementService,
    IPlacementInput,
    IPlacementListFilter,
    IPlacementPatch,
    IPluginPlacementInput,
    IWidgetPlacement,
    PlacementSource
} from '@/types';
import type { IWidgetPlacementDocument } from '../database/IWidgetPlacementDocument.js';
import { WIDGET_PLACEMENT_COLLECTION } from '../database/IWidgetPlacementDocument.js';
import { routeMatches } from './route-matcher.js';

/**
 * Default `order` applied when input omits one. Matches the legacy
 * `WidgetService.register` behaviour (order defaulted to 100).
 */
const DEFAULT_ORDER = 100;

/**
 * Singleton placement service. Configured once during
 * `WidgetsModule.init()` via `setDependencies` and consumed by the
 * compat-shim widget service, the placement resolver, and the admin
 * API surface.
 */
export class PlacementService implements IPlacementService {
    private static instance: PlacementService;
    private readonly database: IDatabaseService;
    private readonly logger: ISystemLogService;

    private constructor(database: IDatabaseService, logger: ISystemLogService) {
        this.database = database;
        this.logger = logger;
    }

    /**
     * Configure the singleton's injected dependencies. Called once
     * during `WidgetsModule.init()` with the bootstrap-owned
     * `IDatabaseService` and the module-scoped logger.
     */
    public static setDependencies(database: IDatabaseService, logger: ISystemLogService): void {
        if (!PlacementService.instance) {
            PlacementService.instance = new PlacementService(database, logger);
        }
    }

    /**
     * Retrieve the configured singleton.
     *
     * @throws Error if `setDependencies` has not been called yet.
     */
    public static getInstance(): PlacementService {
        if (!PlacementService.instance) {
            throw new Error('PlacementService.setDependencies() must be called first');
        }
        return PlacementService.instance;
    }

    /**
     * Test-only reset to clear the singleton between unit tests so a
     * fresh injection can occur. Production never invokes this.
     */
    public static __resetForTests(): void {
        // @ts-expect-error — clearing the private static for tests
        PlacementService.instance = undefined;
    }

    async ensurePluginPlacement(input: IPluginPlacementInput): Promise<IWidgetPlacement> {
        if (!input.pluginId) {
            throw new Error('ensurePluginPlacement requires a pluginId');
        }

        const collection = this.database.getCollection<IWidgetPlacementDocument>(WIDGET_PLACEMENT_COLLECTION);
        const now = new Date();
        const filter = {
            typeId: input.typeId,
            pluginId: input.pluginId,
            source: 'plugin' as PlacementSource
        };

        // Find-then-(insert | re-enable). Atomicity is enforced by the
        // unique sparse index on (typeId, pluginId) created in
        // migration 001: a concurrent insert from a second process
        // would fail and we'd fall back to the update branch on
        // retry. In single-process tests there is no race; the
        // pattern reads cleanly under both the production Mongo
        // driver and the in-memory mock.
        const existing = await collection.findOne(filter);
        if (existing) {
            await collection.updateOne(
                { _id: existing._id },
                { $set: { enabled: true, updatedAt: now } }
            );
            const refreshed = await collection.findOne({ _id: existing._id });
            if (!refreshed) {
                throw new Error(
                    `ensurePluginPlacement: row vanished between update and reread for typeId='${input.typeId}', pluginId='${input.pluginId}'`
                );
            }
            this.logger.debug(
                { typeId: input.typeId, pluginId: input.pluginId, zoneId: input.zoneId },
                'Plugin placement re-enabled (existing row)'
            );
            return toPublic(refreshed);
        }

        const doc: Omit<IWidgetPlacementDocument, '_id'> = {
            typeId: input.typeId,
            zoneId: input.zoneId,
            routes: [...input.routes],
            order: input.order ?? DEFAULT_ORDER,
            enabled: true,
            source: 'plugin',
            pluginId: input.pluginId,
            createdAt: now,
            updatedAt: now
        };
        if (input.title !== undefined) doc.title = input.title;
        if (input.instanceConfig !== undefined) doc.instanceConfig = input.instanceConfig;

        const result = await collection.insertOne(doc as IWidgetPlacementDocument);
        const created = await collection.findOne({ _id: result.insertedId });
        if (!created) {
            throw new Error(
                `ensurePluginPlacement: insert succeeded but document could not be re-read for typeId='${input.typeId}', pluginId='${input.pluginId}'`
            );
        }

        this.logger.debug(
            { typeId: input.typeId, pluginId: input.pluginId, zoneId: input.zoneId },
            'Plugin placement created'
        );
        return toPublic(created);
    }

    async softDisableForPlugin(pluginId: string): Promise<number> {
        if (!pluginId) {
            throw new Error('softDisableForPlugin requires a pluginId');
        }

        const collection = this.database.getCollection<IWidgetPlacementDocument>(WIDGET_PLACEMENT_COLLECTION);
        const result = await collection.updateMany(
            { pluginId, source: 'plugin', enabled: true },
            { $set: { enabled: false, updatedAt: new Date() } }
        );

        const modified = result.modifiedCount ?? 0;
        if (modified > 0) {
            this.logger.info(
                { pluginId, modified },
                'Plugin placements soft-disabled'
            );
        }

        return modified;
    }

    async findByRoute(route: string): Promise<ReadonlyArray<IWidgetPlacement>> {
        const collection = this.database.getCollection<IWidgetPlacementDocument>(WIDGET_PLACEMENT_COLLECTION);
        // Fetch all enabled placements and filter route in-memory.
        // The route-match grammar today is exact-string-or-empty-
        // matches-all, which is awkward to express in a single
        // index-friendly Mongo query; in-memory filtering of an
        // `enabled: true` set is fast at the expected placement
        // counts and keeps the matching rule in one place
        // (`route-matcher.ts`).
        const documents = await collection
            .find({ enabled: true })
            .sort({ zoneId: 1, order: 1 })
            .toArray();

        const matches: IWidgetPlacement[] = [];
        for (const doc of documents) {
            if (routeMatches(doc.routes ?? [], route)) {
                matches.push(toPublic(doc));
            }
        }

        return matches;
    }

    async create(
        input: IPlacementInput,
        options: { source?: PlacementSource; pluginId?: string } = {}
    ): Promise<IWidgetPlacement> {
        const collection = this.database.getCollection<IWidgetPlacementDocument>(WIDGET_PLACEMENT_COLLECTION);
        const now = new Date();
        const source: PlacementSource = options.source ?? 'operator';

        if (source === 'plugin' && !options.pluginId) {
            throw new Error("Plugin-source placement requires options.pluginId");
        }

        const doc: Omit<IWidgetPlacementDocument, '_id'> = {
            typeId: input.typeId,
            zoneId: input.zoneId,
            routes: [...input.routes],
            order: input.order ?? DEFAULT_ORDER,
            enabled: input.enabled ?? true,
            source,
            createdAt: now,
            updatedAt: now
        };
        if (input.title !== undefined) doc.title = input.title;
        if (input.instanceConfig !== undefined) doc.instanceConfig = input.instanceConfig;
        if (options.pluginId !== undefined) doc.pluginId = options.pluginId;

        const result = await collection.insertOne(doc as IWidgetPlacementDocument);
        const created = await collection.findOne({ _id: result.insertedId });
        if (!created) {
            throw new Error('Placement create succeeded but document could not be re-read');
        }

        return toPublic(created);
    }

    async update(id: string, patch: IPlacementPatch): Promise<IWidgetPlacement | null> {
        if (!ObjectId.isValid(id)) return null;

        const collection = this.database.getCollection<IWidgetPlacementDocument>(WIDGET_PLACEMENT_COLLECTION);
        const setOps: Partial<IWidgetPlacementDocument> = { updatedAt: new Date() };
        if (patch.zoneId !== undefined) setOps.zoneId = patch.zoneId;
        if (patch.routes !== undefined) setOps.routes = [...patch.routes];
        if (patch.order !== undefined) setOps.order = patch.order;
        if (patch.title !== undefined) setOps.title = patch.title;
        if (patch.instanceConfig !== undefined) setOps.instanceConfig = patch.instanceConfig;
        if (patch.enabled !== undefined) setOps.enabled = patch.enabled;

        const objectId = new ObjectId(id);
        const result = await collection.updateOne({ _id: objectId }, { $set: setOps });
        if (result.matchedCount === 0) return null;

        const updated = await collection.findOne({ _id: objectId });
        return updated ? toPublic(updated) : null;
    }

    async delete(id: string): Promise<boolean> {
        if (!ObjectId.isValid(id)) return false;
        const collection = this.database.getCollection<IWidgetPlacementDocument>(WIDGET_PLACEMENT_COLLECTION);
        const result = await collection.deleteOne({ _id: new ObjectId(id) });
        return (result.deletedCount ?? 0) > 0;
    }

    async findById(id: string): Promise<IWidgetPlacement | null> {
        if (!ObjectId.isValid(id)) return null;
        const collection = this.database.getCollection<IWidgetPlacementDocument>(WIDGET_PLACEMENT_COLLECTION);
        const doc = await collection.findOne({ _id: new ObjectId(id) });
        return doc ? toPublic(doc) : null;
    }

    async list(filter: IPlacementListFilter = {}): Promise<ReadonlyArray<IWidgetPlacement>> {
        const collection = this.database.getCollection<IWidgetPlacementDocument>(WIDGET_PLACEMENT_COLLECTION);
        const query: Record<string, unknown> = {};
        if (filter.zoneId !== undefined) query.zoneId = filter.zoneId;
        if (filter.pluginId !== undefined) query.pluginId = filter.pluginId;
        if (filter.source !== undefined) query.source = filter.source;
        if (filter.enabledOnly) query.enabled = true;

        const docs = await collection
            .find(query)
            .sort({ zoneId: 1, order: 1 })
            .toArray();
        return docs.map(toPublic);
    }
}

/**
 * Convert a Mongo document to the public-facing `IWidgetPlacement`
 * shape (string id, ISO dates).
 */
function toPublic(doc: IWidgetPlacementDocument): IWidgetPlacement {
    return {
        id: doc._id.toHexString(),
        typeId: doc.typeId,
        zoneId: doc.zoneId,
        routes: doc.routes,
        order: doc.order,
        title: doc.title,
        instanceConfig: doc.instanceConfig,
        enabled: doc.enabled,
        source: doc.source,
        pluginId: doc.pluginId,
        createdAt: doc.createdAt.toISOString(),
        updatedAt: doc.updatedAt.toISOString()
    };
}
