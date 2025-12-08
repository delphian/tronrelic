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
 * If plugins need access to user data, create `IUserService` in `@tronrelic/types`
 * and expose via `IPluginContext`. The `IUserDocument` stays internal to this module.
 */

import type { Express, Router } from 'express';
import type { ICacheService, IDatabaseService, IMenuService, IModule, IModuleMetadata } from '@tronrelic/types';
import { logger } from '../../lib/logger.js';
import { UserService } from './services/user.service.js';
import { initGeoIP } from './services/geo.service.js';
import { UserController } from './api/user.controller.js';
import { createUserRouter, createAdminUserRouter, createProfileRouter } from './api/user.routes.js';
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
 *     app: app
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

    /**
     * Services created during init() phase.
     */
    private userService!: UserService;
    private controller!: UserController;

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

        // Initialize GeoIP lookup for country detection (non-blocking)
        await initGeoIP();

        // Initialize UserService singleton with dependencies
        UserService.setDependencies(
            this.database,
            this.cacheService,
            this.logger
        );

        // Get UserService singleton instance
        this.userService = UserService.getInstance();

        // Create database indexes
        await this.userService.createIndexes();

        // Create controller with singleton service
        this.controller = new UserController(this.userService, this.logger);

        this.logger.info('User module initialized');
    }

    /**
     * Run the user module after all modules have initialized.
     *
     * This phase activates the module by:
     * - Registering menu item in 'system' namespace
     * - Creating and mounting public router
     * - Creating and mounting admin router
     *
     * By this point, MenuService is guaranteed to be ready (no need for 'ready' event).
     *
     * @throws {Error} If runtime setup fails (causes application shutdown)
     */
    async run(): Promise<void> {
        this.logger.info('Running user module...');

        // Register menu item in 'system' namespace
        try {
            await this.menuService.create({
                namespace: 'system',
                label: 'Users',
                url: '/system/users',
                icon: 'Users',
                order: 75,
                parent: null,
                enabled: true
                // persist defaults to false (memory-only entry)
            });

            this.logger.info('Users menu item registered in system namespace');
        } catch (error) {
            this.logger.error({ error }, 'Failed to register users menu item');
            throw new Error(`Failed to register users menu item: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }

        // Create and mount public router (IoC - module attaches itself to app)
        const publicRouter = this.createPublicRouter();
        this.app.use('/api/user', publicRouter);
        this.logger.info('Public user router mounted at /api/user');

        // Create and mount profile router (IoC - public access, no auth required)
        const profileRouter = this.createProfileRouter();
        this.app.use('/api/profile', profileRouter);
        this.logger.info('Profile router mounted at /api/profile');

        // Create and mount admin router (IoC - module attaches itself to app)
        // Apply requireAdmin middleware to all admin routes
        const adminRouter = this.createAdminRouter();
        this.app.use('/api/admin/users', requireAdmin, adminRouter);
        this.logger.info('Admin users router mounted at /api/admin/users');

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
        return createAdminUserRouter(this.controller);
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
