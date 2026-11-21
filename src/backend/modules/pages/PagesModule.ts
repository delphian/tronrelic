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
    IContentService,
    IDatabaseService,
    IMarkdownRendererService,
    IMenuService,
    IModule,
    IModuleMetadata,
    IServiceRegistry,
    ServiceWatchDisposer,
} from '@/types';
import { logger } from '../../lib/logger.js';
import { MAIN_SYSTEM_CONTAINER_ID } from '../menu/index.js';
import { PageService } from './services/page.service.js';
import { PageTranslationService } from './services/page-translation.service.js';
import { PagesController } from './api/pages.controller.js';
import { PageTranslationsController } from './api/page-translations.controller.js';
import { createPagesRouter } from './api/pages.routes.js';
import { createPublicPagesRouter } from './api/pages.public-routes.js';
import { requireAdmin } from '../../api/middleware/admin-auth.js';
import { createAdminRateLimiter } from '../../api/middleware/rate-limit.js';
import { registerPageAiTools } from './ai-tools.js';
import { PageEmbeds } from './services/page-embeds.js';

/**
 * Menu namespace for the tab row on `/system/pages`. Kept out of `main` so
 * the tabs never appear in the global navigation; only that page's own
 * `MenuNavClient` reads this namespace (menu module's Submenu Pattern).
 */
export const PAGES_ADMIN_SUBMENU_NAMESPACE = 'pages';

/**
 * The `/system/pages` tab row, declared as menu nodes so the row inherits
 * per-user gating, ordering, and live `menu:update` refresh, and so a plugin
 * can add a tab. Database and Logs are the tabs every module with storage
 * and an admin page carries; the module registers no scheduler jobs, so
 * there is no Schedules tab.
 */
const PAGES_ADMIN_SUBMENU_TABS: ReadonlyArray<{ label: string; tab: string; icon: string; order: number }> = [
    { label: 'Pages', tab: 'pages', icon: 'FileText', order: 0 },
    { label: 'Settings', tab: 'settings', icon: 'Settings', order: 1 },
    { label: 'Database', tab: 'database', icon: 'Database', order: 2 },
    { label: 'Logs', tab: 'logs', icon: 'ScrollText', order: 3 }
];

export interface IPagesModuleDependencies {
    database: IDatabaseService;
    cacheService: ICacheService;
    menuService: IMenuService;
    /**
     * The core content service. Pages are managed content (`core:page`), so
     * every page write and public read passes through it, and so do page
     * translations, through its `translations()` service.
     */
    contentService: IContentService;
    /**
     * The shared markdown renderer from the markdown module. Pages render
     * their bodies and translations through it, so they follow the same
     * sanitize rules as every other surface that renders markdown. Passed in
     * directly because the module publishes it on the registry only in its
     * own `run()`, after this module's `init()`.
     */
    markdownRenderer: IMarkdownRendererService;
    /**
     * The service registry, watched for the core `'ai-tools'` registry so the
     * page tools (three reads and the review-held edit tool) are registered
     * whenever it is available.
     */
    serviceRegistry: IServiceRegistry;
    app: Express;
    /**
     * Called after a page change that can alter which page addresses are
     * served in which language: a page approved, deleted, or restored.
     * Bootstrap points it at the localization snapshot, which lists
     * translated page addresses and belongs to another module. Translation
     * changes reach the snapshot through the core content service instead.
     * Optional because the pages module works without localization; nothing
     * is refreshed when it is absent.
     */
    onLocalizedRoutesChanged?: () => void;
}

/**
 * Pages module class.
 *
 * Lifecycle:
 * - `init()` — store deps, configure the `PageService` and
 *   `PageTranslationService` singletons, ensure the translation values index,
 *   and build the controllers.
 * - `run()` — register the `core:page` managed content type (which carries its
 *   translation side), register the `/system/pages` menu item and the page's
 *   tab row, mount admin and public routers, and register the page AI tools.
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
    private contentService!: IContentService;
    private serviceRegistry!: IServiceRegistry;
    private app!: Express;
    private pageService!: PageService;
    private controller!: PagesController;
    private translationsController!: PageTranslationsController;

    /**
     * Removes the `'ai-tools'` watch that keeps the page tools registered.
     * A module never stops, so this is kept for symmetry with plugins rather
     * than called.
     */
    private unwatchAiTools: ServiceWatchDisposer | null = null;

    private readonly logger = logger.child({ module: 'pages' });

    /**
     * Store dependencies and build the page services and controllers.
     * Nothing is registered or mounted yet.
     *
     * @param dependencies - Core services the module needs.
     */
    async init(dependencies: IPagesModuleDependencies): Promise<void> {
        this.logger.info('Initializing pages module...');

        this.database = dependencies.database;
        this.cacheService = dependencies.cacheService;
        this.menuService = dependencies.menuService;
        this.contentService = dependencies.contentService;
        this.serviceRegistry = dependencies.serviceRegistry;
        this.app = dependencies.app;

        PageService.setDependencies(
            this.database,
            this.cacheService,
            this.contentService,
            dependencies.markdownRenderer,
            this.logger,
            dependencies.onLocalizedRoutesChanged ?? (() => undefined)
        );
        this.pageService = PageService.getInstance();
        await this.pageService.ensureTranslationIndexes();

        PageTranslationService.setDependencies({
            cacheService: this.cacheService,
            contentService: this.contentService,
            pages: this.pageService,
            markdownRenderer: dependencies.markdownRenderer
        });

        // Both public render endpoints send each embedded widget's data
        // beside the cached HTML, through one resolver.
        const pageEmbeds = new PageEmbeds(this.serviceRegistry, this.logger);
        this.controller = new PagesController(this.pageService, pageEmbeds, this.logger);
        this.translationsController = new PageTranslationsController(
            PageTranslationService.getInstance(),
            this.pageService,
            pageEmbeds,
            this.logger
        );

        this.logger.info('Pages module initialized');
    }

    /**
     * Register pages as managed content, then the admin menu item and the
     * admin and public routers.
     */
    async run(): Promise<void> {
        this.logger.info('Running pages module...');

        // Register before mounting routes so the first request already finds
        // the type. The content service binds it into the curation queue as
        // soon as curation publishes itself, and serves its translations
        // through `translations()`. The returned disposer is not kept: a
        // module lives for the whole process and never unregisters.
        this.contentService.registerType(this.pageService.getContentType(), this.metadata.id);
        this.logger.info('core:page registered as managed content');

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

            // Register the /system/pages tab row as a namespaced menu (Submenu
            // Pattern). The nodes are memory-only and sit outside the System
            // container, so the container's forced `requiresAdmin` does not
            // reach them and each node sets it for itself.
            for (const tab of PAGES_ADMIN_SUBMENU_TABS) {
                await this.menuService.create({
                    namespace: PAGES_ADMIN_SUBMENU_NAMESPACE,
                    label: tab.label,
                    url: `/system/pages?tab=${tab.tab}`,
                    icon: tab.icon,
                    order: tab.order,
                    parent: null,
                    enabled: true,
                    requiresAdmin: true
                });
            }

            this.logger.info('Pages admin tab row registered');
        } catch (error) {
            this.logger.error({ error }, 'Failed to register pages menu item');
            throw new Error(`Failed to register pages menu item: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }

        const adminRouter: Router = createPagesRouter(this.controller);
        this.app.use('/api/admin/pages', createAdminRateLimiter('pages-admin'), requireAdmin, adminRouter);
        this.logger.info('Admin pages router mounted at /api/admin/pages');

        const publicRouter: Router = createPublicPagesRouter(this.controller, this.translationsController);
        this.app.use('/api/pages', publicRouter);
        this.logger.info('Public pages router mounted at /api/pages');

        // After the type registration above, because the tools read through
        // core and core refuses reads for an unregistered type.
        this.unwatchAiTools = registerPageAiTools(this.serviceRegistry, this.pageService, this.logger);

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
