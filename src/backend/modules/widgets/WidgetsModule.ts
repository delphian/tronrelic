/**
 * @fileoverview Widget module — IModule implementation.
 *
 * Owns three subsystems: the widget-zone registry (bootstrap-
 * instantiated), the widget-type registry (also bootstrap-instantiated,
 * plugin-declared types), and the placement-persistence layer that
 * records every operator- or plugin-source placement in MongoDB and
 * resolves them at SSR time. The legacy `WidgetService` is a
 * compatibility shim that delegates type registration and placement
 * upsert/disable/fetch to this module's services, keeping every
 * existing plugin working without code change.
 *
 * The module also mounts the admin REST surface: a read-only
 * zone-introspection endpoint, a read-only widget-type introspection
 * endpoint, and a full CRUD endpoint set for placements. Together
 * these power the `/system/widgets` operator UI.
 *
 * Mutations to placements broadcast a `widgets:placements-update`
 * refetch signal over WebSocket so connected clients — including
 * public pages rendering widgets — pick up changes without a hard
 * reload. The broadcast callback is wired here so the placement
 * service has no direct dependency on `WebSocketService`.
 *
 * @module backend/modules/widgets/WidgetsModule
 */

import type { Express, Router } from 'express';
import type {
    IModule,
    IModuleMetadata,
    IDatabaseService,
    IZoneRegistry,
    IWidgetTypeRegistry,
    IMenuService,
    ISystemLogService
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
import { WidgetService } from '../../services/widget/widget.service.js';
import { WebSocketService } from '../../services/websocket.service.js';
import { MAIN_SYSTEM_CONTAINER_ID } from '../menu/index.js';

/**
 * Dependencies required by the widgets module.
 *
 * `zoneRegistry` and `widgetTypeRegistry` are constructed in
 * `bootstrapInit` and threaded through `sharedDeps` so both this
 * module and the plugin loader receive the same instances. `database`
 * is the platform-shared `IDatabaseService` the placement service
 * uses for the `module_widgets_placements` collection. `menuService`
 * is the navigation singleton — the module seeds the `/system/widgets`
 * admin menu entry during `run()`.
 */
export interface IWidgetsModuleDependencies {
    /** Shared process-wide zone registry. */
    zoneRegistry: IZoneRegistry;
    /** Shared process-wide widget-type registry. */
    widgetTypeRegistry: IWidgetTypeRegistry;
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
 * - `init()` — store deps, configure the `PlacementService` singleton,
 *   construct the `PlacementResolver`, wire the legacy `WidgetService`
 *   compat shim, and bind the placement broadcast callback to
 *   `WebSocketService`.
 * - `run()` — mount the admin routers and seed the System menu entry.
 */
export class WidgetsModule implements IModule<IWidgetsModuleDependencies> {
    readonly metadata: IModuleMetadata = {
        id: 'widgets',
        name: 'Widgets',
        version: '2.1.0',
        description: 'Widget zone registry, widget type catalog, placement persistence, and admin REST.'
    };

    private zoneRegistry!: IZoneRegistry;
    private widgetTypeRegistry!: IWidgetTypeRegistry;
    private database!: IDatabaseService;
    private menuService!: IMenuService;
    private app!: Express;
    private zonesController!: ZonesController;
    private placementsController!: PlacementsController;
    private widgetTypesController!: WidgetTypesController;
    private placementService!: PlacementService;
    private placementResolver!: PlacementResolver;
    private widgetService!: WidgetService;

    private readonly logger: ISystemLogService = logger.child({ module: 'widgets' });

    /**
     * Initialise the module.
     *
     * Wires the placement subsystem, the legacy `WidgetService`
     * compatibility shim, and the placement-broadcast callback so
     * that by the time `loadPlugins(...)` runs every plugin
     * registration routes into the new infrastructure with WebSocket
     * notifications already in place.
     *
     * @param dependencies - Injected dependencies.
     * @throws Error if any dependency is missing.
     */
    async init(dependencies: IWidgetsModuleDependencies): Promise<void> {
        this.logger.info('Initializing widgets module...');

        if (!dependencies.zoneRegistry) {
            throw new Error('WidgetsModule requires zoneRegistry dependency');
        }
        if (!dependencies.widgetTypeRegistry) {
            throw new Error('WidgetsModule requires widgetTypeRegistry dependency');
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

        this.zoneRegistry = dependencies.zoneRegistry;
        this.widgetTypeRegistry = dependencies.widgetTypeRegistry;
        this.database = dependencies.database;
        this.menuService = dependencies.menuService;
        this.app = dependencies.app;

        this.zonesController = new ZonesController(this.zoneRegistry, this.logger);

        PlacementService.setDependencies(this.database, this.logger);
        this.placementService = PlacementService.getInstance();
        this.placementResolver = new PlacementResolver(
            this.placementService,
            this.widgetTypeRegistry,
            this.logger
        );

        // Wire the broadcast callback that fires after every
        // placement mutation. The `WebSocketService` singleton is
        // initialised earlier in `bootstrapInit()` (gated by
        // `ENABLE_WEBSOCKETS`); when WebSockets are disabled the
        // service is a no-op so the placement service still
        // executes mutations cleanly.
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

        // Wire the legacy `WidgetService` compatibility shim. The
        // singleton was constructed earlier during the plugin loader
        // setup, but its widget-type and placement back-ends only
        // become populated here. Plugin registrations during
        // `loadPlugins(...)` (which runs after every module's
        // `run()`) therefore see the fully-wired shim with the
        // broadcast callback already firing.
        this.widgetService = WidgetService.getInstance(this.logger);
        this.widgetService.setZoneRegistry(this.zoneRegistry);
        this.widgetService.setWidgetTypeRegistry(this.widgetTypeRegistry);
        this.widgetService.setPlacementService(this.placementService);
        this.widgetService.setPlacementResolver(this.placementResolver);

        // Admin REST controllers. The placements controller pulls
        // plugin defaults through `widgetService.getPluginDefault`
        // so it does not import the legacy service directly.
        this.placementsController = new PlacementsController({
            placements: this.placementService,
            zones: this.zoneRegistry,
            widgetTypes: this.widgetTypeRegistry,
            getPluginDefault: (pluginId, typeId) =>
                this.widgetService.getPluginDefault(pluginId, typeId),
            logger: this.logger
        });
        this.widgetTypesController = new WidgetTypesController(
            this.widgetTypeRegistry,
            this.logger
        );

        this.logger.info('Widgets module initialized');
    }

    /**
     * Activate the module — mount admin routers and seed the System
     * menu entry.
     *
     * Three admin routers mount in parallel namespaces under
     * `/api/admin/system/`: `zones` (introspection), `widget-types`
     * (introspection), and `widgets/placements` (CRUD). Each gets the
     * platform-default admin rate limiter applied before
     * `requireAdmin` so the brute-force cost against the auth gate
     * stays bounded per IP.
     */
    async run(): Promise<void> {
        this.logger.info('Running widgets module...');

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
     * Accessor for the zone registry, exposed for tests and tooling.
     */
    getZoneRegistry(): IZoneRegistry {
        if (!this.zoneRegistry) {
            throw new Error('WidgetsModule not initialized - call init() first');
        }
        return this.zoneRegistry;
    }

    /**
     * Accessor for the widget-type registry, exposed for tests and
     * tooling.
     */
    getWidgetTypeRegistry(): IWidgetTypeRegistry {
        if (!this.widgetTypeRegistry) {
            throw new Error('WidgetsModule not initialized - call init() first');
        }
        return this.widgetTypeRegistry;
    }

    /**
     * Accessor for the placement service, exposed for tests, admin
     * tooling, and any forthcoming CRUD endpoints.
     */
    getPlacementService(): PlacementService {
        if (!this.placementService) {
            throw new Error('WidgetsModule not initialized - call init() first');
        }
        return this.placementService;
    }

    /**
     * Accessor for the SSR placement resolver. The compat-shim widget
     * service delegates `fetchWidgetsForRoute` here.
     */
    getPlacementResolver(): PlacementResolver {
        if (!this.placementResolver) {
            throw new Error('WidgetsModule not initialized - call init() first');
        }
        return this.placementResolver;
    }
}
