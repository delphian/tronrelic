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
    IPlacementPatch
} from '@/types';
import type { IZoneRegistry } from '../../../../packages/types/src/widget-zones/IZoneRegistry.js';
import type { IWidgetTypeRegistry } from '../../../../packages/types/src/widget-types/IWidgetTypeRegistry.js';
import type { IPlacementService } from '../../../../packages/types/src/widget-placements/IPlacementService.js';
import type { PlacementResolver } from './placements/placement-resolver.js';
import { defineZone } from './zones/define-zone.js';
import { defineWidgetType } from './widget-types/define-widget-type.js';

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
        logger: ISystemLogService
    ): void {
        if (!WidgetsService.instance) {
            WidgetsService.instance = new WidgetsService(
                zones,
                widgetTypes,
                placements,
                resolver,
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
        return this.zones.snapshot();
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

    async fetchWidgetsForRoute(
        route: string,
        params: Record<string, string> = {}
    ): Promise<IWidgetData[]> {
        return this.resolver.resolveForRoute(route, params);
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
        return this.widgetTypes.register(ownerId, descriptor);
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
            layout: input.layout
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

        // Capture the original args before any registry mutation so a
        // mid-registration failure still leaves a recoverable cache
        // entry for restore-defaults.
        const cacheKey = `${ownerId}::${input.id}`;
        if (!this.pluginDefaults.has(cacheKey)) {
            this.pluginDefaults.set(cacheKey, {
                ownerId,
                typeId: input.id,
                zoneId: input.defaultZoneId,
                routes: [...input.defaultRoutes],
                order: input.defaultOrder ?? DEFAULT_ORDER,
                title: input.defaultTitle
            });
        }

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
    }

    async unregisterAllForOwner(ownerId: string): Promise<void> {
        if (!ownerId) return;
        if (ownerId === CORE_OWNER) {
            // Core registrations are process-lifetime; never disposed.
            return;
        }

        const placementCount = await this.placements.softDisableForPlugin(ownerId);
        const typeCount = this.widgetTypes.disposeForPlugin(ownerId);
        const zoneCount = this.zones.disposeForPlugin(ownerId);

        if (placementCount > 0 || typeCount > 0 || zoneCount > 0) {
            this.logger.info(
                { ownerId, placements: placementCount, types: typeCount, zones: zoneCount },
                'Widget registrations disposed for owner'
            );
        }
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

    async createPlacement(input: IPlacementInput): Promise<IWidgetPlacement> {
        if (!this.widgetTypes.has(input.typeId)) {
            throw new Error(`Unknown widget type '${input.typeId}'`);
        }
        if (!this.zones.has(input.zoneId)) {
            throw new Error(`Unknown zone '${input.zoneId}'`);
        }
        return this.placements.create(input);
    }

    async updatePlacement(
        id: string,
        patch: IPlacementPatch
    ): Promise<IWidgetPlacement | null> {
        if (patch.zoneId !== undefined && !this.zones.has(patch.zoneId)) {
            throw new Error(`Unknown zone '${patch.zoneId}'`);
        }
        return this.placements.update(id, patch);
    }

    async deletePlacement(id: string): Promise<boolean> {
        const existing = await this.placements.findById(id);
        if (!existing) return false;
        if (existing.source === 'plugin') {
            throw new Error(
                'Plugin-source placements cannot be deleted. Disable the plugin or update the placement to enabled: false instead.'
            );
        }
        return this.placements.delete(id);
    }

    async restorePluginDefaults(id: string): Promise<IWidgetPlacement | null> {
        const existing = await this.placements.findById(id);
        if (!existing) return null;
        if (existing.source !== 'plugin' || !existing.pluginId) {
            throw new Error('restorePluginDefaults is only valid on plugin-source placements');
        }

        const defaults = this.pluginDefaults.get(`${existing.pluginId}::${existing.typeId}`);
        if (!defaults) {
            throw new Error(
                `No cached plugin defaults for '${existing.pluginId}::${existing.typeId}'. ` +
                `Re-enable the plugin in this process to repopulate the cache.`
            );
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
     * Reject empty or non-string owner ids early so downstream Mongo
     * filters cannot accidentally match every row.
     */
    private assertOwnerId(ownerId: string, op: string): void {
        if (!ownerId || typeof ownerId !== 'string') {
            throw new Error(`${op} requires a non-empty string ownerId`);
        }
    }
}
