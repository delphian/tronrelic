/**
 * Logs module implementation.
 *
 * Provides unified logging with MongoDB persistence and log management APIs.
 * The module follows TronRelic's two-phase initialization pattern with dependency injection.
 *
 * **Architecture:**
 *
 * This module wraps the SystemLogService singleton, which serves dual purposes:
 * 1. Application logger - Used throughout the codebase via logger import
 * 2. MongoDB storage - Automatically persists logs based on configured level
 *
 * **Why this module exists:**
 *
 * System logs were previously scattered across services/ without following the module
 * pattern. Refactoring into a module provides:
 * - Explicit lifecycle management (init/run phases)
 * - Dependency injection for database and Pino logger
 * - Inversion of Control for route mounting
 * - Standardized architecture consistent with other modules
 *
 * **Critical initialization timing:**
 *
 * Unlike other modules, the logs module must initialize VERY EARLY in bootstrap
 * because the logger is used by all subsequent initialization steps. The module's
 * init() is called immediately after database connection, before any other services.
 */

import type { Express } from 'express';
import type { IDatabaseService, IModule, IModuleMetadata } from '@tronrelic/types';
import type pino from 'pino';
import { logger } from '../../lib/logger.js';
import { SystemLogService } from './services/system-log.service.js';
import { SystemLogController } from './api/system-log.controller.js';
import { createSystemLogRouter } from './api/system-log.router.js';
import type { Router } from 'express';

/**
 * Logs module dependencies for initialization.
 *
 * All required services for the logs module to function properly, injected
 * at application bootstrap time.
 */
export interface ILogsModuleDependencies {
    /**
     * Pino logger instance for file/console output.
     *
     * The SystemLogService wraps this logger to add MongoDB persistence based
     * on configured log level. Must be provided during init() to enable logging.
     */
    pinoLogger: pino.Logger;

    /**
     * Database service for MongoDB operations (log storage, queries, cleanup).
     *
     * Used by SystemLogService for persisting logs and by controllers for
     * querying/filtering logs via admin API.
     */
    database: IDatabaseService;

    /**
     * Express application instance for mounting log management routers.
     * The module will attach its admin router using IoC pattern.
     */
    app: Express;
}

/**
 * Logs module for system-wide logging and log management.
 *
 * Implements the IModule interface to provide:
 * - Unified logging interface (trace, debug, info, warn, error, fatal)
 * - Automatic MongoDB persistence based on configured log level
 * - Admin API for querying, filtering, resolving, and deleting logs
 * - Log level configuration via SystemConfig
 *
 * ## Lifecycle
 *
 * ### init() phase:
 * - Stores injected dependencies (Pino logger, database, app)
 * - Initializes SystemLogService singleton with Pino logger
 * - Applies log level from SystemConfig
 * - Creates SystemLogController instance
 * - Does NOT mount routes yet
 *
 * ### run() phase:
 * - Creates log management router
 * - Mounts router at /api/admin/system/logs
 *
 * ## Singleton Pattern
 *
 * SystemLogService follows the singleton pattern to ensure consistent logging
 * behavior across the entire application. All code imports `logger` from
 * `lib/logger.js`, which returns the singleton instance. The module's init()
 * configures this singleton with the Pino logger and database dependencies.
 *
 * ## Inversion of Control
 *
 * The module uses IoC by injecting the Express app and mounting its own routes,
 * rather than returning routers for the bootstrap process to mount. However,
 * the routes are NOT mounted to the app directly - they are mounted to the
 * system router which is then mounted by the Express loader. This matches
 * the existing pattern where system log routes live at `/api/admin/system/logs`.
 *
 * @example
 * ```typescript
 * // In backend bootstrap (apps/backend/src/index.ts)
 * const logsModule = new LogsModule();
 *
 * const pinoLogger = createLogger();
 * const coreDatabase = new DatabaseService();
 *
 * await logsModule.init({
 *     pinoLogger,
 *     database: coreDatabase,
 *     app: app
 * });
 *
 * await logsModule.run();
 * ```
 */
export class LogsModule implements IModule<ILogsModuleDependencies> {
    /**
     * Module metadata for introspection and logging.
     */
    readonly metadata: IModuleMetadata = {
        id: 'logs',
        name: 'Logs',
        version: '1.0.0',
        description: 'Unified logging with MongoDB persistence and log management APIs'
    };

    /**
     * Stored dependencies from init() phase.
     */
    private pinoLogger!: pino.Logger;
    private database!: IDatabaseService;
    private app!: Express;

    /**
     * Services created during init() phase.
     */
    private logService!: SystemLogService;
    private controller!: SystemLogController;

    /**
     * Logger instance for this module.
     *
     * Note: This uses the global logger singleton. Before init() completes,
     * this will fall back to console output. After init(), it will use the
     * configured Pino logger with MongoDB persistence.
     */
    private readonly logger = logger.child({ module: 'logs' });

    /**
     * Initialize the logs module with injected dependencies.
     *
     * This phase prepares the module by configuring the SystemLogService singleton
     * and creating controller instances. It does NOT mount routes yet.
     *
     * **Critical timing:**
     *
     * This init() must be called VERY EARLY in bootstrap, immediately after database
     * connection, because the logger is used by all subsequent initialization steps.
     *
     * @param dependencies - All required services (pinoLogger, database, app)
     * @throws {Error} If initialization fails (causes application shutdown)
     */
    async init(dependencies: ILogsModuleDependencies): Promise<void> {
        // Use console.log here since logger is not yet initialized
        console.log('[logs] Initializing logs module...');

        // Store dependencies for use in run() phase
        this.pinoLogger = dependencies.pinoLogger;
        this.database = dependencies.database;
        this.app = dependencies.app;

        // Initialize SystemLogService singleton with Pino logger
        // After this, all logger.info/warn/error calls will save to MongoDB
        this.logService = SystemLogService.getInstance();
        await this.logService.initialize(this.pinoLogger);

        // Now we can use the logger (it's initialized)
        this.logger.info('SystemLogService initialized with MongoDB persistence');

        // Create controller with singleton service
        this.controller = new SystemLogController(this.logService);

        this.logger.info('Logs module initialized');
    }

    /**
     * Run the logs module after all modules have initialized.
     *
     * This phase activates the module by:
     * - Registering menu item in 'system' namespace
     * - Log management router is mounted by system router at /api/admin/system/logs
     *
     * **Note:** The system router is created in express loader and mounts this
     * router. We don't mount directly to app here because system logs are part
     * of the /api/admin/system namespace.
     *
     * @throws {Error} If runtime setup fails (causes application shutdown)
     */
    async run(): Promise<void> {
        this.logger.info('Running logs module...');

        // Register menu item in 'system' namespace
        // Use dynamic import to avoid circular dependencies and ensure MenuService is initialized
        try {
            const { MenuService } = await import('../menu/index.js');
            const menuService = MenuService.getInstance();

            await menuService.create({
                namespace: 'system',
                label: 'Logs',
                url: '/system/logs',
                icon: 'ScrollText',
                order: 30,
                parent: null,
                enabled: true
                // persist defaults to false (memory-only entry)
            });

            this.logger.info('System logs menu item registered in system namespace');
        } catch (error) {
            this.logger.error({ error }, 'Failed to register system logs menu item');
            throw new Error(`Failed to register system logs menu item: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }

        // Router is mounted by system router via: router.use('/logs', createSystemLogRouter())
        this.logger.info('Logs module running (routes available via system router)');
    }

    /**
     * Get the SystemLogService singleton instance for external consumers.
     *
     * This allows other modules and services to access the SystemLogService directly
     * if needed (though most code uses the logger export from lib/logger.js).
     *
     * @returns SystemLogService singleton instance
     * @throws {Error} If called before init() completes
     */
    getLogService(): SystemLogService {
        if (!this.logService) {
            throw new Error('LogsModule not initialized - call init() first');
        }
        return this.logService;
    }

    /**
     * Create the system log router with all authenticated endpoints.
     *
     * This is exposed as a public method so the system router can import and mount it.
     * This maintains backward compatibility with the existing routing structure.
     *
     * @returns Express router with log management endpoints
     */
    createRouter(): Router {
        if (!this.controller) {
            throw new Error('LogsModule not initialized - call init() first');
        }
        return createSystemLogRouter();
    }
}
