/**
 * User module implementation (legacy UUID identity surface).
 *
 * Provides the legacy visitor-identity system: UUID cookie bootstrap,
 * preference/activity/session tracking, the public `/api/user` surface, and
 * the admin `/api/admin/users` analytics dashboard. Better Auth, wallet
 * linking, and group membership live in the {@link IdentityModule}; cookieless
 * traffic analytics, GSC, and bot classification live in the `TrafficModule`.
 * This module shrinks to the legacy bits and is removed entirely in the
 * Phase 6 cutover.
 *
 * The module follows TronRelic's two-phase initialization pattern with
 * dependency injection. It runs *after* the identity and traffic modules so it
 * can resolve the singletons the legacy surface still composes: the BA-keyed
 * `UserGroupService` (per-user group editor and auth-status response shaping)
 * and the `TrafficService` / `GscService` (its soon-to-be-dropped analytics
 * aggregations).
 */

import type { Express, Router } from 'express';
import type { ICacheService, IDatabaseService, IMenuService, IModule, IModuleMetadata, IServiceRegistry, ISystemConfigService } from '@/types';
import { logger } from '../../lib/logger.js';
import { MAIN_SYSTEM_CONTAINER_ID } from '../menu/index.js';
import { TronGridClient } from '../blockchain/tron-grid.client.js';
import { UserService } from './services/user.service.js';
import { GscService } from '../traffic/services/gsc.service.js';
import { TrafficService } from '../traffic/services/traffic.service.js';
import { TrafficController } from '../traffic/api/traffic.controller.js';
import { UserGroupService } from '../identity/services/user-group.service.js';
import { UserGroupController } from '../identity/api/user-group.controller.js';
import { UserController } from './api/user.controller.js';
import { createUserRouter, createAdminUserRouter } from './api/user.routes.js';
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

    /** Service registry for exposing UserService to plugins via late-binding DI. */
    serviceRegistry: IServiceRegistry;

    /**
     * System config service. UserService consults this when starting a session
     * to decide whether the browser-supplied `Referer` points to an external
     * origin or to our own site.
     */
    systemConfig: ISystemConfigService;
}

/**
 * Legacy user module for UUID visitor identity.
 *
 * ## Lifecycle
 *
 * ### init() phase:
 * - Stores injected dependencies
 * - Instantiates UserService singleton and creates indexes
 * - Resolves the traffic-owned GscService / TrafficService singletons and
 *   injects them into UserService for its legacy analytics aggregations
 * - Resolves the BA-keyed UserGroupService singleton (created by IdentityModule)
 * - Creates the user, group, and traffic controllers
 *
 * ### run() phase:
 * - Registers the Users menu item under the System container
 * - Registers UserService on the service registry as `'user'`
 * - Mounts the public `/api/user` and admin `/api/admin/users` routers
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
     * Creates the legacy UserService and resolves the traffic + identity
     * singletons the legacy surface still composes. Does NOT mount routes or
     * register menu items.
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
        this.serviceRegistry = dependencies.serviceRegistry;

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

        // Resolve the traffic-owned singletons. TrafficModule constructs both
        // during its init(), which runs before this module, so getInstance() is
        // safe here. UserService still leans on them for its legacy analytics
        // aggregations; this coupling is removed with the legacy surface in
        // Phase 6.
        this.gscService = GscService.getInstance();
        this.userService.setGscService(this.gscService);

        this.trafficService = TrafficService.getInstance();
        this.userService.setTrafficService(this.trafficService);

        // Resolve the BA-keyed UserGroupService singleton (created by
        // IdentityModule). Composed by the legacy admin surface for the
        // per-user group editor and auth-status response shaping.
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
        // `PUT /api/admin/users/:id/groups` membership editor in the legacy
        // admin tree.
        this.groupController = new UserGroupController(this.userGroupService, this.logger);

        // Traffic controller over the traffic-owned TrafficService, for the
        // `GET /api/admin/users/:id/traffic-history` read in the legacy admin tree.
        this.trafficController = new TrafficController(
            this.trafficService,
            this.gscService,
            this.serviceRegistry,
            this.logger
        );

        this.logger.info('User module initialized');
    }

    /**
     * Run the user module after all modules have initialized.
     *
     * Registers the Users menu item, publishes UserService, and mounts the
     * public and admin routers. The identity and traffic modules have already
     * mounted `/api/user/wallets`, `/api/admin/users/groups`, and
     * `/api/admin/users/traffic` ahead of these.
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

        // Mount the admin users router. The identity and traffic modules
        // mounted `/api/admin/users/groups` and `/api/admin/users/traffic`
        // ahead of this, so their specific paths win over `/:id`.
        const adminRouter = this.createAdminRouter();
        this.app.use('/api/admin/users', requireAdmin, adminRouter);
        this.logger.info('Admin users router mounted at /api/admin/users');

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
