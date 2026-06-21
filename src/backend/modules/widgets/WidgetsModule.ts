/**
 * @fileoverview Widget module — IModule implementation.
 *
 * Owns every concern of the widget subsystem: the zone registry, the
 * widget-type registry, the placement service (MongoDB), and the SSR
 * placement resolver. None of those are exposed outside the module;
 * the single public surface is `IWidgetsService`, registered on the
 * service registry as `'widgets'` during `run()`.
 *
 * Consumers — plugins, core modules, admin controllers, the SSR
 * router — reach widget functionality exclusively through
 * `context.services.get<IWidgetsService>('widgets')`. The legacy
 * `WidgetService` shim, the per-plugin `context.zones` /
 * `context.widgetTypes` facades, and the `IWidgetConfig` type are all
 * gone.
 *
 * Mutations to placements broadcast a `widgets:placements-update`
 * refetch signal over WebSocket so connected clients pick up changes
 * without a hard reload. The broadcast callback is wired here so the
 * placement service has no direct dependency on `WebSocketService`.
 *
 * @module backend/modules/widgets/WidgetsModule
 */

import type { Express, Router } from 'express';
import type {
    IModule,
    IModuleMetadata,
    IDatabaseService,
    IMenuService,
    ISystemLogService,
    IServiceRegistry
} from '@/types';
import { logger } from '../../lib/logger.js';
import { requireAdmin } from '../../api/middleware/admin-auth.js';
import { createAdminRateLimiter } from '../../api/middleware/rate-limit.js';
import { ZonesController } from './api/zones.controller.js';
import { createZonesAdminRouter } from './api/zones.routes.js';
import { PlacementsController } from './api/placements.controller.js';
import { createPlacementsAdminRouter } from './api/placements.routes.js';
import { WidgetTypesController } from './api/widget-types.controller.js';
import { createWidgetTypesAdminRouter } from './api/widget-types.routes.js';
import { PlacementService } from './placements/placement.service.js';
import { PlacementResolver } from './placements/placement-resolver.js';
import { ZoneRegistry } from './zones/zone-registry.js';
import { ZoneLayoutService } from './zones/zone-layout.service.js';
import { WidgetTypeRegistry } from './widget-types/widget-type-registry.js';
import { WidgetsService } from './widgets.service.js';
import { CORE_ZONE_DESCRIPTORS } from './zones/descriptors.js';
import { buildCoreWidgetTypeDescriptors } from './widget-types/core-widget-types.js';
import { WebSocketService } from '../../services/websocket.service.js';
import { MAIN_SYSTEM_CONTAINER_ID } from '../menu/index.js';

/**
 * Dependencies required by the widgets module.
 *
 * The internal registries (`ZoneRegistry`, `WidgetTypeRegistry`) are
 * constructed inside `init()` — bootstrap no longer pre-creates them.
 * `serviceRegistry` is the publication channel for the unified
 * `'widgets'` service; `database` backs the placement collection;
 * `menuService` seeds the admin menu entry; `app` mounts the admin
 * routers.
 */
export interface IWidgetsModuleDependencies {
    /** Shared process-wide service registry where `'widgets'` is published. */
    serviceRegistry: IServiceRegistry;
    /** Database service for placement persistence. */
    database: IDatabaseService;
    /** Menu service for seeding the admin menu entry. */
    menuService: IMenuService;
    /** Express app for admin route mounting. */
    app: Express;
}

/**
 * Widgets module class.
 *
 * Lifecycle:
 * - `init()` — instantiate internal registries, configure the
 *   `PlacementService` singleton, build the resolver, configure the
 *   `WidgetsService` singleton, wire admin controllers, wire the
 *   placement broadcast callback.
 * - `run()` — publish `'widgets'` on the service registry, register
 *   the core zone catalog through it, mount the admin routers, seed
 *   the System menu entry.
 */
export class WidgetsModule implements IModule<IWidgetsModuleDependencies> {
    readonly metadata: IModuleMetadata = {
        id: 'widgets',
        name: 'Widgets',
        version: '3.0.0',
        description: 'Unified IWidgetsService — zones, widget types, placements, and SSR resolution behind a single registry-published service.'
    };

    private serviceRegistry!: IServiceRegistry;
    private database!: IDatabaseService;
    private menuService!: IMenuService;
    private app!: Express;
    private zoneRegistry!: ZoneRegistry;
    private zoneLayoutService!: ZoneLayoutService;
    private widgetTypeRegistry!: WidgetTypeRegistry;
    private placementService!: PlacementService;
    private placementResolver!: PlacementResolver;
    private widgetsService!: WidgetsService;
    private zonesController!: ZonesController;
    private placementsController!: PlacementsController;
    private widgetTypesController!: WidgetTypesController;

    private readonly logger: ISystemLogService = logger.child({ module: 'widgets' });

    /**
     * Initialise the module.
     *
     * Builds the four internal collaborators, wires the placement
     * broadcast callback, and constructs the unified `WidgetsService`
     * via its singleton `setDependencies` setter. The service is not
     * yet on the registry — that happens in `run()` so peer modules
     * that depend on widgets at boot do so through the registry,
     * preserving service-registry discipline.
     */
    async init(dependencies: IWidgetsModuleDependencies): Promise<void> {
        this.logger.info('Initializing widgets module...');

        if (!dependencies.serviceRegistry) {
            throw new Error('WidgetsModule requires serviceRegistry dependency');
        }
        if (!dependencies.database) {
            throw new Error('WidgetsModule requires database dependency');
        }
        if (!dependencies.menuService) {
            throw new Error('WidgetsModule requires menuService dependency');
        }
        if (!dependencies.app) {
            throw new Error('WidgetsModule requires app dependency');
        }

        this.serviceRegistry = dependencies.serviceRegistry;
        this.database = dependencies.database;
        this.menuService = dependencies.menuService;
        this.app = dependencies.app;

        // Internal registries — runtime-only, rebuilt from registrations
        // every process start. The new model gives them no public
        // exposure; only `WidgetsService` reaches them.
        this.zoneRegistry = new ZoneRegistry(this.logger);
        this.widgetTypeRegistry = new WidgetTypeRegistry(this.logger);

        // Placement service is singleton-backed — `setDependencies`
        // resolves to a no-op on hot-reload. Resolver is plain.
        PlacementService.setDependencies(this.database, this.logger);
        this.placementService = PlacementService.getInstance();
        this.placementResolver = new PlacementResolver(
            this.placementService,
            this.widgetTypeRegistry,
            this.logger
        );

        // Wire the broadcast callback that fires after every placement
        // mutation. `WebSocketService` is initialised earlier in
        // bootstrap; when WebSockets are disabled the service is a
        // no-op so placement writes still execute cleanly.
        this.placementService.setBroadcast((event, payload) => {
            const wsService = WebSocketService.getInstance();
            wsService.emit({
                event: 'widgets:placements-update',
                payload: {
                    event,
                    placementId: payload.id,
                    zoneId: payload.zoneId,
                    timestamp: new Date().toISOString()
                }
            });
        });

        // Zone-layout store: owns operator flexbox overrides per zone.
        // Load warms the in-memory cache (and creates the unique index on
        // first boot) so `WidgetsService.listZones()` can merge layout
        // synchronously. Reuses the existing `widgets:placements-update`
        // refetch signal so connected admin clients re-pull zones — no new
        // WebSocket event is introduced.
        ZoneLayoutService.setDependencies(this.database, this.logger);
        this.zoneLayoutService = ZoneLayoutService.getInstance();
        await this.zoneLayoutService.load();
        this.zoneLayoutService.setBroadcast((zoneId) => {
            const wsService = WebSocketService.getInstance();
            wsService.emit({
                event: 'widgets:placements-update',
                payload: {
                    event: 'placement:updated',
                    placementId: '',
                    zoneId,
                    timestamp: new Date().toISOString()
                }
            });
        });

        // Singleton-backed unified widgets service. Composes the internal
        // collaborators behind one IWidgetsService surface.
        WidgetsService.setDependencies(
            this.zoneRegistry,
            this.widgetTypeRegistry,
            this.placementService,
            this.placementResolver,
            this.zoneLayoutService,
            this.logger
        );
        this.widgetsService = WidgetsService.getInstance();

        // Admin controllers consume the unified service exclusively —
        // they no longer reach into the registries or placement
        // service directly.
        this.zonesController = new ZonesController(this.widgetsService, this.logger);
        this.widgetTypesController = new WidgetTypesController(this.widgetsService, this.logger);
        this.placementsController = new PlacementsController(this.widgetsService, this.logger);

        this.logger.info('Widgets module initialized');
    }

    /**
     * Activate the module.
     *
     * Publishes `'widgets'` on the service registry, registers the
     * core zone catalog through the public service (so core uses the
     * same code path plugins do), mounts the three admin routers, and
     * seeds the System menu entry.
     */
    async run(): Promise<void> {
        this.logger.info('Running widgets module...');

        // Publish the single public surface. Done first so any code
        // that runs synchronously below (none currently) and every
        // subsequent plugin init can consume the service through the
        // registry without a fallback.
        this.serviceRegistry.register('widgets', this.widgetsService);
        this.logger.info("Registered IWidgetsService on service registry as 'widgets'");

        // Register the core zone catalog. Plain-data descriptors are
        // routed through the public service so the registry's
        // admission flow is the same one plugins exercise.
        for (const descriptor of CORE_ZONE_DESCRIPTORS) {
            this.widgetsService.registerZone(descriptor, 'core');
        }
        this.logger.info(
            { coreZoneCount: CORE_ZONE_DESCRIPTORS.length },
            'Core zone catalog registered'
        );

        // Register the core widget-type catalog (raw text/HTML, world
        // clocks, block ticker). Built via factory so the block-ticker
        // fetcher can resolve the `'blockchain'` service from the registry
        // at fetch time. Routed through the public service as 'core'-owned
        // so operators place these types from /system/widgets exactly like
        // plugin-declared types.
        const coreWidgetTypeDescriptors = buildCoreWidgetTypeDescriptors({
            serviceRegistry: this.serviceRegistry
        });
        for (const descriptor of coreWidgetTypeDescriptors) {
            this.widgetsService.registerType(descriptor, 'core');
        }
        this.logger.info(
            { coreWidgetTypeCount: coreWidgetTypeDescriptors.length },
            'Core widget-type catalog registered'
        );

        const zonesRouter: Router = createZonesAdminRouter(this.zonesController);
        this.app.use(
            '/api/admin/system/zones',
            createAdminRateLimiter('system-zones'),
            requireAdmin,
            zonesRouter
        );
        this.logger.info('Zone introspection router mounted at /api/admin/system/zones');

        const widgetTypesRouter: Router = createWidgetTypesAdminRouter(this.widgetTypesController);
        this.app.use(
            '/api/admin/system/widget-types',
            createAdminRateLimiter('system-widget-types'),
            requireAdmin,
            widgetTypesRouter
        );
        this.logger.info('Widget-type introspection router mounted at /api/admin/system/widget-types');

        const placementsRouter: Router = createPlacementsAdminRouter(this.placementsController);
        this.app.use(
            '/api/admin/system/widgets/placements',
            createAdminRateLimiter('system-widget-placements'),
            requireAdmin,
            placementsRouter
        );
        this.logger.info('Placements admin router mounted at /api/admin/system/widgets/placements');

        // Seed the System menu entry. `MAIN_SYSTEM_CONTAINER_ID`
        // forces `requiresAdmin: true` via the parent-chain check in
        // `MenuService.create` — see [menu README → System Container].
        await this.menuService.create({
            namespace: 'main',
            label: 'Widgets',
            description: 'Place plugin widgets in zones and manage operator overrides.',
            url: '/system/widgets',
            icon: 'LayoutGrid',
            order: 35,
            parent: MAIN_SYSTEM_CONTAINER_ID,
            enabled: true
        });
        this.logger.info('Widgets admin menu entry seeded under the System container');

        this.logger.info('Widgets module running');
    }

    /**
     * Accessor for the unified widgets service. Exposed for tests and
     * tooling that need direct access — production code consumes the
     * service through the service registry.
     */
    getWidgetsService(): WidgetsService {
        if (!this.widgetsService) {
            throw new Error('WidgetsModule not initialized - call init() first');
        }
        return this.widgetsService;
    }
}
