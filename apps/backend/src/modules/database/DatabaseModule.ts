/**
 * Database module implementation.
 *
 * Provides unified database access and migration system for all application components.
 * The module follows TronRelic's two-phase initialization pattern with dependency injection.
 *
 * This module consolidates two previously separate systems:
 * - DatabaseService (from services/database/database.service.ts)
 * - Migration system (from modules/migrations and services/database/migration/)
 *
 * Why this module exists:
 * - Centralizes database abstraction layer used by all other modules
 * - Provides migration system for schema evolution
 * - Ensures database is properly initialized before other modules depend on it
 * - Follows standardized IModule pattern for consistent lifecycle management
 */

import type { Express } from 'express';
import type { IModule, IModuleMetadata, ISystemLogService } from '@tronrelic/types';
import { DatabaseService } from './services/database.service.js';
import { MigrationsService } from './services/migrations.service.js';
import { MigrationsController } from './api/migrations.controller.js';
import { DatabaseBrowserRepository } from './repositories/database-browser.repository.js';
import { DatabaseBrowserController } from './api/database-browser.controller.js';
import { Router } from 'express';
import mongoSanitize from 'express-mongo-sanitize';

/**
 * Database module dependencies for initialization.
 *
 * The database module has minimal dependencies since it provides foundational
 * services that other modules depend on.
 */
export interface IDatabaseModuleDependencies {
    /**
     * System log service for logging database operations and migration events.
     * The basic logger singleton exists before any modules initialize.
     */
    logger: ISystemLogService;

    /**
     * Express application instance for mounting migration API routes.
     * The module will attach the migrations admin router using IoC pattern.
     */
    app: Express;
}

/**
 * Database module for unified database access and schema migrations.
 *
 * Implements the IModule interface to provide:
 * - Database abstraction layer (raw collections, Mongoose models, convenience methods)
 * - Key-value storage for simple configuration
 * - Migration system for schema evolution
 * - Admin API for migration management
 *
 * ## Lifecycle
 *
 * ### init() phase:
 * - Stores injected dependencies (Express app)
 * - Creates core DatabaseService instance (no prefix, used by system modules)
 * - Initializes migration system by scanning filesystem
 * - Creates MigrationsService and MigrationsController
 * - Does NOT mount routes yet
 *
 * ### run() phase:
 * - Creates and mounts migrations router at /api/admin/migrations
 * - Migration system is ready for execution via admin UI
 *
 * ## Inversion of Control
 *
 * The module uses IoC by injecting the Express app and mounting its own routes,
 * rather than returning routers for the bootstrap process to mount. This makes
 * the module responsible for its own integration.
 *
 * ## Public API
 *
 * Other modules access the database service through the module's getter method:
 * ```typescript
 * const databaseService = databaseModule.getDatabaseService();
 * await databaseService.findOne('collection', { filter });
 * ```
 *
 * @example
 * ```typescript
 * // In backend bootstrap (apps/backend/src/index.ts)
 * const databaseModule = new DatabaseModule();
 *
 * await databaseModule.init({
 *     app: app
 * });
 *
 * await databaseModule.run();
 *
 * // Other modules can now access the database service
 * const coreDatabase = databaseModule.getDatabaseService();
 * ```
 */
export class DatabaseModule implements IModule<IDatabaseModuleDependencies> {
    /**
     * Module metadata for introspection and logging.
     */
    readonly metadata: IModuleMetadata = {
        id: 'database',
        name: 'Database',
        version: '1.0.0',
        description: 'Unified database access and migration system for all application components'
    };

    /**
     * Stored dependencies from init() phase.
     */
    private logger!: ISystemLogService;
    private app!: Express;

    /**
     * Core database service instance (no prefix).
     * This is the primary database service used by system modules and core services.
     */
    private databaseService!: DatabaseService;

    /**
     * Services created during init() phase.
     */
    private migrationsService!: MigrationsService;
    private migrationsController!: MigrationsController;

    /**
     * Database browser components created during init() phase.
     */
    private browserRepository!: DatabaseBrowserRepository;
    private browserController!: DatabaseBrowserController;

    /**
     * Initialize the database module with injected dependencies.
     *
     * This phase prepares the module by creating the core DatabaseService instance,
     * initializing the migration system, and preparing migration management services.
     * It does NOT mount routes yet.
     *
     * @param dependencies - Express application for route mounting
     * @throws {Error} If initialization fails (causes application shutdown)
     */
    async init(dependencies: IDatabaseModuleDependencies): Promise<void> {
        // Store dependencies for use in run() phase
        this.logger = dependencies.logger.child({ module: 'database' });
        this.app = dependencies.app;

        this.logger.info('Initializing database module...');

        // Create core database service (no prefix for system collections)
        this.databaseService = new DatabaseService(this.logger);
        this.logger.info('Core DatabaseService instance created');

        // Initialize migration system by scanning filesystem
        this.logger.info('Initializing database migration system...');
        try {
            await this.databaseService.initializeMigrations();
            this.logger.info('Database migration system initialized');
        } catch (migrationError) {
            this.logger.error(
                {
                    error: migrationError,
                    stack: migrationError instanceof Error ? migrationError.stack : undefined
                },
                'Migration system initialization failed'
            );
            // Continue startup - migration system failure should not prevent app from running
            // Admin can still access migration UI to diagnose issues
        }

        // Create migrations service and controller
        this.migrationsService = new MigrationsService(this.databaseService, this.logger);
        this.migrationsController = new MigrationsController(this.databaseService, this.logger);

        // Create database browser repository and controller
        // Import mongoose to access connection
        const { default: mongoose } = await import('mongoose');
        this.browserRepository = new DatabaseBrowserRepository(mongoose.connection, this.logger);
        this.browserController = new DatabaseBrowserController(this.browserRepository, this.logger);

        this.logger.info('Database module initialized');
    }

    /**
     * Run the database module after all modules have initialized.
     *
     * This phase activates the module by:
     * - Registering menu item in 'system' namespace
     * - Mounting the migrations admin router
     *
     * By this point, all dependencies are guaranteed to be initialized and ready.
     */
    async run(): Promise<void> {
        this.logger.info('Running database module...');

        // Register menu item in 'system' namespace
        // Use dynamic import to avoid circular dependencies and ensure MenuService is initialized
        try {
            const { MenuService } = await import('../menu/index.js');
            const menuService = MenuService.getInstance();

            await menuService.create({
                namespace: 'system',
                label: 'Database',
                url: '/system/database',
                icon: 'Database',
                order: 20,
                parent: null,
                enabled: true
                // persist defaults to false (memory-only entry)
            });

            this.logger.info('Database menu item registered in system namespace');
        } catch (error) {
            this.logger.error({ error }, 'Failed to register database menu item');
            throw new Error(`Failed to register database menu item: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }

        // Create and mount migrations router (IoC - module attaches itself to app)
        const migrationsRouter = this.createMigrationsRouter();
        this.app.use('/api/admin/migrations', migrationsRouter);
        this.logger.info('Migrations router mounted at /api/admin/migrations');

        // Create and mount database browser router
        const browserRouter = this.createBrowserRouter();
        this.app.use('/api/admin/database', browserRouter);
        this.logger.info('Database browser router mounted at /api/admin/database');

        this.logger.info('Database module running');
    }

    /**
     * Create the migrations router with all endpoints.
     *
     * This is an internal helper method called during the run() phase.
     * All routes require admin authentication (enforced by parent router).
     *
     * @returns Express router with migration management endpoints
     */
    private createMigrationsRouter(): Router {
        const router = Router();

        // GET /api/admin/migrations/status
        router.get('/status', (req, res) => this.migrationsController.getStatus(req, res));

        // GET /api/admin/migrations/history
        router.get('/history', (req, res) => this.migrationsController.getHistory(req, res));

        // POST /api/admin/migrations/execute
        router.post('/execute', (req, res) => this.migrationsController.execute(req, res));

        // GET /api/admin/migrations/:id
        router.get('/:id', (req, res) => this.migrationsController.getDetails(req, res));

        return router;
    }

    /**
     * Get the core database service instance.
     *
     * Returns the primary DatabaseService instance (no collection prefix) for use
     * by system modules and core services. This service provides:
     * - Raw collection access via getCollection()
     * - Mongoose model registry
     * - Convenience methods (find, findOne, count, etc.)
     * - Key-value storage
     * - Index creation
     *
     * @returns Core DatabaseService instance
     * @throws {Error} If called before init() completes
     *
     * @example
     * ```typescript
     * const coreDatabase = databaseModule.getDatabaseService();
     * const collection = coreDatabase.getCollection('system_config');
     * const config = await coreDatabase.findOne('system_config', { key: 'system' });
     * ```
     */
    public getDatabaseService(): DatabaseService {
        if (!this.databaseService) {
            throw new Error('DatabaseModule not initialized. Call init() first.');
        }
        return this.databaseService;
    }

    /**
     * Get the migrations service instance.
     *
     * Returns the MigrationsService for programmatic migration management.
     * Typically used by admin UI or custom scripts, not by other modules.
     *
     * @returns MigrationsService instance
     * @throws {Error} If called before init() completes
     */
    public getMigrationsService(): MigrationsService {
        if (!this.migrationsService) {
            throw new Error('DatabaseModule not initialized. Call init() first.');
        }
        return this.migrationsService;
    }

    /**
     * Create the database browser router with all endpoints.
     *
     * This is an internal helper method called during the run() phase.
     * All routes require admin authentication (enforced by parent router).
     *
     * Applies express-mongo-sanitize middleware to prevent MongoDB injection attacks
     * by stripping $ and . characters from request bodies and query parameters.
     *
     * @returns Express router with database browser endpoints
     */
    private createBrowserRouter(): Router {
        const router = Router();

        // Apply MongoDB injection protection to all routes
        router.use(mongoSanitize({
            replaceWith: '_'  // Replace $ and . with _ instead of removing
        }));

        // GET /api/admin/database/stats
        router.get('/stats', (req, res) => this.browserController.getStats(req, res));

        // GET /api/admin/database/collections/:name/documents
        router.get('/collections/:name/documents', (req, res) =>
            this.browserController.getDocuments(req, res)
        );

        // POST /api/admin/database/collections/:name/query
        router.post('/collections/:name/query', (req, res) =>
            this.browserController.queryDocuments(req, res)
        );

        return router;
    }
}
