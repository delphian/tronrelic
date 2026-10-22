/**
 * Pages module — markdown CMS for admin-authored content. File handling
 * lives outside this module; the `trp-files` plugin owns the unified
 * inventory and publishes `IFileService` on the service registry as
 * `'files'` during plugin load. Pages consumes file URLs through inline
 * markdown that the admin produces in the Files admin UI.
 */

import type { Express, Router } from 'express';
import type {
    IAiProviderRegistry,
    ICacheService,
    IContentService,
    IDatabaseService,
    ILocalizationService,
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
import { PageTranslationSuggestionService } from './services/page-translation-suggestion.service.js';
import { ensurePageTranslationIndexes } from './database/index.js';
import { PagesController } from './api/pages.controller.js';
import { PageTranslationsController } from './api/page-translations.controller.js';
import { createPagesRouter } from './api/pages.routes.js';
import { createPublicPagesRouter } from './api/pages.public-routes.js';
import { requireAdmin } from '../../api/middleware/admin-auth.js';
import { createAdminRateLimiter } from '../../api/middleware/rate-limit.js';
import { registerPageAiTools } from './ai-tools.js';

/**
 * Registry name of the core AI provider registry, as documented in
 * `docs/system/system-ai-tools.md`. Written out rather than imported from the
 * ai-tools module, whose barrel would load that whole module into this one.
 */
const AI_PROVIDERS_SERVICE_NAME = 'ai-providers';

/**
 * Registry name the localization module publishes its read service under.
 * Written out for the same reason: importing the localization barrel would
 * load that module into this one.
 */
const LOCALIZATION_SERVICE_NAME = 'localization';

export interface IPagesModuleDependencies {
    database: IDatabaseService;
    cacheService: ICacheService;
    menuService: IMenuService;
    /**
     * The core content service. Pages are managed content (`core:page`), so
     * every page write and public read passes through it.
     */
    contentService: IContentService;
    /**
     * The service registry, watched for the core `'ai-tools'` registry so the
     * read-only page tools are registered whenever it is available.
     */
    serviceRegistry: IServiceRegistry;
    app: Express;
    /**
     * Called after a change that can alter which page addresses are served in
     * which language: a translation saved, deleted, restored, or approved, or
     * a page approved, deleted, or restored. Bootstrap points it at the
     * localization snapshot, which lists translated page addresses and belongs
     * to another module. Optional because the pages module works without
     * localization; nothing is refreshed when it is absent.
     */
    onLocalizedRoutesChanged?: () => void;
}

/**
 * Pages module class.
 *
 * Lifecycle:
 * - `init()` — store deps, configure the `PageService` and
 *   `PageTranslationService` singletons, ensure the translation indexes, and
 *   build the controllers.
 * - `run()` — register the `core:page` and `core:page-translation` managed
 *   content types, register the `/system/pages` menu item, mount admin and
 *   public routers, and register the read-only page AI tools.
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
    private translationService!: PageTranslationService;
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
     * Store dependencies and build the page service and controller. Nothing
     * is registered or mounted yet.
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

        const onLocalizedRoutesChanged = dependencies.onLocalizedRoutesChanged ?? (() => undefined);

        PageService.setDependencies(
            this.database,
            this.cacheService,
            this.contentService,
            this.logger,
            onLocalizedRoutesChanged
        );
        this.pageService = PageService.getInstance();

        await ensurePageTranslationIndexes(this.database);
        PageTranslationService.setDependencies({
            database: this.database,
            cacheService: this.cacheService,
            contentService: this.contentService,
            pages: this.pageService,
            onRoutesChanged: onLocalizedRoutesChanged,
            logger: this.logger
        });
        this.translationService = PageTranslationService.getInstance();

        // The provider registry and the localization service are looked up per
        // request rather than captured here: both are published after this
        // module starts, and provider plugins come and go at runtime.
        const suggestionService = new PageTranslationSuggestionService({
            source: this.translationService,
            settings: this.pageService,
            getProviderRegistry: () => this.serviceRegistry.get<IAiProviderRegistry>(AI_PROVIDERS_SERVICE_NAME) ?? null,
            getLocalization: () => this.serviceRegistry.get<ILocalizationService>(LOCALIZATION_SERVICE_NAME) ?? null,
            logger: this.logger
        });

        this.controller = new PagesController(this.pageService, this.logger);
        this.translationsController = new PageTranslationsController(
            this.translationService,
            this.pageService,
            suggestionService,
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
        // soon as curation publishes itself. The returned disposer is not kept:
        // a module lives for the whole process and never unregisters.
        this.contentService.registerType(this.pageService.getContentType(), this.metadata.id);
        this.contentService.registerType(this.translationService.getContentType(), this.metadata.id);
        this.logger.info('core:page and core:page-translation registered as managed content');

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

        const adminRouter: Router = createPagesRouter(this.controller, this.translationsController);
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

    /**
     * Accessor for the `PageTranslationService` singleton, which bootstrap
     * hands to the localization module as the source of translated page
     * addresses. Should only be called after `init()` completes.
     *
     * @returns The translation service.
     * @throws When `init()` has not run.
     */
    getPageTranslationService(): PageTranslationService {
        if (!this.translationService) {
            throw new Error('PagesModule not initialized - call init() first');
        }
        return this.translationService;
    }
}
