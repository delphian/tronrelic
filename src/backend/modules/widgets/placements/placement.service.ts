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
/**
 * Discriminator for the placement broadcast callback. Mirrors the
 * subset of events on `WidgetsPlacementsUpdatePayload` shipped over
 * the wire; `WidgetsModule` is responsible for translating these into
 * the socket payload via `WebSocketService`.
 */
export type PlacementBroadcastEvent =
    | 'placement:created'
    | 'placement:updated'
    | 'placement:deleted'
    | 'placement:restored';

/**
 * Callback invoked by the placement service after every successful
 * mutation. `WidgetsModule.init()` wires this to broadcast a refetch
 * signal over WebSocket so connected clients re-pull widget data.
 *
 * Errors thrown by the callback are caught inside the service so
 * placement writes never roll back on a broadcast failure.
 */
export type PlacementBroadcastCallback = (
    event: PlacementBroadcastEvent,
    placement: { id: string; zoneId?: string }
) => void;

export class PlacementService implements IPlacementService {
    private static instance: PlacementService;
    private readonly database: IDatabaseService;
    private readonly logger: ISystemLogService;
    private broadcast: PlacementBroadcastCallback | null = null;

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
     * Wire a broadcast callback the service invokes after every
     * successful create/update/delete/restore. `WidgetsModule.init()`
     * passes a closure that emits a `widgets:placements-update`
     * envelope through `WebSocketService`. Optional — when unset, the
     * service operates silently (useful for tests and for the legacy
     * unwired code path that predates the broadcast hook).
     *
     * @param callback - Function the service invokes post-write.
     */
    public setBroadcast(callback: PlacementBroadcastCallback | null): void {
        this.broadcast = callback;
    }

    /**
     * Internal helper that invokes the broadcast callback if one is
     * wired and swallows any thrown error. Broadcast failure must not
     * roll back the placement mutation that already succeeded.
     *
     * @param event - Mutation kind.
     * @param payload - Placement identifiers carried in the envelope.
     */
    private fireBroadcast(event: PlacementBroadcastEvent, payload: { id: string; zoneId?: string }): void {
        if (!this.broadcast) return;
        try {
            this.broadcast(event, payload);
        } catch (err) {
            this.logger.warn(
                {
                    err: err instanceof Error ? err.message : String(err),
                    event,
                    placementId: payload.id
                },
                'Placement broadcast callback threw — placement write succeeded but the notification was not delivered'
            );
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
        // Push the cheap filter into Mongo: empty `routes` matches
        // every path; an exact match of `route` matches that path;
        // a row whose `routes` contains any entry ending in `/*` or
        // `/**` is a candidate that must be re-checked in memory by
        // the matcher.
        //
        // The multikey index on `routes` keeps the equality and regex
        // arms cheap; the regex arm narrows on the suffix marker
        // before the in-memory filter runs. As placement counts grow
        // the worst-case pull is roughly "rows with empty routes" +
        // "rows containing a glob" + "rows containing the exact
        // route" — bounded by the count of routes-using rows and
        // never the full collection.
        const documents = await collection
            .find({
                enabled: true,
                $or: [
                    { routes: { $size: 0 } },
                    { routes: route },
                    { routes: { $regex: '\\*$' } }
                ]
            })
            .sort({ zoneId: 1, order: 1 })
            .toArray();

        // Pull-side filter: ensures glob patterns honour the matcher
        // rules (single-segment vs deep prefix, leading-slash, exact
        // form) instead of the broader Mongo `$regex` arm.
        const filtered = documents.filter(doc => routeMatches(doc.routes, route));

        return filtered.map(toPublic);
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

        const publicShape = toPublic(created);
        this.fireBroadcast('placement:created', { id: publicShape.id, zoneId: publicShape.zoneId });
        return publicShape;
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
        if (!updated) return null;

        const publicShape = toPublic(updated);
        this.fireBroadcast('placement:updated', { id: publicShape.id, zoneId: publicShape.zoneId });
        return publicShape;
    }

    async delete(id: string): Promise<boolean> {
        if (!ObjectId.isValid(id)) return false;
        const collection = this.database.getCollection<IWidgetPlacementDocument>(WIDGET_PLACEMENT_COLLECTION);
        const result = await collection.deleteOne({ _id: new ObjectId(id) });
        const removed = (result.deletedCount ?? 0) > 0;
        if (removed) {
            this.fireBroadcast('placement:deleted', { id });
        }
        return removed;
    }

    /**
     * Replace operator-editable fields on a plugin-source placement
     * with the plugin's original registration args, then re-enable
     * the row. Used by the admin "restore plugin defaults" endpoint.
     *
     * The controller is responsible for verifying the placement is
     * plugin-source and resolving the defaults from the legacy widget
     * service's cache before calling this method. The service only
     * applies the patch atomically and broadcasts the dedicated
     * `placement:restored` event so receivers can distinguish a
     * restore from a plain update.
     *
     * @param id - Placement id (stringified ObjectId).
     * @param defaults - Plugin defaults to apply. `instanceConfig` is
     *   not part of plugin registration args — it is operator state —
     *   so it is intentionally absent from the input. The row's
     *   existing `instanceConfig` survives restore.
     * @returns Updated placement, or null when no row matches.
     */
    async restoreToPluginDefaults(
        id: string,
        defaults: {
            zoneId: string;
            routes: ReadonlyArray<string>;
            order: number;
            title?: string;
        }
    ): Promise<IWidgetPlacement | null> {
        if (!ObjectId.isValid(id)) return null;

        const collection = this.database.getCollection<IWidgetPlacementDocument>(WIDGET_PLACEMENT_COLLECTION);
        const objectId = new ObjectId(id);
        const now = new Date();

        const setOps: Partial<IWidgetPlacementDocument> = {
            zoneId: defaults.zoneId,
            routes: [...defaults.routes],
            order: defaults.order,
            enabled: true,
            updatedAt: now
        };

        // `$unset` the optional title field when the plugin never set
        // one so the restored row matches a fresh plugin registration
        // exactly, not "plugin defaults plus operator title".
        const unsetOps: Record<string, ''> = {};
        if (defaults.title !== undefined) {
            setOps.title = defaults.title;
        } else {
            unsetOps.title = '';
        }

        const updateDoc: Record<string, unknown> = { $set: setOps };
        if (Object.keys(unsetOps).length > 0) {
            updateDoc.$unset = unsetOps;
        }

        const result = await collection.updateOne({ _id: objectId }, updateDoc);
        if (result.matchedCount === 0) return null;

        const updated = await collection.findOne({ _id: objectId });
        if (!updated) return null;

        const publicShape = toPublic(updated);
        this.fireBroadcast('placement:restored', { id: publicShape.id, zoneId: publicShape.zoneId });
        return publicShape;
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
