/**
 * Pages module — markdown CMS for admin-authored content. File handling
 * lives outside this module; the `trp-files` plugin owns the unified
 * inventory and publishes `IFileService` on the service registry as
 * `'files'` during plugin load. Pages consumes file URLs through inline
 * markdown that the admin produces in the Files admin UI.
 */

import type { Express, Router } from 'express';
import type {
    ICacheService,
    IDatabaseService,
    IMenuService,
    IModule,
    IModuleMetadata,
} from '@/types';
import { logger } from '../../lib/logger.js';
import { MAIN_SYSTEM_CONTAINER_ID } from '../menu/index.js';
import { PageService } from './services/page.service.js';
import { PagesController } from './api/pages.controller.js';
import { createPagesRouter } from './api/pages.routes.js';
import { createPublicPagesRouter } from './api/pages.public-routes.js';
import { requireAdmin } from '../../api/middleware/admin-auth.js';

export interface IPagesModuleDependencies {
    database: IDatabaseService;
    cacheService: ICacheService;
    menuService: IMenuService;
    app: Express;
}

/**
 * Pages module class.
 *
 * Lifecycle:
 * - `init()` — store deps, configure `PageService` singleton, build controller.
 * - `run()` — register `/system/pages` menu item, mount admin and public routers.
 *
 * No file dependencies — uploads go through the Files module's
 * `/api/admin/files` admin surface, which is registered before Pages so
 * its menu and routes already exist by the time a page editor links to a
 * stored file.
 */
export class PagesModule implements IModule<IPagesModuleDependencies> {
    readonly metadata: IModuleMetadata = {
        id: 'pages',
        name: 'Pages',
        version: '1.0.0',
        description: 'Custom page creation and markdown rendering for admin-authored content'
    };

    private database!: IDatabaseService;
    private cacheService!: ICacheService;
    private menuService!: IMenuService;
    private app!: Express;
    private pageService!: PageService;
    private controller!: PagesController;

    private readonly logger = logger.child({ module: 'pages' });

    async init(dependencies: IPagesModuleDependencies): Promise<void> {
        this.logger.info('Initializing pages module...');

        this.database = dependencies.database;
        this.cacheService = dependencies.cacheService;
        this.menuService = dependencies.menuService;
        this.app = dependencies.app;

        PageService.setDependencies(this.database, this.cacheService, this.logger);
        this.pageService = PageService.getInstance();

        this.controller = new PagesController(this.pageService, this.logger);

        this.logger.info('Pages module initialized');
    }

    async run(): Promise<void> {
        this.logger.info('Running pages module...');

        try {
            await this.menuService.create({
                namespace: 'main',
                label: 'Pages',
                url: '/system/pages',
                icon: 'FileText',
                order: 40,
                parent: MAIN_SYSTEM_CONTAINER_ID,
                enabled: true
            });

            this.logger.info('Pages menu item registered under the System container');
        } catch (error) {
            this.logger.error({ error }, 'Failed to register pages menu item');
            throw new Error(`Failed to register pages menu item: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }

        const adminRouter: Router = createPagesRouter(this.controller);
        this.app.use('/api/admin/pages', requireAdmin, adminRouter);
        this.logger.info('Admin pages router mounted at /api/admin/pages');

        const publicRouter: Router = createPublicPagesRouter(this.controller);
        this.app.use('/api/pages', publicRouter);
        this.logger.info('Public pages router mounted at /api/pages');

        this.logger.info('Pages module running');
    }

    /**
     * Accessor for the `PageService` singleton, exposed for tests and
     * tooling. Should only be called after `init()` completes.
     */
    getPageService(): PageService {
        if (!this.pageService) {
            throw new Error('PagesModule not initialized - call init() first');
        }
        return this.pageService;
    }
}
