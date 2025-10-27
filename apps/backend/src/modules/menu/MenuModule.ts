/**
 * Menu module implementation.
 *
 * Provides centralized control over TronRelic's hierarchical menu system with
 * event-driven validation, real-time WebSocket updates, and in-memory caching
 * for fast tree access. The module follows TronRelic's two-phase initialization
 * pattern with dependency injection.
 *
 * Note: MenuService remains a singleton to maintain shared in-memory state across
 * all consumers. The module wraps initialization and route mounting following the
 * IModule pattern.
 */

import type { Express, Router } from 'express';
import type { IDatabaseService, IModule, IModuleMetadata } from '@tronrelic/types';
import { logger } from '../../lib/logger.js';
import { MenuService } from './menu.service.js';
import { MenuController } from './menu.controller.js';
import { Router as ExpressRouter } from 'express';
import { requireAdmin } from '../../api/middleware/admin-auth.js';

/**
 * Menu module dependencies for initialization.
 *
 * All required services for the menu module to function properly, injected
 * at application bootstrap time.
 */
export interface IMenuModuleDependencies {
    /**
     * Database service for MongoDB operations (menu node storage).
     */
    database: IDatabaseService;

    /**
     * Express application instance for mounting routers.
     * The module will attach its admin router using IoC pattern.
     */
    app: Express;
}

/**
 * Menu module for navigation system management.
 *
 * Implements the IModule interface to provide:
 * - Centralized menu state management with singleton service
 * - CRUD operations for menu nodes with event-driven validation
 * - Real-time WebSocket updates to connected clients
 * - Hierarchical tree structure with namespace isolation
 * - Admin API endpoints for menu management
 *
 * ## Lifecycle
 *
 * ### init() phase:
 * - Stores injected dependencies (database, app)
 * - Initializes MenuService singleton with database dependency
 * - Loads menu tree from database
 * - Instantiates MenuController with service injection
 * - Does NOT mount routes yet
 *
 * ### run() phase:
 * - Creates admin router with all endpoints
 * - Mounts router at /api/menu
 *
 * ## Inversion of Control
 *
 * The module uses IoC by injecting the Express app and mounting its own routes,
 * rather than returning routers for the bootstrap process to mount. This makes
 * the module responsible for its own integration.
 *
 * ## Singleton Pattern
 *
 * MenuService remains a singleton to maintain shared in-memory state (menu tree)
 * accessible to all modules and plugins. The MenuModule manages singleton initialization
 * and exposes getMenuService() for external access.
 *
 * @example
 * ```typescript
 * // In backend bootstrap (apps/backend/src/index.ts)
 * const menuModule = new MenuModule();
 *
 * await menuModule.init({
 *     database: coreDatabase,
 *     app: app
 * });
 *
 * await menuModule.run();
 *
 * // Access MenuService for other modules
 * const menuService = menuModule.getMenuService();
 * ```
 */
export class MenuModule implements IModule<IMenuModuleDependencies> {
    /**
     * Module metadata for introspection and logging.
     */
    readonly metadata: IModuleMetadata = {
        id: 'menu',
        name: 'Menu Service',
        version: '1.0.0',
        description: 'Hierarchical navigation system with event-driven validation and real-time updates'
    };

    /**
     * Stored dependencies from init() phase.
     */
    private database!: IDatabaseService;
    private app!: Express;

    /**
     * Services created during init() phase.
     */
    private menuService!: MenuService;
    private controller!: MenuController;

    /**
     * Logger instance for this module.
     */
    private readonly logger = logger.child({ module: 'menu' });

    /**
     * Initialize the menu module with injected dependencies.
     *
     * This phase prepares the module by initializing the MenuService singleton
     * and loading the menu tree from the database. It does NOT mount routes yet.
     *
     * @param dependencies - All required services (database, app)
     * @throws {Error} If initialization fails (causes application shutdown)
     */
    async init(dependencies: IMenuModuleDependencies): Promise<void> {
        this.logger.info('Initializing menu module...');

        // Store dependencies for use in run() phase
        this.database = dependencies.database;
        this.app = dependencies.app;

        // Initialize MenuService singleton with database dependency
        MenuService.setDatabase(this.database);
        this.menuService = MenuService.getInstance();

        // Initialize MenuService (loads menu tree from database)
        await this.menuService.initialize();

        // Create controller with MenuService injection
        this.controller = new MenuController(this.menuService);

        this.logger.info('Menu module initialized');
    }

    /**
     * Run the menu module after all modules have initialized.
     *
     * This phase activates the module by creating and mounting the admin router.
     * By this point, all dependencies are guaranteed to be ready.
     *
     * @throws {Error} If runtime setup fails (causes application shutdown)
     */
    async run(): Promise<void> {
        this.logger.info('Running menu module...');

        // Create and mount admin router (IoC - module attaches itself to app)
        const router = this.createRouter();
        this.app.use('/api/menu', router);
        this.logger.info('Menu router mounted at /api/menu');

        this.logger.info('Menu module running');
    }

    /**
     * Create the admin router with all authenticated endpoints.
     *
     * This is an internal helper method called during the run() phase.
     * The router is then mounted by the module itself using IoC pattern.
     *
     * Routes:
     * - GET    /api/menu              - Get complete menu tree (public, no auth)
     * - GET    /api/menu/namespaces   - Get all available menu namespaces (public, no auth)
     * - POST   /api/menu              - Create new menu node (requires admin auth)
     * - PATCH  /api/menu/:id          - Update existing menu node (requires admin auth)
     * - DELETE /api/menu/:id          - Delete menu node (requires admin auth)
     *
     * @returns Express router with menu endpoints
     * @internal
     */
    private createRouter(): Router {
        const router = ExpressRouter();

        // Public routes (no auth required for reading navigation structure)
        router.get('/namespaces', this.controller.getNamespaces);
        router.get('/', this.controller.getTree);

        // Admin-only routes (mutating operations require authentication)
        router.post('/', requireAdmin, this.controller.create);
        router.patch('/:id', requireAdmin, this.controller.update);
        router.delete('/:id', requireAdmin, this.controller.delete);

        return router;
    }

    /**
     * Get the MenuService singleton instance for external consumers.
     *
     * This allows other modules and plugins to access the MenuService after
     * the module has been initialized. Should only be called after init()
     * completes successfully.
     *
     * @returns MenuService singleton instance
     * @throws {Error} If called before init() completes
     */
    getMenuService(): MenuService {
        if (!this.menuService) {
            throw new Error('MenuModule not initialized - call init() first');
        }
        return this.menuService;
    }
}
