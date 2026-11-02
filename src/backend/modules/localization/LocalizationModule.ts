/**
 * @fileoverview Localization module: languages, published routes, and
 * translations, served to the frontend and managed at `/system/localization`.
 *
 * Why a module rather than a plugin: every page render consults it to decide
 * which language a URL is in, so the site cannot treat it as optional. With no
 * language enabled it changes nothing — the public snapshot is empty and every
 * URL stays English — which is what lets it ship before any page is translated.
 */

import type { Express, Router } from 'express';
import type {
    IAiProviderRegistry,
    IDatabaseService,
    IMenuService,
    IModule,
    IModuleMetadata,
    IPublicLocalizedRoute,
    IServiceRegistry,
    ITrafficIgnoreList,
    ServiceWatchDisposer
} from '@/types';
import { logger } from '../../lib/logger.js';
import { requireAdmin } from '../../api/middleware/admin-auth.js';
import { createGroupedAdminRateLimiter } from '../../api/middleware/rate-limit.js';
import { MAIN_SYSTEM_CONTAINER_ID } from '../menu/index.js';
import { ensureLocalizationIndexes } from './database/index.js';
import { LocalizationService } from './services/localization.service.js';
import { LocalizationAdminService } from './services/localization-admin.service.js';
import { LocalizationSettingsService } from './services/localization-settings.service.js';
import { TranslationObservationService } from './services/translation-observation.service.js';
import { TranslationSuggestionService } from './services/translation-suggestion.service.js';
import { LanguageSwitchService } from './services/language-switch.service.js';
import { LocalizationPublicController } from './api/localization-public.controller.js';
import { LocalizationAdminController } from './api/localization-admin.controller.js';
import { createLocalizationAdminRouter, createLocalizationPublicRouter } from './api/localization.routes.js';
import { registerLocalizationAiTools } from './ai-tools.js';

/** Name the read-side service is published under in the service registry. */
export const LOCALIZATION_SERVICE_NAME = 'localization';

/**
 * Registry name of the core AI provider registry, as documented in
 * `docs/system/system-ai-tools.md`. Written out rather than imported from the
 * ai-tools module, whose barrel would load that whole module and its Redis and
 * WebSocket dependencies into this one.
 */
const AI_PROVIDERS_SERVICE_NAME = 'ai-providers';

/**
 * Registry name of the traffic module's read-only ignore list, which the
 * traffic module exports as `TRAFFIC_IGNORE_LIST_SERVICE`. Written out for the
 * same reason as the name above: the traffic barrel would load that module's
 * ClickHouse and Search Console code into this one.
 */
const TRAFFIC_IGNORE_LIST_SERVICE_NAME = 'traffic-ignore-list';

/**
 * Menu namespace holding the page's in-page tab row. Kept out of `main` so the
 * tabs never appear in the site navigation; only the page's own
 * `MenuNavClient` reads it (the menu module's Submenu Pattern).
 */
const SUBMENU_NAMESPACE = 'localization';

/**
 * The page's tab row, declared as menu nodes so it inherits per-user gating,
 * ordering, and live refresh. Languages comes first because nothing else can
 * be configured until a language exists. Switches shows how often visitors use
 * the language switcher. Settings holds the AI translation assist's prompt and
 * model. Database and Logs are the tabs every module owning storage and an
 * admin page carries, built from the core browsers scoped to this module.
 */
const SUBMENU_TABS: ReadonlyArray<{ label: string; tab: string; icon: string; order: number }> = [
    { label: 'Languages', tab: 'languages', icon: 'Languages', order: 0 },
    { label: 'Routes', tab: 'routes', icon: 'Route', order: 1 },
    { label: 'Translations', tab: 'translations', icon: 'FileText', order: 2 },
    { label: 'Switches', tab: 'switches', icon: 'MousePointerClick', order: 3 },
    { label: 'Settings', tab: 'settings', icon: 'Settings', order: 4 },
    { label: 'Database', tab: 'database', icon: 'Database', order: 5 },
    { label: 'Logs', tab: 'logs', icon: 'ScrollText', order: 6 }
];

/** Dependencies the localization module needs at bootstrap. */
export interface ILocalizationModuleDependencies {
    /** Core database service backing the module's four collections. */
    database: IDatabaseService;
    /** Registry the module publishes `'localization'` onto. */
    serviceRegistry: IServiceRegistry;
    /** Menu service for the admin nav entry and the page's tab row. */
    menuService: IMenuService;
    /** Express app the module mounts its routers onto. */
    app: Express;
    /**
     * Lists the paths the site already serves, consulted before a language is
     * enabled so its code cannot take over existing pages. Supplied by
     * bootstrap because the sources — CMS pages and the main menu — belong to
     * other modules.
     */
    listKnownPaths: () => Promise<string[]>;
    /**
     * Lists the namespaces a reported key may belong to: `core` plus every
     * discovered plugin id. Supplied by bootstrap from the plugin manager.
     */
    listKnownNamespaces: () => string[];
    /**
     * Lists addresses another module publishes in other languages on its own,
     * merged into the public snapshot's routes. Bootstrap supplies the core
     * content service's translated addresses, which cover every translatable
     * content type, such as CMS pages. Optional; without it only routes
     * published on the Routes tab are served.
     */
    listContentRoutes?: () => Promise<IPublicLocalizedRoute[]>;
}

/**
 * Two-phase module: `init()` wires the services and indexes, `run()` publishes
 * the read service, mounts the routers, and registers the admin page.
 */
export class LocalizationModule implements IModule<ILocalizationModuleDependencies> {
    readonly metadata: IModuleMetadata = {
        id: 'localization',
        name: 'Localization',
        version: '1.0.0',
        description: 'Languages, per-route publishing, and stored translations for serving the site in more than one language.'
    };

    private serviceRegistry!: IServiceRegistry;
    private menuService!: IMenuService;
    private app!: Express;
    private service!: LocalizationService;
    private adminService!: LocalizationAdminService;
    private settingsService!: LocalizationSettingsService;
    private suggestionService!: TranslationSuggestionService;
    private observationService!: TranslationObservationService;
    private switchService!: LanguageSwitchService;
    private unwatchAiTools: ServiceWatchDisposer | null = null;
    private initialized = false;
    private readonly logger = logger.child({ module: 'localization' });

    /**
     * Phase 1: build the services and make sure the indexes exist.
     *
     * @param deps - Injected collaborators.
     */
    async init(deps: ILocalizationModuleDependencies): Promise<void> {
        this.serviceRegistry = deps.serviceRegistry;
        this.menuService = deps.menuService;
        this.app = deps.app;

        await ensureLocalizationIndexes(deps.database);

        LocalizationService.setDependencies({
            database: deps.database,
            logger: this.logger,
            listContentRoutes: deps.listContentRoutes
        });
        this.service = LocalizationService.getInstance();

        this.adminService = new LocalizationAdminService({
            database: deps.database,
            logger: this.logger,
            listKnownPaths: deps.listKnownPaths,
            onChange: () => this.service.invalidate()
        });

        this.observationService = new TranslationObservationService({
            database: deps.database,
            logger: this.logger,
            listKnownNamespaces: deps.listKnownNamespaces
        });

        this.settingsService = new LocalizationSettingsService({ database: deps.database, logger: this.logger });

        this.switchService = new LanguageSwitchService({ database: deps.database, localization: this.service });

        // The provider registry is looked up per request rather than captured
        // here: the ai-tools module publishes it in its own run(), and provider
        // plugins register and unregister on it at runtime.
        this.suggestionService = new TranslationSuggestionService({
            database: deps.database,
            settings: this.settingsService,
            getProviderRegistry: () => this.serviceRegistry.get<IAiProviderRegistry>(AI_PROVIDERS_SERVICE_NAME) ?? null,
            logger: this.logger
        });

        this.initialized = true;
        this.logger.info('Localization module initialized');
    }

    /**
     * Phase 2: publish `'localization'`, mount the public and admin routers,
     * and register the admin nav entry and tab row.
     */
    async run(): Promise<void> {
        if (!this.initialized) {
            throw new Error('LocalizationModule.run() called before init()');
        }

        this.serviceRegistry.register(LOCALIZATION_SERVICE_NAME, this.service);

        // The ignore list is looked up per click rather than captured here, so
        // switch counting keeps working, unfiltered, if the traffic module has
        // not published it.
        const publicController = new LocalizationPublicController(
            this.service,
            this.observationService,
            this.switchService,
            () => this.serviceRegistry.get<ITrafficIgnoreList>(TRAFFIC_IGNORE_LIST_SERVICE_NAME) ?? null,
            this.logger
        );
        const publicRouter: Router = createLocalizationPublicRouter(publicController);
        this.app.use('/api/localization', publicRouter);

        // Translation saves get their own rate-limit bucket: a translator
        // working down a list saves far more often than anyone edits languages
        // or routes, and should not lock themselves out of the other tabs.
        // Suggestions get one too, since each click fills a row the
        // translator then saves.
        const adminController = new LocalizationAdminController(
            this.adminService,
            this.settingsService,
            this.suggestionService,
            this.switchService,
            this.logger
        );
        const adminRouter: Router = createLocalizationAdminRouter(adminController);
        this.app.use(
            '/api/admin/system/localization',
            createGroupedAdminRateLimiter(
                {
                    translations: 'localization-admin-translations',
                    'translation-suggestions': 'localization-admin-suggestions'
                },
                'localization-admin'
            ),
            requireAdmin,
            adminRouter
        );

        // Admin nav entry under the System container. Memory-only, re-created
        // each boot; the container forces `requiresAdmin` on it.
        await this.menuService.create({
            namespace: 'main',
            label: 'Localization',
            url: '/system/localization',
            icon: 'Languages',
            order: 42,
            parent: MAIN_SYSTEM_CONTAINER_ID,
            enabled: true
        });

        // The tab nodes live outside the System container, so the container's
        // forced admin gate does not reach them; each sets `requiresAdmin`.
        for (const tab of SUBMENU_TABS) {
            await this.menuService.create({
                namespace: SUBMENU_NAMESPACE,
                label: tab.label,
                url: `/system/localization?tab=${tab.tab}`,
                icon: tab.icon,
                order: tab.order,
                parent: null,
                enabled: true,
                requiresAdmin: true
            });
        }

        // Read-only status tool for AI agents. Watched rather than resolved
        // once: the ai-tools module publishes its registry during its own
        // run(), and bootstrap order does not guarantee that has happened yet.
        this.unwatchAiTools = registerLocalizationAiTools(
            this.serviceRegistry,
            {
                listLanguages: () => this.adminService.listLanguages(),
                listRoutes: () => this.adminService.listRoutes(),
                listTranslations: (query) => this.adminService.listTranslations(query),
                getSwitchStats: (days) => this.switchService.getStats(days),
                getPublicConfig: () => this.service.getPublicConfig()
            },
            this.logger
        );

        this.logger.info('Localization module running; routers mounted at /api/localization and /api/admin/system/localization');
    }

    /**
     * Expose the read service for bootstrap wiring and tests.
     *
     * @returns The configured singleton.
     */
    getLocalizationService(): LocalizationService {
        return this.service;
    }

    /**
     * Expose the admin service for tests that drive it directly.
     *
     * @returns The configured admin service.
     */
    getAdminService(): LocalizationAdminService {
        return this.adminService;
    }

    /**
     * Expose the observation service for tests that drive it directly.
     *
     * @returns The configured observation service.
     */
    getObservationService(): TranslationObservationService {
        return this.observationService;
    }
}
