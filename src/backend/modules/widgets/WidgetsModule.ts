/**
 * @fileoverview Widget module — IModule implementation.
 *
 * Owns the widget-zone subsystem in PR 1: receives the bootstrap-owned
 * `ZoneRegistry` instance via dependency injection, mounts the admin
 * introspection endpoint at `/api/admin/system/zones`. Future PRs add
 * the widget-type registry, placement persistence, and the SSR
 * resolution pipeline to this same module so all widget concerns live
 * in one tree.
 *
 * The zone registry itself is constructed in `bootstrapInit` alongside
 * the hook registry — the module does not own its lifecycle. This
 * mirrors the hook-registry pattern: the registry is process-wide
 * infrastructure shared between the plugin loader and the module that
 * exposes it.
 *
 * @module backend/modules/widgets/WidgetsModule
 */

import type { Express, Router } from 'express';
import type {
    IModule,
    IModuleMetadata,
    IZoneRegistry,
    ISystemLogService
} from '@/types';
import { logger } from '../../lib/logger.js';
import { requireAdmin } from '../../api/middleware/admin-auth.js';
import { createAdminRateLimiter } from '../../api/middleware/rate-limit.js';
import { ZonesController } from './api/zones.controller.js';
import { createZonesAdminRouter } from './api/zones.routes.js';

/**
 * Dependencies required by the widgets module.
 *
 * `zoneRegistry` is constructed in `bootstrapInit` and threaded through
 * `sharedDeps` so both this module and the plugin loader receive the
 * same instance.
 */
export interface IWidgetsModuleDependencies {
    /** Shared process-wide zone registry. */
    zoneRegistry: IZoneRegistry;
    /** Express app for admin route mounting. */
    app: Express;
}

/**
 * Widgets module class.
 *
 * Lifecycle:
 * - `init()` — store dependencies, construct admin controller.
 * - `run()` — mount the admin zone introspection router.
 */
export class WidgetsModule implements IModule<IWidgetsModuleDependencies> {
    readonly metadata: IModuleMetadata = {
        id: 'widgets',
        name: 'Widgets',
        version: '1.0.0',
        description: 'Widget zone registry, widget type catalog, and placement persistence.'
    };

    private zoneRegistry!: IZoneRegistry;
    private app!: Express;
    private zonesController!: ZonesController;

    private readonly logger: ISystemLogService = logger.child({ module: 'widgets' });

    /**
     * Initialise the module.
     *
     * @param dependencies - Injected dependencies.
     * @throws Error if any dependency is missing.
     */
    async init(dependencies: IWidgetsModuleDependencies): Promise<void> {
        this.logger.info('Initializing widgets module...');

        if (!dependencies.zoneRegistry) {
            throw new Error('WidgetsModule requires zoneRegistry dependency');
        }
        if (!dependencies.app) {
            throw new Error('WidgetsModule requires app dependency');
        }

        this.zoneRegistry = dependencies.zoneRegistry;
        this.app = dependencies.app;

        this.zonesController = new ZonesController(this.zoneRegistry, this.logger);

        this.logger.info('Widgets module initialized');
    }

    /**
     * Activate the module — mount the admin zone introspection router.
     *
     * The platform-default admin rate limiter runs before `requireAdmin`
     * so the brute-force cost against the auth gate is bounded per IP
     * (60 req / 60s). Matches the MenuModule `/manage` precedent and
     * satisfies CodeQL's `js/missing-rate-limiting` rule.
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
     * Accessor for the zone registry, exposed for tests and tooling
     * that need to reach the registry through the module instance.
     *
     * @returns The registry passed into `init`.
     * @throws Error when called before `init()`.
     */
    getZoneRegistry(): IZoneRegistry {
        if (!this.zoneRegistry) {
            throw new Error('WidgetsModule not initialized - call init() first');
        }
        return this.zoneRegistry;
    }
}
