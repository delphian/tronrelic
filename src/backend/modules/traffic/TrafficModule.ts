/**
 * @fileoverview Traffic module — cookieless behavioral analytics.
 *
 * Carved out of the former omnibus user module. Owns the ClickHouse
 * `traffic_events` pipeline (`TrafficService`), Google Search Console keyword
 * integration (`GscService`), the User-Agent bot classifier, geo/IP derivation,
 * and the admin traffic dashboard reads. Mounts `/api/admin/users/traffic` and
 * registers the daily `gsc:fetch` job.
 *
 * Analytics are keyed off the cookieless `tronrelic_tid`, independent of
 * identity, so this surface survives the Phase 6 removal of the legacy UUID
 * identity system. It runs before `UserModule` so the legacy `UserService` can
 * resolve the `TrafficService` / `GscService` singletons it still leans on for
 * its (soon-to-be-dropped) analytics aggregations.
 *
 * Two-phase lifecycle: `init()` constructs services without activating; `run()`
 * mounts the admin router and registers the scheduled job.
 */

import type { Express, Router } from 'express';
import type { ICacheService, IClickHouseService, IDatabaseService, IModule, IModuleMetadata, ISchedulerService, IServiceRegistry } from '@/types';
import { logger } from '../../lib/logger.js';
import { GscService } from './services/gsc.service.js';
import { TrafficService } from './services/traffic.service.js';
import { initGeoIP } from './services/geo.service.js';
import { TrafficController } from './api/traffic.controller.js';
import { createAdminTrafficRouter, createAdminAnalyticsRouter } from './api/traffic.routes.js';
import { requireAdmin } from '../../api/middleware/admin-auth.js';

/**
 * Dependencies the traffic module needs at bootstrap.
 */
export interface ITrafficModuleDependencies {
    /** Database service for the GSC keyword collection. */
    database: IDatabaseService;

    /** Cache service backing GSC fetch caching. */
    cacheService: ICacheService;

    /**
     * ClickHouse service for `traffic_events`. Optional — `undefined` when
     * `CLICKHOUSE_HOST` is unset; TrafficService then silently drops writes.
     */
    clickhouse: IClickHouseService | undefined;

    /** Express app — the module mounts its own admin router (IoC). */
    app: Express;

    /** Scheduler for the daily GSC fetch job. Null when disabled. */
    scheduler: ISchedulerService | null;

    /**
     * Service registry. The analytics controller resolves the identity-owned
     * `'accounts'` and `'wallets'` services from it at request time for the
     * account/wallet-adoption overview panel.
     */
    serviceRegistry: IServiceRegistry;
}

/**
 * Cookieless traffic analytics module.
 */
export class TrafficModule implements IModule<ITrafficModuleDependencies> {
    /** Module metadata for introspection and logging. */
    readonly metadata: IModuleMetadata = {
        id: 'traffic',
        name: 'Traffic',
        version: '1.0.0',
        description: 'Cookieless behavioral analytics, GSC integration, and bot classification'
    };

    private app!: Express;
    private scheduler!: ISchedulerService | null;

    private gscService!: GscService;
    private trafficService!: TrafficService;
    private trafficController!: TrafficController;

    private readonly logger = logger.child({ module: 'traffic' });

    /**
     * Construct the analytics services and controller. Does not mount routes
     * or register the scheduled job (that is `run()`).
     *
     * @param dependencies - Injected database, cache, ClickHouse, app, scheduler.
     */
    async init(dependencies: ITrafficModuleDependencies): Promise<void> {
        this.logger.info('Initializing traffic module...');

        this.app = dependencies.app;
        this.scheduler = dependencies.scheduler;

        // Initialize GeoIP lookup for country detection (non-blocking).
        await initGeoIP();

        // GscService — Google Search Console keyword integration.
        GscService.setDependencies(dependencies.database, dependencies.cacheService, this.logger);
        this.gscService = GscService.getInstance();
        await this.gscService.createIndexes();

        // TrafficService — ClickHouse traffic_events. ClickHouse is optional;
        // when undefined the service no-ops. See PLAN-traffic-events.md.
        TrafficService.setDependencies(dependencies.clickhouse, this.logger);
        this.trafficService = TrafficService.getInstance();

        // Admin dashboard reads against traffic_events aggregates, plus the
        // analytics + GSC surface. Resolves account/wallet services from the
        // registry at request time.
        this.trafficController = new TrafficController(
            this.trafficService,
            this.gscService,
            dependencies.serviceRegistry,
            this.logger
        );

        this.logger.info('Traffic module initialized');
    }

    /**
     * Mount the admin traffic router and register the GSC fetch job.
     *
     * `/api/admin/users/traffic` mounts ahead of the legacy `/api/admin/users`
     * router (UserModule runs after this module) so its specific `/traffic/*`
     * paths win over the legacy `/:id` matcher.
     */
    async run(): Promise<void> {
        this.logger.info('Running traffic module...');

        const adminTrafficRouter: Router = createAdminTrafficRouter(this.trafficController);
        this.app.use('/api/admin/users/traffic', requireAdmin, adminTrafficRouter);
        this.logger.info('Admin traffic router mounted at /api/admin/users/traffic');

        // Analytics dashboard router. Mounts ahead of the legacy
        // /api/admin/users router (UserModule runs after this module) so the
        // analytics paths win over its `/:id` matcher and shadow the legacy
        // (Mongo-backed) analytics handlers still present on it until Phase D.
        const adminAnalyticsRouter: Router = createAdminAnalyticsRouter(this.trafficController);
        this.app.use('/api/admin/users/analytics', requireAdmin, adminAnalyticsRouter);
        this.logger.info('Admin analytics router mounted at /api/admin/users/analytics');

        // Daily GSC fetch (3 AM). SchedulerService supports late registration.
        if (this.scheduler) {
            this.scheduler.register('gsc:fetch', '0 3 * * *', async () => {
                if (await this.gscService.isConfigured()) {
                    await this.gscService.fetchAndStore();
                }
            });
            this.logger.info('GSC fetch job registered');
        } else {
            this.logger.info('Scheduler disabled — GSC fetch job not registered');
        }

        this.logger.info('Traffic module running');
    }

    /**
     * Expose the TrafficService singleton for the legacy user module, which
     * still injects it into UserService for analytics aggregations until
     * Phase 6 removes that surface. Available after `init()`.
     *
     * @returns The TrafficService singleton.
     * @throws {Error} If called before `init()`.
     */
    getTrafficService(): TrafficService {
        if (!this.trafficService) {
            throw new Error('TrafficModule not initialized - call init() first');
        }
        return this.trafficService;
    }
}
