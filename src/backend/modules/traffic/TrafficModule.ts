/**
 * @fileoverview Traffic module — cookieless behavioral analytics.
 *
 * Carved out of the former omnibus user module. Owns the ClickHouse
 * `traffic_events` pipeline (`TrafficService`), Google Search Console keyword
 * integration (`GscService`), the User-Agent bot classifier, geo/IP derivation,
 * the admin traffic dashboard reads, and the public traffic-event ingestion
 * endpoints. Mounts `/api/admin/users/{traffic,analytics}`, the public
 * `/api/user/bootstrap` (first touch) and `/api/user/track` (page navigation),
 * and registers the daily `gsc:fetch` job.
 *
 * Analytics are keyed off the cookieless `tronrelic_tid`, independent of
 * identity, so this surface survived the Better Auth cutover that removed the
 * legacy UUID identity system.
 *
 * Two-phase lifecycle: `init()` constructs services without activating; `run()`
 * mounts the routers and registers the scheduled job.
 */

import type { Express, Router } from 'express';
import type { ICacheService, IClickHouseService, IDatabaseService, IMenuService, IModule, IModuleMetadata, ISchedulerService, IServiceRegistry } from '@/types';
import { logger } from '../../lib/logger.js';
import { MAIN_SYSTEM_CONTAINER_ID } from '../menu/index.js';
import { GscService } from './services/gsc.service.js';
import { TrafficService } from './services/traffic.service.js';
import { IgnoredUsersService } from './services/ignored-users.service.js';
import { RedirectService } from './services/redirect.service.js';
import { initGeoIP } from './services/geo.service.js';
import { TrafficController } from './api/traffic.controller.js';
import { BootstrapController } from './api/bootstrap.controller.js';
import { RedirectsController } from './api/redirects.controller.js';
import { createAdminTrafficRouter, createAdminAnalyticsRouter } from './api/traffic.routes.js';
import { createBootstrapRouter, createPageEventRouter } from './api/bootstrap.routes.js';
import { createPublicRedirectsRouter, createAdminRedirectsRouter } from './api/redirects.routes.js';
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

    /** Menu service for registering the /system/traffic admin menu item. */
    menuService: IMenuService;

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
 * Namespace for the `/system/traffic` in-page tab row. Rendered as a menu via
 * the Submenu Pattern (`MenuNavClient`) rather than a hand-rolled button row, so
 * the tabs inherit per-user gating, ordering, and live `menu:update` refresh and
 * a plugin could contribute a tab.
 */
const TRAFFIC_SUBMENU_NAMESPACE = 'traffic';

/**
 * The `/system/traffic` tab row. `order` is left-to-right position; `tab` is the
 * `?tab=` query key the page switches panels on. Icons are lucide names.
 */
const TRAFFIC_SUBMENU_TABS: ReadonlyArray<{ label: string; tab: string; icon: string; order: number }> = [
    { label: 'Analytics', tab: 'analytics', icon: 'BarChart3', order: 0 },
    { label: 'Visitors', tab: 'visitors', icon: 'Users', order: 1 },
    { label: 'Crawlers', tab: 'crawlers', icon: 'Bot', order: 2 },
    { label: 'SEO', tab: 'seo', icon: 'Search', order: 3 },
    { label: 'Redirects', tab: 'redirects', icon: 'CornerUpRight', order: 4 },
    { label: 'Settings', tab: 'settings', icon: 'Settings', order: 5 }
];

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
    private menuService!: IMenuService;
    private scheduler!: ISchedulerService | null;

    private gscService!: GscService;
    private trafficService!: TrafficService;
    private ignoredUsersService!: IgnoredUsersService;
    private redirectService!: RedirectService;
    private trafficController!: TrafficController;
    private bootstrapController!: BootstrapController;
    private redirectsController!: RedirectsController;

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
        this.menuService = dependencies.menuService;
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

        // Ignore list — registered accounts excluded from every stat. Load the
        // persisted ids into TrafficService's cache now so the always-on
        // exclusion is live from the first read, not the first mutation.
        IgnoredUsersService.setDependencies(dependencies.database, this.logger);
        this.ignoredUsersService = IgnoredUsersService.getInstance();
        await this.ignoredUsersService.createIndexes();
        await this.trafficService.setIgnoredUserIds(await this.ignoredUsersService.getIds());

        // RedirectService — admin-managed legacy-URL 301/302 map. Rules live in
        // Mongo and are served to the edge middleware, so operators add
        // redirects without a deploy. Migration 017 seeds the initial legacy
        // set; operators add/edit the rest from the /system/traffic Redirects tab.
        RedirectService.setDependencies(dependencies.database, this.logger);
        this.redirectService = RedirectService.getInstance();
        await this.redirectService.createIndexes();

        // Admin dashboard reads against traffic_events aggregates, plus the
        // analytics + GSC surface. Resolves account/wallet services from the
        // registry at request time.
        this.trafficController = new TrafficController(
            this.trafficService,
            this.gscService,
            this.ignoredUsersService,
            dependencies.serviceRegistry,
            this.logger
        );

        // Slim first-touch analytics bootstrap (no identity, no Mongo).
        this.bootstrapController = new BootstrapController(this.trafficService, this.logger);

        // Admin redirect management + the public feed the edge middleware polls.
        this.redirectsController = new RedirectsController(this.redirectService, this.logger);

        this.logger.info('Traffic module initialized');
    }

    /**
     * Mount the admin traffic + analytics routers, the public bootstrap router,
     * and register the GSC fetch job.
     *
     * This module runs before the identity module, so its specific
     * `/api/admin/users/{traffic,analytics}` prefixes register ahead of
     * identity's `/api/admin/users` account-directory catch-all and win over
     * its `/:id` matcher.
     */
    async run(): Promise<void> {
        this.logger.info('Running traffic module...');

        try {
            await this.menuService.create({
                namespace: 'main',
                label: 'Traffic',
                url: '/system/traffic',
                icon: 'Activity',
                order: 26,
                parent: MAIN_SYSTEM_CONTAINER_ID,
                enabled: true
            });

            this.logger.info('Traffic menu item registered under the System container');

            // In-page tab row as a namespaced menu (Submenu Pattern). Nodes are
            // memory-only and live outside the System container, so the
            // container's non-bypassable requiresAdmin force does not reach them
            // — each node sets requiresAdmin itself. The page renders this
            // namespace with MenuNavClient instead of hand-rolling the tabs.
            for (const tab of TRAFFIC_SUBMENU_TABS) {
                await this.menuService.create({
                    namespace: TRAFFIC_SUBMENU_NAMESPACE,
                    label: tab.label,
                    url: `/system/traffic?tab=${tab.tab}`,
                    icon: tab.icon,
                    order: tab.order,
                    parent: null,
                    enabled: true,
                    requiresAdmin: true
                });
            }
            this.logger.info('Traffic submenu tab nodes registered');
        } catch (error) {
            this.logger.error({ error }, 'Failed to register traffic menu item');
            throw new Error(`Failed to register traffic menu item: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }

        const adminTrafficRouter: Router = createAdminTrafficRouter(this.trafficController);
        this.app.use('/api/admin/users/traffic', requireAdmin, adminTrafficRouter);
        this.logger.info('Admin traffic router mounted at /api/admin/users/traffic');

        // Analytics dashboard router. Mounts ahead of identity's
        // /api/admin/users account-directory catch-all (identity runs after
        // this module) so the analytics paths win over its `/:id` matcher.
        const adminAnalyticsRouter: Router = createAdminAnalyticsRouter(this.trafficController);
        this.app.use('/api/admin/users/analytics', requireAdmin, adminAnalyticsRouter);
        this.logger.info('Admin analytics router mounted at /api/admin/users/analytics');

        // Public slim bootstrap — no auth, mints the analytics cookies and
        // emits one traffic_events row. A literal sub-path under /api/user
        // (sibling of identity's /api/user/wallets); no /:id catch remains.
        const bootstrapRouter: Router = createBootstrapRouter(this.bootstrapController);
        this.app.use('/api/user/bootstrap', bootstrapRouter);
        this.logger.info('Bootstrap router mounted at /api/user/bootstrap');

        // Public page-event ingestion — the client-side route-change beacon
        // posts here on every navigation. Same controller as bootstrap; emits a
        // `page` row keyed on the tid and attributed to the account when present.
        const pageEventRouter: Router = createPageEventRouter(this.bootstrapController);
        this.app.use('/api/user/track', pageEventRouter);
        this.logger.info('Page-event router mounted at /api/user/track');

        // Public redirect feed — no auth. The Next.js edge middleware polls this
        // server-to-server (before any auth context exists) to learn the active
        // legacy-URL redirect map, just like the public bootstrap ingestion.
        const publicRedirectsRouter: Router = createPublicRedirectsRouter(this.redirectsController);
        this.app.use('/api/redirects', publicRedirectsRouter);
        this.logger.info('Public redirect feed mounted at /api/redirects');

        // Admin redirect management. Distinct prefix from the identity module's
        // /api/admin/users catch-all, so ordering is not load-bearing here.
        const adminRedirectsRouter: Router = createAdminRedirectsRouter(this.redirectsController);
        this.app.use('/api/admin/redirects', requireAdmin, adminRedirectsRouter);
        this.logger.info('Admin redirects router mounted at /api/admin/redirects');

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
}
