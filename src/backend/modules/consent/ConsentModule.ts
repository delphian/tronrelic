/**
 * @fileoverview Consent module: the cookie banner settings, the rule deciding
 * what each visitor allows, the anonymous page-view count, and the Google Ads
 * tag configuration, managed at `/system/consent`.
 *
 * Why a module rather than a plugin: the traffic module's analytics and the
 * Google Ads tag both depend on its answer, and serving visitors in the EEA,
 * the UK, and Switzerland without it would set cookies without consent. With
 * the main switch off it changes nothing, which is what lets it ship before
 * the banner is turned on.
 */

import type { Express, Router } from 'express';
import type { IDatabaseService, IMenuService, IModule, IModuleMetadata, IServiceRegistry, ITrafficIgnoreList } from '@/types';
import { logger } from '../../lib/logger.js';
import { requireAdmin } from '../../api/middleware/admin-auth.js';
import { createAdminRateLimiter } from '../../api/middleware/rate-limit.js';
import { MAIN_SYSTEM_CONTAINER_ID } from '../menu/index.js';
import { ensureConsentIndexes } from './database/index.js';
import { ConsentService } from './services/consent.service.js';
import { AnonymousPageviewService } from './services/anonymous-pageview.service.js';
import { ConsentPublicController } from './api/consent-public.controller.js';
import { ConsentAdminController } from './api/consent-admin.controller.js';
import { createConsentAdminRouter, createConsentPublicRouter } from './api/consent.routes.js';

/** Name the consent service is published under in the service registry. */
export const CONSENT_SERVICE_NAME = 'consent';

/**
 * Registry name of the traffic module's read-only ignore list, which the
 * traffic module exports as `TRAFFIC_IGNORE_LIST_SERVICE`. Written out rather
 * than imported, because the traffic barrel would load that module's
 * ClickHouse and Search Console code into this one.
 */
const TRAFFIC_IGNORE_LIST_SERVICE_NAME = 'traffic-ignore-list';

/**
 * Menu namespace holding the page's in-page tab row. Kept out of `main` so
 * the tabs never appear in the site navigation; only the page's own
 * `MenuNavClient` reads it (the menu module's Submenu Pattern).
 */
const SUBMENU_NAMESPACE = 'consent';

/**
 * The page's tab row, declared as menu nodes so it inherits per-user gating,
 * ordering, and live refresh. Settings holds the main switch, the Google Ads
 * fields, and the anonymous page-view figure. Database and Logs are the tabs
 * every module owning storage and an admin page carries.
 */
const SUBMENU_TABS: ReadonlyArray<{ label: string; tab: string; icon: string; order: number }> = [
    { label: 'Settings', tab: 'settings', icon: 'Settings', order: 0 },
    { label: 'Database', tab: 'database', icon: 'Database', order: 1 },
    { label: 'Logs', tab: 'logs', icon: 'ScrollText', order: 2 }
];

/** Dependencies the consent module needs at bootstrap. */
export interface IConsentModuleDependencies {
    /** Core database service backing the module's two collections. */
    database: IDatabaseService;
    /** Registry the module publishes `'consent'` onto, and reads the traffic ignore list from. */
    serviceRegistry: IServiceRegistry;
    /** Menu service for the admin nav entry and the page's tab row. */
    menuService: IMenuService;
    /** Express app the module mounts its routers onto. */
    app: Express;
}

/**
 * Two-phase module: `init()` wires the services and indexes, `run()` publishes
 * the consent service, mounts the routers, and registers the admin page.
 */
export class ConsentModule implements IModule<IConsentModuleDependencies> {
    readonly metadata: IModuleMetadata = {
        id: 'consent',
        name: 'Consent',
        version: '1.0.0',
        description: 'Cookie consent for visitors in the EEA, the UK, and Switzerland, and the Google Ads tag it gates.'
    };

    private serviceRegistry!: IServiceRegistry;
    private menuService!: IMenuService;
    private app!: Express;
    private service!: ConsentService;
    private pageviews!: AnonymousPageviewService;
    private initialized = false;
    private readonly logger = logger.child({ module: 'consent' });

    /**
     * Phase 1: build the services and make sure the indexes exist.
     *
     * The consent service is ready after this phase, so bootstrap can hand it
     * to the traffic module's `init()` before any module runs.
     *
     * @param deps - Injected collaborators.
     */
    async init(deps: IConsentModuleDependencies): Promise<void> {
        this.serviceRegistry = deps.serviceRegistry;
        this.menuService = deps.menuService;
        this.app = deps.app;

        await ensureConsentIndexes(deps.database);

        ConsentService.setDependencies({ database: deps.database, logger: this.logger });
        this.service = ConsentService.getInstance();
        this.pageviews = new AnonymousPageviewService(deps.database);

        this.initialized = true;
        this.logger.info('Consent module initialized');
    }

    /**
     * Phase 2: publish `'consent'`, mount the public and admin routers, and
     * register the admin nav entry and tab row.
     */
    async run(): Promise<void> {
        if (!this.initialized) {
            throw new Error('ConsentModule.run() called before init()');
        }

        this.serviceRegistry.register(CONSENT_SERVICE_NAME, this.service);

        // The ignore list is looked up per page view rather than captured
        // here, so counting keeps working, unfiltered, if the traffic module
        // has not published it.
        const publicController = new ConsentPublicController(
            this.service,
            this.pageviews,
            () => this.serviceRegistry.get<ITrafficIgnoreList>(TRAFFIC_IGNORE_LIST_SERVICE_NAME) ?? null,
            this.logger
        );
        const publicRouter: Router = createConsentPublicRouter(publicController);
        this.app.use('/api/consent', publicRouter);

        const adminController = new ConsentAdminController(this.service, this.pageviews, this.logger);
        const adminRouter: Router = createConsentAdminRouter(adminController);
        this.app.use('/api/admin/system/consent', createAdminRateLimiter('consent-admin'), requireAdmin, adminRouter);

        // Admin nav entry under the System container. Memory-only, re-created
        // each boot; the container forces `requiresAdmin` on it.
        await this.menuService.create({
            namespace: 'main',
            label: 'Consent',
            url: '/system/consent',
            icon: 'Cookie',
            order: 43,
            parent: MAIN_SYSTEM_CONTAINER_ID,
            enabled: true
        });

        // The tab nodes live outside the System container, so the container's
        // forced admin gate does not reach them; each sets `requiresAdmin`.
        for (const tab of SUBMENU_TABS) {
            await this.menuService.create({
                namespace: SUBMENU_NAMESPACE,
                label: tab.label,
                url: `/system/consent?tab=${tab.tab}`,
                icon: tab.icon,
                order: tab.order,
                parent: null,
                enabled: true,
                requiresAdmin: true
            });
        }

        this.logger.info('Consent module running; routers mounted at /api/consent and /api/admin/system/consent');
    }

    /**
     * Expose the consent service for bootstrap wiring and tests.
     *
     * @returns The configured singleton.
     * @throws When called before `init()`, which is a bootstrap ordering bug.
     */
    getConsentService(): ConsentService {
        if (!this.initialized) {
            throw new Error('ConsentModule.getConsentService() called before init()');
        }
        return this.service;
    }
}
