/**
 * Pages module entry point.
 *
 * Exports all public interfaces for the pages module.
 */

import { Router } from 'express';
import type { ICacheService } from '@tronrelic/types';
import { logger } from '../../lib/logger.js';
import { PageService } from './services/page.service.js';
import { LocalStorageProvider } from './services/storage/LocalStorageProvider.js';
import { PagesController } from './pages.controller.js';
import { createPagesRouter } from './pages.routes.js';
import { createPublicPagesRouter } from './pages.public-routes.js';

/**
 * Create pages module router with all endpoints.
 *
 * Registers REST API endpoints for page, file, and settings management.
 * All routes require admin authentication (enforced by parent router).
 *
 * @param cacheService - Redis cache service for rendered HTML
 * @returns Express router with pages endpoints
 *
 * @example
 * ```typescript
 * // In backend server setup
 * const pagesRouter = createPagesModuleRouter(cacheService);
 * app.use('/api/admin/pages', adminAuthMiddleware, pagesRouter);
 * ```
 */
export function createPagesModuleRouter(cacheService: ICacheService): Router {
    // Initialize storage provider (default: local filesystem)
    const storageProvider = new LocalStorageProvider();

    // Create page service with dependencies
    const pageLogger = logger.child({ module: 'pages' });
    const pageService = new PageService(storageProvider, cacheService, pageLogger);

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
 * @param cacheService - Redis cache service for rendered HTML
 * @returns Express router with public endpoints
 *
 * @example
 * ```typescript
 * // In backend server setup
 * const publicPagesRouter = createPublicPagesModuleRouter(cacheService);
 * app.use('/api/pages', publicPagesRouter);
 * ```
 */
export function createPublicPagesModuleRouter(cacheService: ICacheService): Router {
    // Initialize storage provider (default: local filesystem)
    const storageProvider = new LocalStorageProvider();

    // Create page service with dependencies
    const pageLogger = logger.child({ module: 'pages' });
    const pageService = new PageService(storageProvider, cacheService, pageLogger);

    // Create controller
    const controller = new PagesController(pageService, pageLogger);

    // Create and return router with public endpoints
    return createPublicPagesRouter(controller);
}

export { PageService } from './services/page.service.js';
export { MarkdownService } from './services/markdown.service.js';
export { StorageProvider } from './services/storage/StorageProvider.js';
export { LocalStorageProvider } from './services/storage/LocalStorageProvider.js';
export { PagesController } from './pages.controller.js';
export { createPagesRouter } from './pages.routes.js';
export { PageModel } from './models/Page.model.js';
export { PageFileModel } from './models/PageFile.model.js';
export { PageSettingsModel, DEFAULT_PAGE_SETTINGS } from './models/PageSettings.model.js';
