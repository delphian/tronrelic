/**
 * Pages module implementation.
 *
 * Provides custom page creation, markdown rendering, and file upload capabilities
 * for administrator-authored content. The module follows TronRelic's two-phase
 * initialization pattern with dependency injection.
 */

import type { Express } from 'express';
import type { ICacheService, IDatabaseService, IMenuService, IModule, IModuleMetadata } from '@tronrelic/types';
import path from 'path';
import fs from 'fs/promises';
import { logger } from '../../lib/logger.js';
import { PageService } from './services/page.service.js';
import { LocalStorageProvider } from './services/storage/LocalStorageProvider.js';
import { PagesController } from './api/pages.controller.js';
import { createPagesRouter } from './api/pages.routes.js';
import { createPublicPagesRouter } from './api/pages.public-routes.js';
import type { Router } from 'express';

/**
 * Pages module dependencies for initialization.
 *
 * All required services for the pages module to function properly, injected
 * at application bootstrap time.
 */
export interface IPagesModuleDependencies {
    /**
     * Database service for MongoDB operations (page, file, settings storage).
     */
    database: IDatabaseService;

    /**
     * Cache service for rendered HTML and computed values.
     */
    cacheService: ICacheService;

    /**
     * Menu service for registering /system/pages navigation entry.
     */
    menuService: IMenuService;

    /**
     * Express application instance for mounting routers.
     * The module will attach its admin and public routers using IoC pattern.
     */
    app: Express;
}

/**
 * Pages module for custom content management.
 *
 * Implements the IModule interface to provide:
 * - Custom page creation with markdown authoring
 * - File upload and management with pluggable storage providers
 * - Markdown rendering with frontmatter extraction and Redis caching
 * - Admin interface for page/file/settings management
 * - Public API for viewing published pages
 *
 * ## Lifecycle
 *
 * ### init() phase:
 * - Stores injected dependencies (database, cache, menu service, app)
 * - Creates storage provider (default: LocalStorageProvider)
 * - Instantiates PageService, MarkdownService, and PagesController
 * - Does NOT mount routes or register menu items yet
 *
 * ### run() phase:
 * - Registers menu item in 'system' namespace for admin UI
 * - Creates and mounts admin router at /api/admin/pages
 * - Creates and mounts public router at /api/pages
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
 * const pagesModule = new PagesModule();
 *
 * await pagesModule.init({
 *     database: coreDatabase,
 *     cacheService: cacheService,
 *     menuService: MenuService.getInstance(),
 *     app: app
 * });
 *
 * await pagesModule.run();
 * ```
 */
export class PagesModule implements IModule<IPagesModuleDependencies> {
    /**
     * Module metadata for introspection and logging.
     */
    readonly metadata: IModuleMetadata = {
        id: 'pages',
        name: 'Pages',
        version: '1.0.0',
        description: 'Custom page creation and markdown rendering for admin-authored content'
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
    private pageService!: PageService;
    private controller!: PagesController;

    /**
     * Logger instance for this module.
     */
    private readonly logger = logger.child({ module: 'pages' });

    /**
     * Ensure the uploads directory exists before Express static middleware starts.
     *
     * Creates /public/uploads directory structure if missing. This prevents
     * Express static middleware from failing with 500 errors when trying to
     * serve uploaded files.
     *
     * The directory is created at {cwd}/public/uploads where cwd is the project
     * root (/home/delphian/projects/tronrelic.com-beta).
     *
     * @throws {Error} If directory creation fails due to permissions or disk issues
     */
    private async ensureUploadsDirectoryExists(): Promise<void> {
        const uploadsDir = path.join(process.cwd(), 'public', 'uploads');

        try {
            await fs.mkdir(uploadsDir, { recursive: true });
            this.logger.info({ uploadsDir }, 'Uploads directory created or already exists');
        } catch (error) {
            this.logger.error({ error, uploadsDir }, 'Failed to create uploads directory');
            throw new Error(
                `Failed to create uploads directory: ${error instanceof Error ? error.message : 'Unknown error'}`
            );
        }
    }

    /**
     * Initialize the pages module with injected dependencies.
     *
     * This phase prepares the module by creating service instances and storing
     * dependencies for use in the run() phase. It does NOT mount routes or
     * register menu items yet.
     *
     * @param dependencies - All required services (database, cache, menu, app)
     * @throws {Error} If initialization fails (causes application shutdown)
     */
    async init(dependencies: IPagesModuleDependencies): Promise<void> {
        this.logger.info('Initializing pages module...');

        // Store dependencies for use in run() phase
        this.database = dependencies.database;
        this.cacheService = dependencies.cacheService;
        this.menuService = dependencies.menuService;
        this.app = dependencies.app;

        // Ensure uploads directory exists before Express static middleware tries to serve from it
        // This prevents 500 errors when accessing uploaded files
        await this.ensureUploadsDirectoryExists();

        // Create storage provider (default: local filesystem)
        const storageProvider = new LocalStorageProvider();

        // Initialize PageService singleton with dependencies
        PageService.setDependencies(
            this.database,
            storageProvider,
            this.cacheService,
            this.logger
        );

        // Get PageService singleton instance
        this.pageService = PageService.getInstance();

        // Create controller with singleton service
        this.controller = new PagesController(this.pageService, this.logger);

        this.logger.info('Pages module initialized');
    }

    /**
     * Run the pages module after all modules have initialized.
     *
     * This phase activates the module by:
     * - Registering menu item in 'system' namespace
     * - Creating and mounting admin router
     * - Creating and mounting public router
     *
     * By this point, MenuService is guaranteed to be ready (no need for 'ready' event).
     *
     * @throws {Error} If runtime setup fails (causes application shutdown)
     */
    async run(): Promise<void> {
        this.logger.info('Running pages module...');

        // Register menu item in 'system' namespace
        try {
            await this.menuService.create({
                namespace: 'system',
                label: 'Pages',
                url: '/system/pages',
                icon: 'FileText',
                order: 40,
                parent: null,
                enabled: true
                // persist defaults to false (memory-only entry)
            });

            this.logger.info('Pages menu item registered in system namespace');
        } catch (error) {
            this.logger.error({ error }, 'Failed to register pages menu item');
            throw new Error(`Failed to register pages menu item: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }

        // Create and mount admin router (IoC - module attaches itself to app)
        const adminRouter = this.createAdminRouter();
        this.app.use('/api/admin/pages', adminRouter);
        this.logger.info('Admin pages router mounted at /api/admin/pages');

        // Create and mount public router (IoC - module attaches itself to app)
        const publicRouter = this.createPublicRouter();
        this.app.use('/api/pages', publicRouter);
        this.logger.info('Public pages router mounted at /api/pages');

        this.logger.info('Pages module running');
    }

    /**
     * Create the admin router with all authenticated endpoints.
     *
     * This is an internal helper method called during the run() phase.
     * The router is then mounted by the module itself using IoC pattern.
     *
     * @returns Express router with admin endpoints
     * @internal
     */
    private createAdminRouter(): Router {
        return createPagesRouter(this.controller);
    }

    /**
     * Create the public router with unauthenticated endpoints.
     *
     * This is an internal helper method called during the run() phase.
     * The router is then mounted by the module itself using IoC pattern.
     *
     * @returns Express router with public endpoints
     * @internal
     */
    private createPublicRouter(): Router {
        return createPublicPagesRouter(this.controller);
    }

    /**
     * Get the PageService singleton instance for external consumers.
     *
     * This allows other modules and plugins to access the PageService after
     * the module has been initialized. Should only be called after init()
     * completes successfully.
     *
     * @returns PageService singleton instance
     * @throws {Error} If called before init() completes
     */
    getPageService(): PageService {
        if (!this.pageService) {
            throw new Error('PagesModule not initialized - call init() first');
        }
        return this.pageService;
    }
}
