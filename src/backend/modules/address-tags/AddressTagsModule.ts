/**
 * @fileoverview Address Tags module: publishes the central address-tag CRUD
 * service and mounts its thin HTTP wrappers.
 *
 * Why a module: address tags are shared vocabulary infrastructure other
 * surfaces (UI, AI tools, sinks, plugins) read through one authority via the
 * service registry (`'address-tags'`), with no runtime toggle. All business
 * logic lives in `AddressTagService`; the routes here are envelope-thin.
 * Reads are gated to registered users (`requireLogin`), mutations to the
 * admin group (`requireAdmin`).
 */

import type { Express, Router } from 'express';
import type { IDatabaseService, IMenuService, IModule, IModuleMetadata, ISchedulerService, IServiceRegistry } from '@/types';
import { logger } from '../../lib/logger.js';
import { requireLogin } from '../../api/middleware/require-login.js';
import { requireAdmin } from '../../api/middleware/admin-auth.js';
import { createAdminRateLimiter, createRateLimiter } from '../../api/middleware/rate-limit.js';
import { MAIN_SYSTEM_CONTAINER_ID } from '../menu/index.js';
import { TronGridClient } from '../blockchain/tron-grid.client.js';
import { AddressTagService } from './services/address-tag.service.js';
import { TagIngestionService } from './services/tag-ingestion.service.js';
import { OfacSdnSource, OFAC_SOURCE_ID } from './sources/ofac-sdn.source.js';
import { UsdtBlacklistSource, USDT_SOURCE_ID } from './sources/usdt-blacklist.source.js';
import { ChainalysisSource } from './sources/chainalysis.source.js';
import { AddressTagsUserController } from './api/address-tags-user.controller.js';
import { AddressTagsAdminController } from './api/address-tags-admin.controller.js';
import { AddressTagsSourcesController } from './api/address-tags-sources.controller.js';
import { createAddressTagsAdminRouter, createAddressTagsUserRouter } from './api/address-tags.routes.js';

/**
 * Dedicated menu namespace for the page's in-page tab row. Kept out of `main`
 * so the tabs never leak into the global nav chrome — only the page's own
 * `MenuNavClient` reads this namespace (menu module's Submenu Pattern).
 */
const SUBMENU_NAMESPACE = 'address-tags';

/**
 * The in-page tab row, declared as menu nodes rather than a hand-rolled button
 * array so it inherits per-user gating, ordering, and live `menu:update`
 * refresh, and so a plugin can contribute a tab later. Each `url` carries a
 * `?tab=` the client reads to drive the active panel.
 */
const SUBMENU_TABS: ReadonlyArray<{ label: string; tab: string; icon: string; order: number }> = [
    { label: 'Tags', tab: 'tags', icon: 'Tags', order: 0 },
    { label: 'Sources', tab: 'sources', icon: 'Rss', order: 1 },
    // Schedules and Database are the obligation any component that owns a
    // scheduler job or a collection carries: surface those jobs and that
    // storage on the component's own admin page. This module owns three jobs
    // and one collection, and an operator diagnosing stale sanctions data
    // should not have to leave for /system/scheduler or /system/database, lose
    // the page they were on, and then pick this module's rows back out of the
    // whole deployment's inventory. Both panels are core components filtered to
    // this module, so the module owns no admin furniture of its own and the
    // authority behind each tab is the same one /system uses.
    { label: 'Schedules', tab: 'schedules', icon: 'Clock', order: 2 },
    { label: 'Database', tab: 'database', icon: 'Database', order: 3 },
    // Settings sits last, after every tab that reports what the module is
    // doing. The four before it answer "what state is this module in", which is
    // what an operator opens the page for; Settings changes that state and is
    // visited far less often, so putting it at the end keeps the reporting tabs
    // adjacent instead of splitting them around it.
    { label: 'Settings', tab: 'settings', icon: 'Settings', order: 4 }
];

/**
 * Prefix every scheduler job this module registers shares.
 *
 * The Schedules tab filters on this prefix rather than a fixed list of names,
 * so a job added later appears without a matching UI change. The frontend keeps
 * its own copy of the literal — it cannot import backend code — and the module
 * lifecycle test asserts every registered job name starts with it, which is
 * what keeps the two honest.
 */
const JOB_PREFIX = 'address-tags:';

/** Scheduler job names, prefixed by module id per the scheduler convention. */
const OFAC_JOB = `${JOB_PREFIX}sync-ofac`;
const USDT_JOB = `${JOB_PREFIX}sync-usdt-blacklist`;
const VERIFY_JOB = `${JOB_PREFIX}verify-frozen`;

/** Weekly re-verification of held freezes: Mondays 04:00 UTC. */
const VERIFY_CRON = '0 0 4 * * 1';

/** Dependencies the address-tags module needs at bootstrap. */
export interface IAddressTagsModuleDependencies {
    /** Core database service backing the tags collection. */
    database: IDatabaseService;
    /** Registry the module publishes `'address-tags'` onto. */
    serviceRegistry: IServiceRegistry;
    /** Menu service used to register the /system/address-tags nav item. */
    menuService: IMenuService;
    /** Express app the module mounts its routers onto. */
    app: Express;
    /**
     * Scheduler the ingestion jobs register on; nullable (the price-history
     * pattern) so tests can omit it. With no scheduler — including
     * `ENABLE_SCHEDULER=false` — nothing ingests, which is the intended kill
     * switch for the whole feed pipeline.
     */
    scheduler: ISchedulerService | null;
}

/**
 * Two-phase module: `init()` wires the singleton service and its indexes,
 * `run()` publishes the service, mounts the gated routers, and registers the
 * admin nav item.
 */
export class AddressTagsModule implements IModule<IAddressTagsModuleDependencies> {
    readonly metadata: IModuleMetadata = {
        id: 'address-tags',
        name: 'Address Tags',
        version: '1.0.0',
        description: 'Central CRUD service for text tags on TRON wallet addresses.'
    };

    private serviceRegistry!: IServiceRegistry;
    private menuService!: IMenuService;
    private app!: Express;
    private scheduler: ISchedulerService | null = null;
    private service!: AddressTagService;
    private ingestion!: TagIngestionService;
    private readonly logger = logger.child({ module: 'address-tags' });

    /**
     * Phase 1: construct the tag service, the ingestion service with its three
     * sources, and ensure indexes.
     *
     * @param deps - Injected collaborators.
     */
    async init(deps: IAddressTagsModuleDependencies): Promise<void> {
        this.serviceRegistry = deps.serviceRegistry;
        this.menuService = deps.menuService;
        this.app = deps.app;
        this.scheduler = deps.scheduler;
        AddressTagService.setDependencies({ database: deps.database, logger: this.logger });
        this.service = AddressTagService.getInstance();
        await this.service.ensureIndexes();

        // The ingestion side: cursors, run state, and the settings live in the
        // module's key-value area; the sources are constructed here so their
        // transports are real in production and injectable in tests.
        this.ingestion = new TagIngestionService({
            tags: this.service,
            database: deps.database,
            logger: this.logger
        });
        this.ingestion.registerSource(new OfacSdnSource());
        this.ingestion.registerSource(new UsdtBlacklistSource(TronGridClient.getInstance()));
        this.ingestion.registerSource(new ChainalysisSource(() => this.ingestion.readChainalysisKey()));

        // Backstop for the two-deploy provenance rollout: once the read paths
        // filter on `active` (phase 1b), documents the backfill migration has
        // not stamped disappear from every surface, and a blank tag surface is
        // indistinguishable from an empty collection. Logging the migration by
        // name here is what makes that state diagnosable. An error rather than
        // a throw: the module still works before the filter ships, so startup
        // must not fail over an unexecuted migration.
        const unstamped = await this.service.countDocumentsMissingProvenance();
        if (unstamped > 0) {
            this.logger.error(
                { unstamped, migration: 'module:address-tags:001_add_provenance_fields' },
                'Address-tag documents lack provenance fields; run the 001_add_provenance_fields migration from /system/database before deploying the liveness filter'
            );
        }

        this.logger.info('Address-tags module initialized');
    }

    /**
     * Phase 2: publish the service, mount the user (read) and admin (mutate +
     * source-operations) routers, register the admin menu entry plus the
     * in-page tab row, and register the ingestion jobs when a scheduler is
     * present. Guards are applied here at mount, keeping the router factories
     * declarative.
     */
    async run(): Promise<void> {
        this.serviceRegistry.register('address-tags', this.service);

        const userController = new AddressTagsUserController(this.service, this.logger);
        const userRouter: Router = createAddressTagsUserRouter(userController);
        this.app.use(
            '/api/address-tags',
            createRateLimiter({ windowSeconds: 60, maxRequests: 120, keyPrefix: 'address-tags-user' }),
            requireLogin,
            userRouter
        );

        const adminController = new AddressTagsAdminController(this.service, this.logger);
        const sourcesController = new AddressTagsSourcesController(this.ingestion, this.logger);
        const adminRouter: Router = createAddressTagsAdminRouter(adminController, sourcesController);
        this.app.use(
            '/api/admin/system/address-tags',
            createAdminRateLimiter('address-tags-admin'),
            requireAdmin,
            adminRouter
        );

        // Admin nav item under the System container. Memory-only (re-created
        // each boot); the parent-chain walk forces `requiresAdmin` on it.
        await this.menuService.create({
            namespace: 'main',
            label: 'Address Tags',
            url: '/system/address-tags',
            icon: 'Tags',
            order: 38,
            parent: MAIN_SYSTEM_CONTAINER_ID,
            enabled: true
        });

        // Register the in-page tab row as a namespaced menu (Submenu Pattern).
        // The nodes are memory-only and live outside the System container, so
        // the container's non-bypassable `requiresAdmin` force does not reach
        // them — the module sets `requiresAdmin` per node itself. The page
        // renders this namespace with MenuNavClient instead of hand-rolling tabs.
        for (const tab of SUBMENU_TABS) {
            await this.menuService.create({
                namespace: SUBMENU_NAMESPACE,
                label: tab.label,
                url: `/system/address-tags?tab=${tab.tab}`,
                icon: tab.icon,
                order: tab.order,
                parent: null,
                enabled: true,
                requiresAdmin: true
            });
        }

        // Ingestion jobs. With no scheduler (tests, ENABLE_SCHEDULER=false)
        // nothing ingests — that is the pipeline's kill switch, and the
        // Sources tab says so rather than leaving an operator to wonder why
        // the feeds are stale. Each handler consults the per-source enable
        // switch at run time, because that switch is runtime-editable config
        // and a job registered at boot must honour the current value.
        if (this.scheduler) {
            this.scheduler.register(OFAC_JOB, '0 0 6 * * *', async () => {
                if (await this.ingestion.isSourceEnabled(OFAC_SOURCE_ID)) {
                    await this.ingestion.runSource(OFAC_SOURCE_ID);
                }
            });
            this.scheduler.register(USDT_JOB, '0 */5 * * * *', async () => {
                if (await this.ingestion.isSourceEnabled(USDT_SOURCE_ID)) {
                    await this.ingestion.runSource(USDT_SOURCE_ID);
                }
            });
            this.scheduler.register(VERIFY_JOB, VERIFY_CRON, async () => {
                if (await this.ingestion.isSourceEnabled(USDT_SOURCE_ID)) {
                    await this.ingestion.verifyHeld(USDT_SOURCE_ID);
                }
            });
        }

        this.logger.info('Address-tags module running; routers mounted');
    }

    /**
     * Expose the service for bootstrap wiring without a registry round-trip.
     *
     * @returns The configured address-tag service.
     */
    getAddressTagService(): AddressTagService {
        return this.service;
    }

    /**
     * Expose the ingestion service for tests that drive runs directly rather
     * than through the HTTP layer.
     *
     * @returns The configured ingestion service.
     */
    getTagIngestionService(): TagIngestionService {
        return this.ingestion;
    }
}
