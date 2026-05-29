/**
 * User module implementation (legacy UUID identity surface).
 *
 * Provides the legacy visitor-identity system: UUID cookie bootstrap,
 * preference/activity/session tracking, the public `/api/user` surface, and
 * the admin `/api/admin/users` analytics dashboard. Better Auth, wallet
 * linking, and group membership moved to the {@link IdentityModule}; cookieless
 * traffic analytics move to the traffic module. This module shrinks to the
 * legacy bits and is removed entirely in the Phase 6 cutover.
 *
 * The module follows TronRelic's two-phase initialization pattern with
 * dependency injection. It runs *after* {@link IdentityModule} so it can
 * resolve the BA-keyed `UserGroupService` singleton the legacy admin surface
 * still composes (the per-user group editor and auth-status response shaping).
 */

import type { Express, Router } from 'express';
import type { ICacheService, IClickHouseService, IDatabaseService, IMenuService, IModule, IModuleMetadata, ISchedulerService, IServiceRegistry, ISystemConfigService } from '@/types';
import { logger } from '../../lib/logger.js';
import { MAIN_SYSTEM_CONTAINER_ID } from '../menu/index.js';
import { TronGridClient } from '../blockchain/tron-grid.client.js';
import { UserService } from './services/user.service.js';
import { GscService } from './services/gsc.service.js';
import { TrafficService } from './services/traffic.service.js';
import { UserGroupService } from '../identity/services/user-group.service.js';
import { UserGroupController } from '../identity/api/user-group.controller.js';
import { initGeoIP } from './services/geo.service.js';
import { UserController } from './api/user.controller.js';
import { TrafficController } from './api/traffic.controller.js';
import { createUserRouter, createAdminUserRouter } from './api/user.routes.js';
import { createAdminTrafficRouter } from './api/traffic.routes.js';
import { requireAdmin } from '../../api/middleware/admin-auth.js';

/**
 * User module dependencies for initialization.
 */
export interface IUserModuleDependencies {
    /** Database service for MongoDB operations (legacy user storage). */
    database: IDatabaseService;

    /** Cache service for user data caching. */
    cacheService: ICacheService;

    /** Menu service for registering the /system/users navigation entry. */
    menuService: IMenuService;

    /** Express application instance for mounting routers (IoC). */
    app: Express;

    /**
     * Scheduler service for the daily GSC fetch job. Null when the scheduler
     * is disabled via ENABLE_SCHEDULER=false.
     */
    scheduler: ISchedulerService | null;

    /** Service registry for exposing UserService to plugins via late-binding DI. */
    serviceRegistry: IServiceRegistry;

    /**
     * System config service. UserService consults this when starting a session
     * to decide whether the browser-supplied `Referer` points to an external
     * origin or to our own site.
     */
    systemConfig: ISystemConfigService;

    /**
     * ClickHouse service for the TrafficService sibling. Optional — `undefined`
     * when `CLICKHOUSE_HOST` is unset. TrafficService stays usable in that mode
     * but silently drops writes; see traffic.service.ts.
     */
    clickhouse: IClickHouseService | undefined;
}

/**
 * Legacy user module for UUID visitor identity.
 *
 * ## Lifecycle
 *
 * ### init() phase:
 * - Stores injected dependencies
 * - Instantiates UserService singleton and creates indexes
 * - Instantiates GscService / TrafficService and injects them into UserService
 * - Resolves the BA-keyed UserGroupService singleton (created by IdentityModule)
 * - Creates the user, group, and traffic controllers
 *
 * ### run() phase:
 * - Registers the Users menu item under the System container
 * - Registers UserService on the service registry as `'user'`
 * - Mounts the public `/api/user` and admin `/api/admin/users[/traffic]` routers
 * - Registers the daily GSC fetch job
 */
export class UserModule implements IModule<IUserModuleDependencies> {
    /** Module metadata for introspection and logging. */
    readonly metadata: IModuleMetadata = {
        id: 'user',
        name: 'User',
        version: '1.0.0',
        description: 'Legacy visitor identity management and analytics dashboard'
    };

    /** Stored dependencies from init() phase. */
    private database!: IDatabaseService;
    private cacheService!: ICacheService;
    private menuService!: IMenuService;
    private app!: Express;
    private scheduler!: ISchedulerService | null;
    private serviceRegistry!: IServiceRegistry;

    /** Services created or resolved during init() phase. */
    private userService!: UserService;
    private gscService!: GscService;
    private trafficService!: TrafficService;
    private userGroupService!: UserGroupService;
    private controller!: UserController;
    private groupController!: UserGroupController;
    private trafficController!: TrafficController;

    /** Logger instance for this module. */
    private readonly logger = logger.child({ module: 'user' });

    /**
     * Initialize the user module with injected dependencies.
     *
     * Creates the legacy UserService and its analytics siblings, and resolves
     * the BA-keyed UserGroupService the legacy admin surface still composes.
     * Does NOT mount routes or register menu items.
     *
     * @param dependencies - All required services.
     * @throws {Error} If initialization fails (causes application shutdown).
     */
    async init(dependencies: IUserModuleDependencies): Promise<void> {
        this.logger.info('Initializing user module...');

        this.database = dependencies.database;
        this.cacheService = dependencies.cacheService;
        this.menuService = dependencies.menuService;
        this.app = dependencies.app;
        this.scheduler = dependencies.scheduler;
        this.serviceRegistry = dependencies.serviceRegistry;

        // Initialize GeoIP lookup for country detection (non-blocking).
        await initGeoIP();

        // Independent TronWeb instance for legacy wallet signature verification.
        const tronWeb = TronGridClient.getInstance().createTronWeb();

        // Initialize UserService singleton.
        UserService.setDependencies(
            this.database,
            this.cacheService,
            this.logger,
            dependencies.systemConfig,
            tronWeb
        );
        this.userService = UserService.getInstance();
        await this.userService.createIndexes();

        // Initialize GscService singleton and inject into UserService.
        GscService.setDependencies(this.database, this.cacheService, this.logger);
        this.gscService = GscService.getInstance();
        await this.gscService.createIndexes();
        this.userService.setGscService(this.gscService);

        // Initialize TrafficService sibling. ClickHouse is optional; when it's
        // undefined the service no-ops. See PLAN-traffic-events.md.
        TrafficService.setDependencies(dependencies.clickhouse, this.logger);
        this.trafficService = TrafficService.getInstance();
        this.userService.setTrafficService(this.trafficService);

        // Resolve the BA-keyed UserGroupService singleton. IdentityModule
        // constructs it during its init(), which runs before this module, so
        // getInstance() is safe here. The legacy admin surface composes it for
        // the per-user group editor and auth-status response shaping; this
        // coupling is removed with the legacy surface in Phase 6.
        this.userGroupService = UserGroupService.getInstance();

        // Create the user controller with its singleton services.
        this.controller = new UserController(
            this.userService,
            this.gscService,
            this.userGroupService,
            this.trafficService,
            this.logger
        );

        // Group controller over the identity-owned UserGroupService, for the
        // `PUT /api/admin/users/:id/groups` membership editor that lives in the
        // legacy user admin tree.
        this.groupController = new UserGroupController(this.userGroupService, this.logger);

        // Traffic controller for the admin dashboard ClickHouse reads.
        this.trafficController = new TrafficController(this.trafficService, this.logger);

        this.logger.info('User module initialized');
    }

    /**
     * Run the user module after all modules have initialized.
     *
     * Registers the Users menu item, publishes UserService, and mounts the
     * public and admin routers. The identity module has already mounted
     * `/api/user/wallets` and `/api/admin/users/groups` ahead of these.
     *
     * @throws {Error} If runtime setup fails (causes application shutdown).
     */
    async run(): Promise<void> {
        this.logger.info('Running user module...');

        // Register menu item under the System container in `main`.
        // `requiresAdmin: true` is auto-applied by MenuService.
        try {
            await this.menuService.create({
                namespace: 'main',
                label: 'Users',
                url: '/system/users',
                icon: 'Users',
                order: 75,
                parent: MAIN_SYSTEM_CONTAINER_ID,
                enabled: true
            });

            this.logger.info('Users menu item registered under the System container');
        } catch (error) {
            this.logger.error({ error }, 'Failed to register users menu item');
            throw new Error(`Failed to register users menu item: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }

        // Register UserService on the service registry so plugins can discover
        // it via context.services.get<IUserService>('user').
        this.serviceRegistry.register('user', this.userService);
        this.logger.info('UserService registered on service registry as "user"');

        // Create and mount the public router (IoC). The identity module mounted
        // `/api/user/wallets` ahead of this, so the literal segment wins.
        const publicRouter = this.createPublicRouter();
        this.app.use('/api/user', publicRouter);
        this.logger.info('Public user router mounted at /api/user');

        // Mount the admin traffic router before `/api/admin/users` so its
        // specific `/traffic/*` paths win over `/:id`.
        const adminTrafficRouter = createAdminTrafficRouter(this.trafficController);
        this.app.use('/api/admin/users/traffic', requireAdmin, adminTrafficRouter);
        this.logger.info('Admin traffic router mounted at /api/admin/users/traffic');

        // Mount the admin users router. The identity module mounted
        // `/api/admin/users/groups` ahead of this.
        const adminRouter = this.createAdminRouter();
        this.app.use('/api/admin/users', requireAdmin, adminRouter);
        this.logger.info('Admin users router mounted at /api/admin/users');

        // Register GSC fetch scheduled job (daily at 3 AM). SchedulerService
        // supports late registration.
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

        this.logger.info('User module running');
    }

    /**
     * Create the public router with cookie-validated endpoints.
     *
     * @returns Express router with public endpoints.
     * @internal
     */
    private createPublicRouter(): Router {
        return createUserRouter(this.controller);
    }

    /**
     * Create the admin router with authenticated endpoints.
     *
     * @returns Express router with admin endpoints.
     * @internal
     */
    private createAdminRouter(): Router {
        return createAdminUserRouter(this.controller, this.groupController, this.trafficController);
    }

    /**
     * Get the UserService singleton for external consumers.
     *
     * @returns UserService singleton instance.
     * @throws {Error} If called before init() completes.
     */
    getUserService(): UserService {
        if (!this.userService) {
            throw new Error('UserModule not initialized - call init() first');
        }
        return this.userService;
    }
}
