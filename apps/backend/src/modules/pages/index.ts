/**
 * Pages module entry point.
 *
 * Exports all public interfaces for the pages module.
 */

import { Router } from 'express';
import type { ICacheService, IDatabaseService } from '@tronrelic/types';
import { logger } from '../../lib/logger.js';
import { PageService } from './services/page.service.js';
import { LocalStorageProvider } from './services/storage/LocalStorageProvider.js';
import { PagesController } from './api/pages.controller.js';
import { createPagesRouter } from './api/pages.routes.js';
import { createPublicPagesRouter } from './api/pages.public-routes.js';

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

export { PageService } from './services/page.service.js';
export { MarkdownService } from './services/markdown.service.js';
export { StorageProvider } from './services/storage/StorageProvider.js';
export { LocalStorageProvider } from './services/storage/LocalStorageProvider.js';
export { PagesController } from './api/pages.controller.js';
export { createPagesRouter } from './api/pages.routes.js';
export { createPublicPagesRouter } from './api/pages.public-routes.js';
export type { IPageDocument, IPageFileDocument, IPageSettingsDocument } from './database/index.js';
export { DEFAULT_PAGE_SETTINGS } from './database/index.js';
