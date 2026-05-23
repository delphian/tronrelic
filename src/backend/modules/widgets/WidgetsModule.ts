/**
 * @fileoverview Widget module — IModule implementation.
 *
 * Owns three subsystems in PR 2: the widget-zone registry (PR 1
 * scaffolding, still bootstrap-instantiated), the widget-type
 * registry (also bootstrap-instantiated, plugin-declared types), and
 * the new placement-persistence layer that records every operator-
 * or plugin-source placement in MongoDB and resolves them at SSR
 * time. The legacy `WidgetService` becomes a compatibility shim that
 * delegates type registration and placement upsert/disable/fetch to
 * this module's services, keeping every existing plugin working
 * with no plugin-side code change.
 *
 * The registries (zones, widget types) are constructed in
 * `bootstrapInit` and threaded through `sharedDeps` so the plugin
 * loader's per-plugin facades and this module both receive the same
 * instances. The placement service is module-owned because it needs
 * the `IDatabaseService` injected via module DI and has no plugin-
 * facing surface.
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
    ISystemLogService
} from '@/types';
import { logger } from '../../lib/logger.js';
import { requireAdmin } from '../../api/middleware/admin-auth.js';
import { createAdminRateLimiter } from '../../api/middleware/rate-limit.js';
import { ZonesController } from './api/zones.controller.js';
import { createZonesAdminRouter } from './api/zones.routes.js';
import { PlacementService } from './placements/placement.service.js';
import { PlacementResolver } from './placements/placement-resolver.js';
import { WidgetService } from '../../services/widget/widget.service.js';

/**
 * Dependencies required by the widgets module.
 *
 * `zoneRegistry` and `widgetTypeRegistry` are constructed in
 * `bootstrapInit` and threaded through `sharedDeps` so both this
 * module and the plugin loader receive the same instances. `database`
 * is the platform-shared `IDatabaseService` the placement service
 * uses for the `module_widgets_placements` collection.
 */
export interface IWidgetsModuleDependencies {
    /** Shared process-wide zone registry. */
    zoneRegistry: IZoneRegistry;
    /** Shared process-wide widget-type registry. */
    widgetTypeRegistry: IWidgetTypeRegistry;
    /** Database service for placement persistence. */
    database: IDatabaseService;
    /** Express app for admin route mounting. */
    app: Express;
}

/**
 * Widgets module class.
 *
 * Lifecycle:
 * - `init()` — store deps, configure the `PlacementService`
 *   singleton, construct the `PlacementResolver`, and wire the
 *   legacy `WidgetService` compatibility shim so plugin registrations
 *   route into the new infrastructure.
 * - `run()` — mount the admin zone introspection router (PR 1).
 *   Future PRs add placement-CRUD admin routes here.
 */
export class WidgetsModule implements IModule<IWidgetsModuleDependencies> {
    readonly metadata: IModuleMetadata = {
        id: 'widgets',
        name: 'Widgets',
        version: '2.0.0',
        description: 'Widget zone registry, widget type catalog, and placement persistence.'
    };

    private zoneRegistry!: IZoneRegistry;
    private widgetTypeRegistry!: IWidgetTypeRegistry;
    private database!: IDatabaseService;
    private app!: Express;
    private zonesController!: ZonesController;
    private placementService!: PlacementService;
    private placementResolver!: PlacementResolver;

    private readonly logger: ISystemLogService = logger.child({ module: 'widgets' });

    /**
     * Initialise the module.
     *
     * Wires the placement subsystem and the legacy `WidgetService`
     * compatibility shim so that, by the time `loadPlugins(...)` runs,
     * every plugin call to `context.widgetService.register(...)` is
     * already routed into the new type/placement infrastructure.
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
        if (!dependencies.app) {
            throw new Error('WidgetsModule requires app dependency');
        }

        this.zoneRegistry = dependencies.zoneRegistry;
        this.widgetTypeRegistry = dependencies.widgetTypeRegistry;
        this.database = dependencies.database;
        this.app = dependencies.app;

        this.zonesController = new ZonesController(this.zoneRegistry, this.logger);

        PlacementService.setDependencies(this.database, this.logger);
        this.placementService = PlacementService.getInstance();
        this.placementResolver = new PlacementResolver(
            this.placementService,
            this.widgetTypeRegistry,
            this.logger
        );

        // Wire the legacy `WidgetService` compatibility shim. The
        // singleton was already constructed during the plugin loader
        // setup, but its widget-type and placement back-ends only
        // become populated here. Plugin registrations during
        // `loadPlugins(...)` (which runs after every module's `run()`)
        // therefore see the fully-wired shim.
        const widgetService = WidgetService.getInstance(this.logger);
        widgetService.setZoneRegistry(this.zoneRegistry);
        widgetService.setWidgetTypeRegistry(this.widgetTypeRegistry);
        widgetService.setPlacementService(this.placementService);
        widgetService.setPlacementResolver(this.placementResolver);

        this.logger.info('Widgets module initialized');
    }

    /**
     * Activate the module — mount the admin zone introspection router.
     *
     * The platform-default admin rate limiter runs before
     * `requireAdmin` so the brute-force cost against the auth gate is
     * bounded per IP (60 req / 60s). Matches the MenuModule `/manage`
     * precedent and satisfies CodeQL's `js/missing-rate-limiting`
     * rule.
     */
    async run(): Promise<void> {
        this.logger.info('Running widgets module...');

        const adminRouter: Router = createZonesAdminRouter(this.zonesController);
        const rateLimiter = createAdminRateLimiter('system-zones');
        this.app.use('/api/admin/system/zones', rateLimiter, requireAdmin, adminRouter);
        this.logger.info('Zone introspection router mounted at /api/admin/system/zones');

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
