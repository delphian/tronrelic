/**
 * @fileoverview Unified widgets service implementation.
 *
 * `WidgetsService` is the single public surface for every widget
 * operation. It composes the internal zone registry, widget-type
 * registry, placement service, and SSR resolver — none of which are
 * exposed outside this module. Consumers (plugins, core modules,
 * admin controllers, the SSR router) reach this service through the
 * `'widgets'` entry on the service registry.
 *
 * Identity is trust-based — the caller passes `ownerId` and the
 * service trusts it. This matches every other service on the registry
 * and is consistent with the existing trust model: nothing inspects
 * who called a service method; trust is enforced at import time and
 * by the plugin loader.
 *
 * Singleton lifecycle. `WidgetsModule.init()` calls
 * `WidgetsService.setDependencies(...)` once during bootstrap with the
 * concrete internal collaborators; `getInstance()` returns the same
 * instance to every caller. The setter is idempotent (subsequent calls
 * are a no-op) and `getInstance()` throws when `setDependencies` has
 * not been called yet — matches the `PageService` / `MenuService`
 * pattern documented in
 * {@link ../../../../docs/system/modules/modules-architecture.md}.
 *
 * @module backend/modules/widgets/widgets.service
 */

import type { JSONSchema7 } from 'json-schema';
import type {
    ISystemLogService,
    IWidgetsService,
    IRegisterWidgetTypeInput,
    IRegisterZoneInput,
    IRegisterWidgetInput,
    WidgetsRegistrationDisposer,
    IZoneSnapshot,
    IWidgetTypeSnapshot,
    IWidgetData,
    IWidgetPlacement,
    IPlacementInput,
    IPlacementListFilter,
    IPlacementPatch,
    IZoneRegistry,
    IWidgetTypeRegistry,
    IPlacementService,
    IZoneLayoutConfig
} from '@/types';
import type { PlacementResolver } from './placements/placement-resolver.js';
import type { WidgetRouteCache } from './placements/WidgetRouteCache.js';
import { ZoneLayoutService } from './zones/zone-layout.service.js';
import { defineZone } from './zones/define-zone.js';
import { defineWidgetType } from './widget-types/define-widget-type.js';
import { LAYOUT_GROUP_TYPE_ID } from './widget-types/core-widget-types.js';
import {
    InvalidParentPlacementError,
    MissingPluginDefaultsError,
    PluginPlacementDeletionForbiddenError,
    RestoreDefaultsOnOperatorRowError,
    RouteFilterOnNestedPlacementError,
    UnknownWidgetTypeError,
    UnknownZoneError,
    WidgetTypeOwnerConflictError
} from './widgets.errors.js';

/** Reserved owner id for core-declared zones and types. */
const CORE_OWNER = 'core';

/** Default placement order when input omits one. */
const DEFAULT_ORDER = 100;

/**
 * Snapshot of the parameters a plugin originally passed to
 * `registerWidget`. Cached for the process lifetime so the
 * `restorePluginDefaults` admin endpoint can revert operator changes
 * back to the plugin's stated defaults without consulting the plugin
 * itself.
 */
interface IPluginRegistrationDefaults {
    readonly ownerId: string;
    readonly typeId: string;
    readonly zoneId: string;
    readonly routes: ReadonlyArray<string>;
    readonly order: number;
    readonly title?: string;
}

/**
 * Concrete `IWidgetsService` implementation.
 *
 * Instantiated once during `WidgetsModule.init()` via
 * {@link setDependencies}, registered on the service registry as
 * `'widgets'` during `WidgetsModule.run()`. The four internal
 * collaborators are passed by reference — they have no other entry
 * points.
 */
export class WidgetsService implements IWidgetsService {
    private static instance: WidgetsService;

    /**
     * Cache of plugin defaults keyed by `${ownerId}::${typeId}`.
     * Populated on `registerWidget`; consulted by
     * `restorePluginDefaults`.
     */
    private readonly pluginDefaults: Map<string, IPluginRegistrationDefaults> = new Map();

    private constructor(
        private readonly zones: IZoneRegistry,
        private readonly widgetTypes: IWidgetTypeRegistry,
        private readonly placements: IPlacementService,
        private readonly resolver: PlacementResolver,
        private readonly routeCache: WidgetRouteCache,
        private readonly zoneLayouts: ZoneLayoutService,
        private readonly logger: ISystemLogService
    ) {}

    /**
     * Configure the singleton's injected collaborators. Idempotent —
     * called once during `WidgetsModule.init()`.
     */
    public static setDependencies(
        zones: IZoneRegistry,
        widgetTypes: IWidgetTypeRegistry,
        placements: IPlacementService,
        resolver: PlacementResolver,
        routeCache: WidgetRouteCache,
        zoneLayouts: ZoneLayoutService,
        logger: ISystemLogService
    ): void {
        if (!WidgetsService.instance) {
            WidgetsService.instance = new WidgetsService(
                zones,
                widgetTypes,
                placements,
                resolver,
                routeCache,
                zoneLayouts,
                logger
            );
        }
    }

    /**
     * Retrieve the configured singleton.
     *
     * @throws Error if `setDependencies` has not been called yet.
     */
    public static getInstance(): WidgetsService {
        if (!WidgetsService.instance) {
            throw new Error('WidgetsService.setDependencies() must be called first');
        }
        return WidgetsService.instance;
    }

    /**
     * Test-only reset to clear the singleton between unit tests.
     */
    public static __resetForTests(): void {
        // @ts-expect-error — clearing the private static for tests
        WidgetsService.instance = undefined;
    }

    // ------------------------------------------------------------
    // Discovery
    // ------------------------------------------------------------

    listZones(): IZoneSnapshot {
        // Merge each zone's effective layout into the registry snapshot:
        // the operator override when one is persisted, else a default
        // derived from the descriptor's coarse `layout` hint. Both the
        // SSR router and the admin editor read layout from this one
        // snapshot rather than a parallel lookup.
        const snapshot = this.zones.snapshot();
        return {
            tracks: snapshot.tracks.map(track => ({
                id: track.id,
                label: track.label,
                zones: track.zones.map(zone => ({
                    ...zone,
                    // Operator override when persisted, else the
                    // descriptor-derived default the registry already set.
                    layoutConfig: this.zoneLayouts.get(zone.id) ?? zone.layoutConfig
                }))
            }))
        };
    }

    listTypes(): IWidgetTypeSnapshot {
        return this.widgetTypes.snapshot();
    }

    hasZone(zoneId: string): boolean {
        return this.zones.has(zoneId);
    }

    hasType(typeId: string): boolean {
        return this.widgetTypes.has(typeId);
    }

    getTypeConfigSchema(typeId: string): JSONSchema7 | undefined {
        return this.widgetTypes.get(typeId)?.configSchema;
    }

    async fetchWidgetsForRoute(
        route: string,
        params: Record<string, string> = {}
    ): Promise<IWidgetData[]> {
        // Every page render calls this (twice), so results are held for a
        // few seconds per route. Writes below clear the cache, so only live
        // fetcher data can be that stale, never placement changes.
        return this.routeCache.get(route, params, () => this.resolver.resolveForRoute(route, params));
    }

    // ------------------------------------------------------------
    // Registration
    // ------------------------------------------------------------

    registerType(
        input: IRegisterWidgetTypeInput,
        ownerId: string
    ): WidgetsRegistrationDisposer {
        this.assertOwnerId(ownerId, 'registerType');

        const existingOwner = this.widgetTypes.getOwnerPluginId(input.id);
        if (existingOwner === ownerId) {
            this.logger.warn(
                { typeId: input.id, ownerId },
                'Widget type re-registered within the same lifecycle window; the existing descriptor is preserved'
            );
            // Return a no-op disposer — the existing descriptor stays.
            return () => undefined;
        }
        if (existingOwner !== undefined) {
            throw new Error(
                `Widget type '${input.id}' is already owned by '${existingOwner}'.`
            );
        }

        const descriptor = defineWidgetType({
            id: input.id,
            label: input.label,
            description: input.description,
            category: input.category,
            defaultDataFetcher: input.defaultDataFetcher,
            configSchema: input.configSchema
        });
        const disposeType = this.widgetTypes.register(ownerId, descriptor);

        // A newly registered type lets placements that were skipped as
        // unregistered start rendering, and disposing it hides them again,
        // so both change what a route resolves to.
        this.routeCache.clear();
        return () => {
            disposeType();
            this.routeCache.clear();
        };
    }

    registerZone(
        input: IRegisterZoneInput,
        ownerId: string
    ): WidgetsRegistrationDisposer {
        this.assertOwnerId(ownerId, 'registerZone');

        const descriptor = defineZone({
            id: input.id,
            label: input.label,
            description: input.description,
            host: input.host,
            layout: input.layout,
            order: input.order
        });
        return this.zones.register(ownerId, descriptor);
    }

    async registerWidget(
        input: IRegisterWidgetInput,
        ownerId: string
    ): Promise<void> {
        this.assertOwnerId(ownerId, 'registerWidget');
        if (ownerId === CORE_OWNER) {
            throw new Error(
                "registerWidget requires a plugin ownerId; core does not create plugin-source placements."
            );
        }

        if (!this.zones.has(input.defaultZoneId)) {
            this.logger.warn(
                { typeId: input.id, ownerId, zoneId: input.defaultZoneId },
                'registerWidget targets an unknown zone — placement will be created but cannot resolve until the zone is registered'
            );
        }

        // Refuse to create a plugin-source placement for a typeId
        // already owned by a different plugin. Without this guard plugin
        // B could upsert a placement keyed on ownerId=B that renders
        // plugin A's data fetcher at SSR time. Trust-based registration
        // makes the explicit ownership check the only safe gate.
        const existingOwner = this.widgetTypes.getOwnerPluginId(input.id);
        if (existingOwner !== undefined && existingOwner !== ownerId) {
            throw new WidgetTypeOwnerConflictError(input.id, existingOwner, ownerId);
        }

        // Capture the most-recent args before any registry mutation so
        // a mid-registration failure still leaves a recoverable cache
        // entry for restore-defaults. Overwrite on every call so that
        // a plugin re-enabled with updated defaults (e.g. a bumped
        // `defaultOrder`) propagates the new values into the
        // restore-defaults path instead of reverting to whatever was
        // in effect at the first registration.
        const cacheKey = `${ownerId}::${input.id}`;
        this.pluginDefaults.set(cacheKey, {
            ownerId,
            typeId: input.id,
            zoneId: input.defaultZoneId,
            routes: [...input.defaultRoutes],
            order: input.defaultOrder ?? DEFAULT_ORDER,
            title: input.defaultTitle
        });

        // Register the type if it isn't already (same-owner repeat
        // calls reuse the existing descriptor — handled by
        // registerType).
        if (!this.widgetTypes.has(input.id)) {
            try {
                this.registerType(input, ownerId);
            } catch (err) {
                this.logger.error(
                    { err, typeId: input.id, ownerId },
                    'Failed to register widget type during registerWidget — placement upsert skipped'
                );
                return;
            }
        }

        // Upsert the plugin-source placement. Operator customisations
        // to `order`, `routes`, `title`, `instanceConfig` survive
        // disable/re-enable cycles thanks to the `$setOnInsert`
        // semantics in PlacementService.ensurePluginPlacement.
        try {
            await this.placements.ensurePluginPlacement({
                typeId: input.id,
                zoneId: input.defaultZoneId,
                routes: input.defaultRoutes,
                order: input.defaultOrder,
                title: input.defaultTitle,
                instanceConfig: input.defaultInstanceConfig,
                pluginId: ownerId
            });
        } catch (err) {
            this.logger.error(
                { err, typeId: input.id, ownerId },
                'Failed to upsert plugin placement during registerWidget'
            );
        }

        // The upsert goes straight to the placement service, so clear here
        // rather than relying on registerType's clear, which ran before it.
        this.routeCache.clear();
    }

    async unregisterAllForOwner(ownerId: string): Promise<void> {
        if (!ownerId) return;
        if (ownerId === CORE_OWNER) {
            // Core registrations are process-lifetime; never disposed.
            return;
        }

        // Each teardown phase runs independently. A failure in one
        // phase — most plausibly a transient Mongo error in
        // softDisableForPlugin — must not skip disposal of the
        // in-memory type and zone registries. Otherwise the plugin
        // manager would mark the plugin disabled while live type/zone
        // descriptors remain discoverable and renderable.
        let placementCount = 0;
        let typeCount = 0;
        let zoneCount = 0;

        try {
            placementCount = await this.placements.softDisableForPlugin(ownerId);
        } catch (err) {
            this.logger.error(
                { err, ownerId },
                'Failed to soft-disable plugin placements; continuing with in-memory registry teardown'
            );
        }

        try {
            typeCount = this.widgetTypes.disposeForPlugin(ownerId);
        } catch (err) {
            this.logger.error(
                { err, ownerId },
                'Failed to dispose plugin widget types'
            );
        }

        try {
            zoneCount = this.zones.disposeForPlugin(ownerId);
        } catch (err) {
            this.logger.error(
                { err, ownerId },
                'Failed to dispose plugin zones'
            );
        }

        // Soft-disabled placements and disposed types must stop rendering on
        // the next request, not after the cache expires.
        this.routeCache.clear();

        if (placementCount > 0 || typeCount > 0 || zoneCount > 0) {
            this.logger.info(
                { ownerId, placements: placementCount, types: typeCount, zones: zoneCount },
                'Widget registrations disposed for owner'
            );
        }
    }

    // ------------------------------------------------------------
    // Zone layout
    // ------------------------------------------------------------

    async setZoneLayout(zoneId: string, config: IZoneLayoutConfig): Promise<IZoneLayoutConfig> {
        if (!this.zones.has(zoneId)) {
            throw new UnknownZoneError(zoneId);
        }
        return this.zoneLayouts.set(zoneId, config);
    }

    // ------------------------------------------------------------
    // Placement CRUD
    // ------------------------------------------------------------

    async listPlacements(
        filter?: IPlacementListFilter
    ): Promise<ReadonlyArray<IWidgetPlacement>> {
        return this.placements.list(filter);
    }

    async findPlacementById(id: string): Promise<IWidgetPlacement | null> {
        return this.placements.findById(id);
    }

    /**
     * Create a placement and clear the route cache so it renders on the
     * next request.
     *
     * @param input - Operator-supplied placement from the admin API.
     * @returns The stored placement.
     */
    async createPlacement(input: IPlacementInput): Promise<IWidgetPlacement> {
        return this.clearingRouteCache(() => this.writeNewPlacement(input));
    }

    /**
     * Validate and persist a new placement. Kept separate from
     * `createPlacement` so the public method can clear the route cache
     * around every exit path of this one.
     *
     * @param input - Operator-supplied placement from the admin API.
     * @returns The stored placement.
     */
    private async writeNewPlacement(input: IPlacementInput): Promise<IWidgetPlacement> {
        if (!this.widgetTypes.has(input.typeId)) {
            throw new UnknownWidgetTypeError(input.typeId);
        }
        if (!this.zones.has(input.zoneId)) {
            throw new UnknownZoneError(input.zoneId);
        }

        // Nesting: when a parent is named, validate the one-level
        // contract and force the child into the parent's zone with no
        // route filter of its own (the container governs visibility).
        if (input.parentId !== undefined) {
            const parent = await this.resolveContainerParent(input.typeId, null, input.parentId);
            return this.placements.create({
                ...input,
                zoneId: parent.zoneId,
                routes: []
            });
        }

        return this.placements.create(input);
    }

    /**
     * Apply a placement patch and clear the route cache so the change
     * renders on the next request.
     *
     * @param id - Placement to change.
     * @param patch - Fields the operator changed.
     * @returns The updated placement, or `null` when it does not exist.
     */
    async updatePlacement(
        id: string,
        patch: IPlacementPatch
    ): Promise<IWidgetPlacement | null> {
        return this.clearingRouteCache(() => this.writePlacementPatch(id, patch));
    }

    /**
     * Validate nesting rules and persist a placement patch. Kept separate
     * from `updatePlacement` so the public method can clear the route
     * cache around every exit path of this one.
     *
     * @param id - Placement to change.
     * @param patch - Fields the operator changed.
     * @returns The updated placement, or `null` when it does not exist.
     */
    private async writePlacementPatch(
        id: string,
        patch: IPlacementPatch
    ): Promise<IWidgetPlacement | null> {
        if (patch.zoneId !== undefined && !this.zones.has(patch.zoneId)) {
            throw new UnknownZoneError(patch.zoneId);
        }

        // A row that is still nested once the patch applies cannot take a
        // route filter of its own. Its container decides where the group
        // renders, which is why nesting stores an empty filter, and the
        // resolver, the admin editor, and the detach inheritance all read
        // the row that way. Accepting the filter and ignoring it would
        // leave the caller believing the row is scoped when it is not, so
        // the write is refused. The test is the nesting the patch leaves
        // behind, not whether `parentId` was omitted: a caller sending a
        // full representation echoes the row's current parent back, and a
        // caller attaching a row states a new one, and in both cases the
        // attach branch below would drop the filter and answer 200.
        // Detaching in the same patch is the supported way to scope the
        // row, and is handled further down.
        if (patch.routes !== undefined && patch.routes.length > 0 && patch.parentId !== null) {
            const existing = await this.placements.findById(id);
            if (!existing) return null;
            const staysNested = typeof patch.parentId === 'string' || existing.parentId !== undefined;
            if (staysNested) {
                throw new RouteFilterOnNestedPlacementError();
            }
        }

        // Attaching to a container (parentId is a string): validate the
        // one-level contract against the row being moved and force it
        // into the parent's zone with an empty route filter. Omission
        // leaves nesting untouched.
        if (typeof patch.parentId === 'string') {
            const existing = await this.placements.findById(id);
            if (!existing) return null;
            const parent = await this.resolveContainerParent(existing.typeId, id, patch.parentId);
            return this.placements.update(id, {
                ...patch,
                zoneId: parent.zoneId,
                routes: []
            });
        }

        // Detaching (`parentId: null`) needs no nesting validation, but it
        // does need a route filter. The row is stored with an empty one
        // because its container decided which pages the group appeared
        // on, and an empty filter on a top-level row means every route —
        // so clearing the link alone would publish the row site-wide. It
        // adopts the container's routes instead. Two cases override that:
        // a filter stated by the caller in the same patch, and a filter the
        // row already carries. The stored filter applied alongside the
        // container's while the row was nested, so overwriting it here
        // would widen where the row renders.
        if (patch.parentId === null && patch.routes === undefined) {
            const existing = await this.placements.findById(id);
            if (!existing) return null;
            if (existing.parentId !== undefined && existing.routes.length === 0) {
                const parent = await this.placements.findById(existing.parentId);
                if (parent) {
                    return this.placements.update(id, { ...patch, routes: [...parent.routes] });
                }
            }
        }

        return this.placements.update(id, patch);
    }

    /**
     * Delete a placement and clear the route cache so it stops rendering
     * on the next request.
     *
     * @param id - Placement to delete.
     * @returns `true` when a placement was deleted, `false` when none existed.
     */
    async deletePlacement(id: string): Promise<boolean> {
        return this.clearingRouteCache(() => this.removePlacement(id));
    }

    /**
     * Delete an operator placement, relocating a container's children
     * first. Kept separate from `deletePlacement` so the public method can
     * clear the route cache even when the relocation succeeds and the
     * delete then fails.
     *
     * @param id - Placement to delete.
     * @returns `true` when a placement was deleted, `false` when none existed.
     */
    private async removePlacement(id: string): Promise<boolean> {
        const existing = await this.placements.findById(id);
        if (!existing) return false;
        if (existing.source === 'plugin') {
            throw new PluginPlacementDeletionForbiddenError();
        }
        // Deleting a container relocates its children back to the zone
        // rather than cascade-deleting them, so operator-configured
        // widgets survive the container's removal. They inherit the
        // container's routes because that is the filter they were
        // rendering under; keeping their stored empty filter would read
        // as "every route" and widen each child to the whole site.
        if (existing.typeId === LAYOUT_GROUP_TYPE_ID) {
            await this.placements.detachChildrenOf(id, existing.routes);
        }
        return this.placements.delete(id);
    }

    /**
     * Validate the one-level nesting contract and return the resolved
     * container row so the caller can adopt its zone.
     *
     * Throws {@link InvalidParentPlacementError} when any rule is broken:
     * a layout group cannot itself be nested; a placement cannot be its
     * own parent; the parent must exist, must be a `core:layout-group`,
     * and must be top-level (no `parentId` of its own) so the tree never
     * exceeds one level of depth.
     *
     * @param childTypeId - Widget-type id of the placement being nested.
     * @param childId - Id of the placement being moved, or `null` on
     *   create; used to reject self-parenting on update.
     * @param parentId - Candidate container placement id.
     * @returns The validated parent placement.
     */
    private async resolveContainerParent(
        childTypeId: string,
        childId: string | null,
        parentId: string
    ): Promise<IWidgetPlacement> {
        if (childTypeId === LAYOUT_GROUP_TYPE_ID) {
            throw new InvalidParentPlacementError(
                'A layout group cannot be nested inside another container.'
            );
        }
        if (childId !== null && childId === parentId) {
            throw new InvalidParentPlacementError('A placement cannot be its own parent.');
        }
        const parent = await this.placements.findById(parentId);
        if (!parent) {
            throw new InvalidParentPlacementError(`Parent placement '${parentId}' does not exist.`);
        }
        if (parent.typeId !== LAYOUT_GROUP_TYPE_ID) {
            throw new InvalidParentPlacementError(
                `Parent placement '${parentId}' is not a layout group; only layout groups can contain widgets.`
            );
        }
        if (parent.parentId) {
            throw new InvalidParentPlacementError(
                `Parent placement '${parentId}' is itself nested; nesting is limited to one level.`
            );
        }
        return parent;
    }

    /**
     * Restore a plugin placement's defaults and clear the route cache so
     * the restored row renders on the next request.
     *
     * @param id - Plugin-source placement to restore.
     * @returns The restored placement, or `null` when it does not exist.
     */
    async restorePluginDefaults(id: string): Promise<IWidgetPlacement | null> {
        return this.clearingRouteCache(() => this.writePluginDefaults(id));
    }

    /**
     * Apply the cached registration defaults to a plugin placement. Kept
     * separate from `restorePluginDefaults` so the public method can clear
     * the route cache around it.
     *
     * @param id - Plugin-source placement to restore.
     * @returns The restored placement, or `null` when it does not exist.
     */
    private async writePluginDefaults(id: string): Promise<IWidgetPlacement | null> {
        const existing = await this.placements.findById(id);
        if (!existing) return null;
        if (existing.source !== 'plugin' || !existing.pluginId) {
            throw new RestoreDefaultsOnOperatorRowError();
        }

        const defaults = this.pluginDefaults.get(`${existing.pluginId}::${existing.typeId}`);
        if (!defaults) {
            throw new MissingPluginDefaultsError(existing.pluginId, existing.typeId);
        }

        return this.placements.restoreToPluginDefaults(id, {
            zoneId: defaults.zoneId,
            routes: defaults.routes,
            order: defaults.order,
            title: defaults.title
        });
    }

    // ------------------------------------------------------------
    // Internals
    // ------------------------------------------------------------

    /**
     * Run a placement write, then clear the route cache whether the write
     * succeeded or threw.
     *
     * Clearing on failure too matters because some writes touch several
     * rows (deleting a container relocates its children first), so a
     * failure part-way can still have changed what a route resolves to.
     *
     * @param write - The placement write to perform.
     * @returns Whatever the write returns.
     */
    private async clearingRouteCache<T>(write: () => Promise<T>): Promise<T> {
        try {
            return await write();
        } finally {
            this.routeCache.clear();
        }
    }

    /**
     * Reject empty or non-string owner ids early so downstream Mongo
     * filters cannot accidentally match every row.
     */
    private assertOwnerId(ownerId: string, op: string): void {
        if (!ownerId || typeof ownerId !== 'string') {
            throw new Error(`${op} requires a non-empty string ownerId`);
        }
    }
}
