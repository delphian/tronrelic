/**
 * Pages module entry point.
 *
 * Provides centralized initialization for the custom pages system with dependency
 * injection for database, cache, and menu services. The module manages both admin
 * and public API routers, menu registration in the 'system' namespace, and all
 * page-related services.
 */

import { Router } from 'express';
import type { ICacheService, IDatabaseService, IMenuService } from '@tronrelic/types';
import { logger } from '../../lib/logger.js';
import { PageService } from './services/page.service.js';
import { LocalStorageProvider } from './services/storage/LocalStorageProvider.js';
import { PagesController } from './api/pages.controller.js';
import { createPagesRouter } from './api/pages.routes.js';
import { createPublicPagesRouter } from './api/pages.public-routes.js';

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
}

/**
 * Result of pages module initialization containing all created routers.
 */
export interface IPagesModuleResult {
    /**
     * Admin router with authenticated endpoints for page management.
     * Mount at: /api/admin/pages
     */
    adminRouter: Router;

    /**
     * Public router with unauthenticated endpoints for viewing published pages.
     * Mount at: /api/pages
     */
    publicRouter: Router;
}

/**
 * Create pages module router with all endpoints.
 *
 * Registers REST API endpoints for page, file, and settings management.
 * All routes require admin authentication (enforced by parent router).
 *
 * @param database - Database service for MongoDB operations
 * @param cacheService - Redis cache service for rendered HTML
 * @returns Express router with pages endpoints
 *
 * @example
 * ```typescript
 * // In backend server setup
 * const pagesRouter = createPagesModuleRouter(database, cacheService);
 * app.use('/api/admin/pages', adminAuthMiddleware, pagesRouter);
 * ```
 */
export function createPagesModuleRouter(database: IDatabaseService, cacheService: ICacheService): Router {
    // Initialize storage provider (default: local filesystem)
    const storageProvider = new LocalStorageProvider();

    // Create page service with dependencies
    const pageLogger = logger.child({ module: 'pages' });
    const pageService = new PageService(database, storageProvider, cacheService, pageLogger);

    // Create controller
    const controller = new PagesController(pageService, pageLogger);

    // Create and return router with all endpoints
    return createPagesRouter(controller);
}

/**
 * Create public pages router with endpoints accessible to all users.
 *
 * Registers public REST API endpoints for viewing published pages.
 * Routes do not require authentication.
 *
 * @param database - Database service for MongoDB operations
 * @param cacheService - Redis cache service for rendered HTML
 * @returns Express router with public endpoints
 *
 * @example
 * ```typescript
 * // In backend server setup
 * const publicPagesRouter = createPublicPagesModuleRouter(database, cacheService);
 * app.use('/api/pages', publicPagesRouter);
 * ```
 */
export function createPublicPagesModuleRouter(database: IDatabaseService, cacheService: ICacheService): Router {
    // Initialize storage provider (default: local filesystem)
    const storageProvider = new LocalStorageProvider();

    // Create page service with dependencies
    const pageLogger = logger.child({ module: 'pages' });
    const pageService = new PageService(database, storageProvider, cacheService, pageLogger);

    // Create controller
    const controller = new PagesController(pageService, pageLogger);

    // Create and return router with public endpoints
    return createPublicPagesRouter(controller);
}

/**
 * Initialize the pages module with all dependencies.
 *
 * This is the primary entry point for setting up the pages module during application
 * bootstrap. It handles all initialization tasks:
 *
 * 1. Registers menu item in 'system' namespace via MenuService
 * 2. Creates admin router for /api/admin/pages endpoints
 * 3. Creates public router for /api/pages endpoints
 *
 * The function uses internal helpers for router creation and menu registration,
 * providing a clean single-call interface for the bootstrap process.
 *
 * @param dependencies - All required services (database, cache, menu)
 * @returns Object containing admin and public routers ready to mount
 *
 * @example
 * ```typescript
 * // In backend bootstrap (apps/backend/src/index.ts)
 * import { initPagesModule } from './modules/pages/index.js';
 *
 * const { adminRouter, publicRouter } = initPagesModule({
 *     database: coreDatabase,
 *     cacheService: cacheService,
 *     menuService: MenuService.getInstance()
 * });
 *
 * app.use('/api/admin/pages', adminAuthMiddleware, adminRouter);
 * app.use('/api/pages', publicRouter);
 * ```
 */
export function initPagesModule(dependencies: IPagesModuleDependencies): IPagesModuleResult {
    const { database, cacheService, menuService } = dependencies;

    // Register menu item in 'system' namespace
    initializePagesMenu(menuService);

    // Create routers with shared dependencies
    const adminRouter = createPagesModuleRouter(database, cacheService);
    const publicRouter = createPublicPagesModuleRouter(database, cacheService);

    logger.info({ module: 'pages' }, 'Pages module initialized');

    return { adminRouter, publicRouter };
}

/**
 * Initialize pages module menu registration (internal helper).
 *
 * Subscribes to the MenuService 'ready' event and creates a navigation entry
 * for the pages admin interface at /system/pages. The menu item is created as
 * a memory-only entry (persist=false) that disappears on backend restart,
 * consistent with the pattern used by plugins.
 *
 * The menu item is registered in the 'system' namespace for backend administration
 * pages, separate from the 'main' namespace used for public navigation.
 *
 * @param menuService - Global menu service singleton
 * @internal
 */
function initializePagesMenu(menuService: IMenuService): void {
    const pageLogger = logger.child({ module: 'pages-menu' });

    // Subscribe to 'ready' event to ensure MenuService is fully initialized
    // before attempting to create menu nodes
    menuService.subscribe('ready', async () => {
        try {
            await menuService.create({
                namespace: 'system',
                label: 'Pages',
                url: '/system/pages',
                icon: 'FileText',
                order: 40,
                parent: null,
                enabled: true
                // persist defaults to false (memory-only entry)
            });

            pageLogger.info('Pages menu item registered in system namespace');
        } catch (error) {
            pageLogger.error({ error }, 'Failed to register pages menu item');
        }
    });
}

export { PageService } from './services/page.service.js';
export { MarkdownService } from './services/markdown.service.js';
export { StorageProvider } from './services/storage/StorageProvider.js';
export { LocalStorageProvider } from './services/storage/LocalStorageProvider.js';
export { PagesController } from './api/pages.controller.js';
export { createPagesRouter } from './api/pages.routes.js';
export { createPublicPagesRouter } from './api/pages.public-routes.js';
export type { IPageDocument, IPageFileDocument, IPageSettingsDocument } from './database/index.js';
export { DEFAULT_PAGE_SETTINGS } from './database/index.js';
