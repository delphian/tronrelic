/**
 * User module implementation.
 *
 * Provides visitor identity management, wallet linking, and preference tracking.
 * The module follows TronRelic's two-phase initialization pattern with dependency
 * injection.
 *
 * ## Design Decisions
 *
 * **Anonymous-first identity**: Users start with client-generated UUIDs stored
 * in cookies/localStorage. No registration required.
 *
 * **Multi-wallet support**: One UUID can link to multiple TRON addresses,
 * enabling unified identity across wallets.
 *
 * **Cookie-based authentication**: Public endpoints require cookie validation
 * to ensure users can only access their own data.
 *
 * ## Future Extensibility
 *
 * If plugins need access to user data, create `IUserService` in `@/types`
 * and expose via `IPluginContext`. The `IUserDocument` stays internal to this module.
 */

import type { Express, Router } from 'express';
import type { ICacheService, IClickHouseService, IDatabaseService, IMenuService, IModule, IModuleMetadata, ISchedulerService, IServiceRegistry, ISystemConfigService } from '@/types';
import { logger } from '../../lib/logger.js';
import { MAIN_SYSTEM_CONTAINER_ID } from '../menu/index.js';
import { TronGridClient } from '../blockchain/tron-grid.client.js';
import { UserService } from './services/user.service.js';
import { GscService } from './services/gsc.service.js';
import { TrafficService } from './services/traffic.service.js';
import { UserGroupService } from './services/user-group.service.js';
import { initGeoIP } from './services/geo.service.js';
import { UserController } from './api/user.controller.js';
import { UserGroupController } from './api/user-group.controller.js';
import { createUserRouter, createAdminUserRouter, createProfileRouter } from './api/user.routes.js';
import { createAdminUserGroupRouter } from './api/user-group.routes.js';
import { requireAdmin } from '../../api/middleware/admin-auth.js';

/**
 * User module dependencies for initialization.
 *
 * All required services for the user module to function properly, injected
 * at application bootstrap time.
 */
export interface IUserModuleDependencies {
    /**
     * Database service for MongoDB operations (user storage).
     */
    database: IDatabaseService;

    /**
     * Cache service for user data caching.
     */
    cacheService: ICacheService;

    /**
     * Menu service for registering /system/users navigation entry.
     */
    menuService: IMenuService;

    /**
     * Express application instance for mounting routers.
     * The module will attach its public and admin routers using IoC pattern.
     */
    app: Express;

    /**
     * Scheduler service for registering the daily GSC fetch job.
     * Null when the scheduler is disabled via ENABLE_SCHEDULER=false.
     */
    scheduler: ISchedulerService | null;

    /**
     * Service registry for exposing UserService to plugins via late-binding DI.
     * Plugins discover the user service with context.services.get('user').
     */
    serviceRegistry: IServiceRegistry;

    /**
     * System config service. UserService consults this when starting a
     * session to decide whether the browser-supplied `Referer` header points
     * to an external origin or to our own site.
     */
    systemConfig: ISystemConfigService;

    /**
     * ClickHouse service for the new TrafficService sibling. Optional —
     * `undefined` when `CLICKHOUSE_HOST` is unset and the ClickHouse
     * module skipped initialization. TrafficService stays usable in
     * that mode but silently drops writes; see traffic.service.ts.
     * Backs the cookieless-traffic split tracked in PLAN-traffic-events.md.
     */
    clickhouse: IClickHouseService | undefined;
}

/**
 * User module for visitor identity and wallet linking.
 *
 * Implements the IModule interface to provide:
 * - Anonymous visitor identity via UUID
 * - Wallet linking with TronLink signature verification
 * - Preference storage and activity tracking
 * - Admin interface for user management
 *
 * ## Lifecycle
 *
 * ### init() phase:
 * - Stores injected dependencies (database, cache, menu service, app)
 * - Instantiates UserService singleton
 * - Creates database indexes
 * - Creates UserController
 * - Does NOT mount routes or register menu items yet
 *
 * ### run() phase:
 * - Registers menu item in 'system' namespace for admin UI
 * - Creates and mounts public router at /api/user
 * - Creates and mounts admin router at /api/admin/users
 *
 * ## Inversion of Control
 *
 * The module uses IoC by injecting the Express app and mounting its own routes,
 * rather than returning routers for the bootstrap process to mount. This makes
 * the module responsible for its own integration.
 *
 * @example
 * ```typescript
 * // In backend bootstrap (apps/backend/src/index.ts)
 * const userModule = new UserModule();
 *
 * await userModule.init({
 *     database: coreDatabase,
 *     cacheService: cacheService,
 *     menuService: MenuService.getInstance(),
 *     app: app,
 *     scheduler: schedulerModule.getSchedulerService()
 * });
 *
 * await userModule.run();
 * ```
 */
export class UserModule implements IModule<IUserModuleDependencies> {
    /**
     * Module metadata for introspection and logging.
     */
    readonly metadata: IModuleMetadata = {
        id: 'user',
        name: 'User',
        version: '1.0.0',
        description: 'Visitor identity management and wallet linking'
    };

    /**
     * Stored dependencies from init() phase.
     */
    private database!: IDatabaseService;
    private cacheService!: ICacheService;
    private menuService!: IMenuService;
    private app!: Express;
    private scheduler!: ISchedulerService | null;
    private serviceRegistry!: IServiceRegistry;

    /**
     * Services created during init() phase.
     */
    private userService!: UserService;
    private gscService!: GscService;
    private trafficService!: TrafficService;
    private userGroupService!: UserGroupService;
    private controller!: UserController;
    private groupController!: UserGroupController;

    /**
     * Logger instance for this module.
     */
    private readonly logger = logger.child({ module: 'user' });

    /**
     * Initialize the user module with injected dependencies.
     *
     * This phase prepares the module by creating service instances and storing
     * dependencies for use in the run() phase. It does NOT mount routes or
     * register menu items yet.
     *
     * @param dependencies - All required services (database, cache, menu, app)
     * @throws {Error} If initialization fails (causes application shutdown)
     */
    async init(dependencies: IUserModuleDependencies): Promise<void> {
        this.logger.info('Initializing user module...');

        // Store dependencies for use in run() phase
        this.database = dependencies.database;
        this.cacheService = dependencies.cacheService;
        this.menuService = dependencies.menuService;
        this.app = dependencies.app;
        this.scheduler = dependencies.scheduler;
        this.serviceRegistry = dependencies.serviceRegistry;

        // Initialize GeoIP lookup for country detection (non-blocking)
        await initGeoIP();

        // Create independent TronWeb instance for signature verification
        const tronWeb = TronGridClient.getInstance().createTronWeb();

        // Initialize UserService singleton with dependencies
        UserService.setDependencies(
            this.database,
            this.cacheService,
            this.logger,
            dependencies.systemConfig,
            tronWeb
        );

        // Get UserService singleton instance
        this.userService = UserService.getInstance();

        // Create database indexes
        await this.userService.createIndexes();

        // Initialize GscService singleton with dependencies
        GscService.setDependencies(
            this.database,
            this.cacheService,
            this.logger
        );
        this.gscService = GscService.getInstance();
        await this.gscService.createIndexes();

        // Inject GscService into UserService for explicit dependency
        this.userService.setGscService(this.gscService);

        // Initialize TrafficService sibling. ClickHouse is optional;
        // when it's undefined the service no-ops and the orphan-row
        // fix in later phases still works (Mongo writes are gated
        // independently). See PLAN-traffic-events.md.
        TrafficService.setDependencies(dependencies.clickhouse, this.logger);
        this.trafficService = TrafficService.getInstance();

        // Initialize UserGroupService singleton, build indexes, seed system groups.
        // Must precede UserController construction so the controller can inject
        // it for `withAuthStatus` response shaping — keeps the cross-tier
        // admin predicate (middleware, controller, frontend) in one place.
        UserGroupService.setDependencies(this.database, this.cacheService, this.logger);
        this.userGroupService = UserGroupService.getInstance();
        await this.userGroupService.createIndexes();
        await this.userGroupService.seedSystemGroups();

        // Create controller with singleton services
        this.controller = new UserController(this.userService, this.gscService, this.userGroupService, this.logger);

        // Create group controller with singleton service
        this.groupController = new UserGroupController(this.userGroupService, this.logger);

        this.logger.info('User module initialized');
    }

    /**
     * Run the user module after all modules have initialized.
     *
     * This phase activates the module by:
     * - Registering menu item under the System container (admin subtree of `main`)
     * - Creating and mounting public router
     * - Creating and mounting admin router
     *
     * By this point, MenuService is guaranteed to be ready (no need for 'ready' event).
     *
     * @throws {Error} If runtime setup fails (causes application shutdown)
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
                // persist defaults to false (memory-only entry)
            });

            this.logger.info('Users menu item registered under the System container');
        } catch (error) {
            this.logger.error({ error }, 'Failed to register users menu item');
            throw new Error(`Failed to register users menu item: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }

        // Register UserService on the service registry so plugins can discover
        // it via context.services.get<IUserService>('user') for aggregate stats
        // and user lookups without direct module coupling.
        this.serviceRegistry.register('user', this.userService);
        this.logger.info('UserService registered on service registry as "user"');

        // Register UserGroupService for plugin permission gating. Plugins
        // discover it via context.services.get<IUserGroupService>('user-groups').
        this.serviceRegistry.register('user-groups', this.userGroupService);
        this.logger.info('UserGroupService registered on service registry as "user-groups"');

        // Create and mount public router (IoC - module attaches itself to app)
        const publicRouter = this.createPublicRouter();
        this.app.use('/api/user', publicRouter);
        this.logger.info('Public user router mounted at /api/user');

        // Create and mount profile router (IoC - public access, no auth required)
        const profileRouter = this.createProfileRouter();
        this.app.use('/api/profile', profileRouter);
        this.logger.info('Profile router mounted at /api/profile');

        // Create and mount admin router (IoC - module attaches itself to app)
        // Apply requireAdmin middleware to all admin routes.
        // Note: the user-groups router is mounted FIRST under the same prefix
        // so its specific paths (/groups, /groups/:id) win over /:id, which
        // would otherwise treat 'groups' as a user UUID.
        const adminGroupRouter = createAdminUserGroupRouter(this.groupController);
        this.app.use('/api/admin/users/groups', requireAdmin, adminGroupRouter);
        this.logger.info('Admin user-groups router mounted at /api/admin/users/groups');

        const adminRouter = this.createAdminRouter();
        this.app.use('/api/admin/users', requireAdmin, adminRouter);
        this.logger.info('Admin users router mounted at /api/admin/users');

        // Register GSC fetch scheduled job (daily at 3 AM).
        // SchedulerService supports late registration — if the scheduler
        // has already started, the job schedules immediately.
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
     * This is an internal helper method called during the run() phase.
     * The router is then mounted by the module itself using IoC pattern.
     *
     * @returns Express router with public endpoints
     * @internal
     */
    private createPublicRouter(): Router {
        return createUserRouter(this.controller);
    }

    /**
     * Create the profile router for public profile access.
     *
     * No authentication required - publicly accessible profile pages.
     * The router is then mounted by the module itself using IoC pattern.
     *
     * @returns Express router with profile endpoints
     * @internal
     */
    private createProfileRouter(): Router {
        return createProfileRouter(this.controller);
    }

    /**
     * Create the admin router with authenticated endpoints.
     *
     * This is an internal helper method called during the run() phase.
     * The router is then mounted by the module itself using IoC pattern.
     *
     * @returns Express router with admin endpoints
     * @internal
     */
    private createAdminRouter(): Router {
        return createAdminUserRouter(this.controller, this.groupController);
    }

    /**
     * Get the UserService singleton instance for external consumers.
     *
     * This allows other modules and plugins to access the UserService after
     * the module has been initialized. Should only be called after init()
     * completes successfully.
     *
     * @returns UserService singleton instance
     * @throws {Error} If called before init() completes
     */
    getUserService(): UserService {
        if (!this.userService) {
            throw new Error('UserModule not initialized - call init() first');
        }
        return this.userService;
    }
}
