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

        // Atomic upsert. `$set` applies on both insert and update so
        // `enabled` and `updatedAt` always reflect the current call.
        // `$setOnInsert` applies only on insert so operator
        // customisations to `order`, `routes`, `title`, and
        // `instanceConfig` survive plugin disable/re-enable cycles
        // (the existing row is found by filter and only `enabled` +
        // `updatedAt` are touched). The sparse unique index on
        // (typeId, pluginId) created in migration 001 guarantees
        // atomicity against concurrent enables from multiple
        // processes: the second writer's $setOnInsert is dropped
        // because the row already exists.
        const setOnInsert: Partial<IWidgetPlacementDocument> = {
            zoneId: input.zoneId,
            routes: [...input.routes],
            order: input.order ?? DEFAULT_ORDER,
            source: 'plugin',
            createdAt: now
        };
        if (input.title !== undefined) setOnInsert.title = input.title;
        if (input.instanceConfig !== undefined) setOnInsert.instanceConfig = input.instanceConfig;

        await collection.updateOne(
            filter,
            {
                $set: { enabled: true, updatedAt: now },
                $setOnInsert: setOnInsert
            },
            { upsert: true }
        );

        const document = await collection.findOne(filter);
        if (!document) {
            throw new Error(
                `ensurePluginPlacement: upsert succeeded but document could not be re-read for typeId='${input.typeId}', pluginId='${input.pluginId}'`
            );
        }

        this.logger.debug(
            { typeId: input.typeId, pluginId: input.pluginId, zoneId: input.zoneId },
            'Plugin placement ensured'
        );

        return toPublic(document);
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
        // Push the route filter into Mongo. Empty `routes` matches
        // every path; otherwise the exact path must appear in the
        // array. The multikey index on `routes` (built implicitly on
        // every array field) plus the compound
        // `enabled_zone_order` index from migration 001 keeps the
        // common SSR query cheap as placement counts grow. The
        // pure `routeMatches` predicate in `route-matcher.ts`
        // remains the canonical statement of the matching rule for
        // any non-Mongo caller and for future grammar extension.
        const documents = await collection
            .find({
                enabled: true,
                $or: [
                    { routes: { $size: 0 } },
                    { routes: route }
                ]
            })
            .sort({ zoneId: 1, order: 1 })
            .toArray();

        return documents.map(toPublic);
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
        if (source === 'operator' && options.pluginId !== undefined) {
            throw new Error(
                "Operator-source placement must not carry a pluginId — pluginId is only " +
                "meaningful when source='plugin', and the sparse unique index on " +
                "(typeId, pluginId) would collide with future plugin registrations."
            );
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
        if (source === 'plugin' && options.pluginId !== undefined) doc.pluginId = options.pluginId;

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
