/**
 * Address labels module implementation.
 *
 * Provides blockchain address labeling for human-readable identification of
 * wallets, contracts, and entities throughout TronRelic. The module enables
 * other modules and plugins to look up and contribute address labels.
 *
 * ## Design Decisions
 *
 * **Multi-source labeling**: Multiple sources (system, user, plugin, import)
 * can label the same address with confidence-based resolution.
 *
 * **TRON-specific metadata**: Optional fields capture Super Representative
 * status, energy provider info, and contract types.
 *
 * **Bulk operations**: Efficient batch lookups for transaction enrichment
 * and bulk import for initial data seeding.
 *
 * ## Future Extensibility
 *
 * The IAddressLabelService interface is exposed to plugins via IPluginContext,
 * enabling plugins to both consume and contribute labels.
 */

import type { Express, Router } from 'express';
import type {
    ICacheService,
    IDatabaseService,
    IMenuService,
    IModule,
    IModuleMetadata
} from '@tronrelic/types';
import { logger } from '../../lib/logger.js';
import { AddressLabelService } from './services/address-label.service.js';
import { AddressLabelController } from './api/address-label.controller.js';
import { createPublicRouter, createAdminRouter } from './api/address-label.routes.js';
import { requireAdmin } from '../../api/middleware/admin-auth.js';

/**
 * Dependencies required by the address labels module.
 *
 * All required services for the module to function properly, injected
 * at application bootstrap time.
 */
export interface IAddressLabelsModuleDependencies {
    /**
     * Database service for MongoDB operations.
     */
    database: IDatabaseService;

    /**
     * Cache service for label lookups.
     */
    cacheService: ICacheService;

    /**
     * Menu service for registering /system/address-labels navigation entry.
     */
    menuService: IMenuService;

    /**
     * Express application instance for mounting routers.
     * The module will attach its public and admin routers using IoC pattern.
     */
    app: Express;
}

/**
 * Address labels module for blockchain address identification.
 *
 * Implements the IModule interface to provide:
 * - CRUD operations for address labels
 * - Confidence-based label resolution for multi-source addresses
 * - Bulk operations for import/export and batch lookups
 * - Admin interface for label management
 *
 * ## Lifecycle
 *
 * ### init() phase:
 * - Stores injected dependencies (database, cache, menu service, app)
 * - Instantiates AddressLabelService singleton
 * - Creates database indexes
 * - Creates AddressLabelController
 * - Does NOT mount routes or register menu items yet
 *
 * ### run() phase:
 * - Registers menu item in 'system' namespace for admin UI
 * - Creates and mounts public router at /api/address-labels
 * - Creates and mounts admin router at /api/admin/address-labels
 *
 * ## Inversion of Control
 *
 * The module uses IoC by injecting the Express app and mounting its own routes,
 * rather than returning routers for the bootstrap process to mount.
 *
 * @example
 * ```typescript
 * // In backend bootstrap (apps/backend/src/index.ts)
 * const addressLabelsModule = new AddressLabelsModule();
 *
 * await addressLabelsModule.init({
 *     database: coreDatabase,
 *     cacheService: cacheService,
 *     menuService: MenuService.getInstance(),
 *     app: app
 * });
 *
 * await addressLabelsModule.run();
 * ```
 */
export class AddressLabelsModule implements IModule<IAddressLabelsModuleDependencies> {
    /**
     * Module metadata for introspection and logging.
     */
    readonly metadata: IModuleMetadata = {
        id: 'address-labels',
        name: 'Address Labels',
        version: '1.0.0',
        description: 'Blockchain address labeling for human-readable identification'
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
    private labelService!: AddressLabelService;
    private controller!: AddressLabelController;

    /**
     * Logger instance for this module.
     */
    private readonly logger = logger.child({ module: 'address-labels' });

    /**
     * Initialize the address labels module with injected dependencies.
     *
     * This phase prepares the module by creating service instances and storing
     * dependencies for use in the run() phase. It does NOT mount routes or
     * register menu items yet.
     *
     * @param dependencies - All required services (database, cache, menu, app)
     * @throws {Error} If initialization fails (causes application shutdown)
     */
    async init(dependencies: IAddressLabelsModuleDependencies): Promise<void> {
        this.logger.info('Initializing address labels module...');

        // Store dependencies for use in run() phase
        this.database = dependencies.database;
        this.cacheService = dependencies.cacheService;
        this.menuService = dependencies.menuService;
        this.app = dependencies.app;

        // Initialize AddressLabelService singleton with dependencies
        AddressLabelService.setDependencies(
            this.database,
            this.cacheService,
            this.logger
        );

        // Get AddressLabelService singleton instance
        this.labelService = AddressLabelService.getInstance();

        // Create database indexes
        await this.labelService.createIndexes();

        // Create controller with singleton service
        this.controller = new AddressLabelController(this.labelService, this.logger);

        this.logger.info('Address labels module initialized');
    }

    /**
     * Run the address labels module after all modules have initialized.
     *
     * This phase activates the module by:
     * - Registering menu item in 'system' namespace
     * - Creating and mounting public router
     * - Creating and mounting admin router
     *
     * By this point, MenuService is guaranteed to be ready.
     *
     * @throws {Error} If runtime setup fails (causes application shutdown)
     */
    async run(): Promise<void> {
        this.logger.info('Running address labels module...');

        // Register menu item in 'system' namespace
        try {
            await this.menuService.create({
                namespace: 'system',
                label: 'Address Labels',
                url: '/system/address-labels',
                icon: 'Tags',
                order: 80,
                parent: null,
                enabled: true
            });

            this.logger.info('Address Labels menu item registered in system namespace');
        } catch (error) {
            this.logger.error({ error }, 'Failed to register address labels menu item');
            throw new Error(`Failed to register address labels menu item: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }

        // Create and mount public router (IoC - module attaches itself to app)
        const publicRouter = this.createPublicRouter();
        this.app.use('/api/address-labels', publicRouter);
        this.logger.info('Public address labels router mounted at /api/address-labels');

        // Create and mount admin router (IoC - module attaches itself to app)
        const adminRouter = this.createAdminRouter();
        this.app.use('/api/admin/address-labels', requireAdmin, adminRouter);
        this.logger.info('Admin address labels router mounted at /api/admin/address-labels');

        this.logger.info('Address labels module running');
    }

    /**
     * Create the public router with lookup endpoints.
     *
     * @returns Express router with public endpoints
     * @internal
     */
    private createPublicRouter(): Router {
        return createPublicRouter(this.controller);
    }

    /**
     * Create the admin router with full CRUD endpoints.
     *
     * @returns Express router with admin endpoints
     * @internal
     */
    private createAdminRouter(): Router {
        return createAdminRouter(this.controller);
    }

    /**
     * Get the AddressLabelService singleton instance for external consumers.
     *
     * This allows other modules and plugins to access the AddressLabelService
     * after the module has been initialized. Should only be called after init()
     * completes successfully.
     *
     * @returns AddressLabelService singleton instance
     * @throws {Error} If called before init() completes
     */
    getAddressLabelService(): AddressLabelService {
        if (!this.labelService) {
            throw new Error('AddressLabelsModule not initialized - call init() first');
        }
        return this.labelService;
    }
}
