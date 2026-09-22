/**
 * @fileoverview Price-history module: the always-on local price-series ingester.
 *
 * Why a module, not a plugin: the valuation surface the platform is building
 * depends on a local USD price series existing, and that series must be ingested
 * on a schedule regardless of which optional features are enabled — so it is
 * core, non-toggleable infrastructure. The module owns two scheduler jobs (a
 * bounded backward backfill and a cheap daily forward append) and publishes the
 * `'price-history'` service every valuation read routes through.
 *
 * Vendors are declared by the providers module. This module owns the
 * price-history capability, so it builds the per-vendor adapters, attaches them
 * to the registry, and hands the service one routing provider that tries the
 * operator's ordered vendors per asset class.
 */

import type { Express, Router } from 'express';
import type {
    IDatabaseService,
    IClickHouseService,
    ISchedulerService,
    IServiceRegistry,
    IMenuService,
    IWebSocketService,
    IModule,
    IModuleMetadata
} from '@/types';
import { logger } from '../../lib/logger.js';
import { WebSocketService } from '../../services/websocket.service.js';
import { MAIN_SYSTEM_CONTAINER_ID } from '../menu/index.js';
import { requireAdmin } from '../../api/middleware/admin-auth.js';
import { createAdminRateLimiter } from '../../api/middleware/rate-limit.js';
import type { IProviderRegistry } from '../providers/index.js';
import { PriceHistoryService } from './services/price-history.service.js';
import { TronScanPriceHistoryProvider } from './providers/tronscan-price-history.provider.js';
import { CoinGeckoPriceHistoryProvider } from './providers/coingecko-price-history.provider.js';
import { GeckoTerminalPriceHistoryProvider } from './providers/geckoterminal-price-history.provider.js';
import { RoutingPriceHistoryProvider } from './providers/routing-price-history.provider.js';
import { PriceHistoryAdminController } from './api/price-history.admin.controller.js';
import { createPriceHistoryAdminRouter } from './api/price-history.admin.routes.js';
import { SETTINGS_COLLECTION, PROGRESS_COLLECTION } from './database/index.js';

/** Submenu namespace for the in-page tab row (the menu Submenu Pattern). */
const SUBMENU_NAMESPACE = 'price-history';

/**
 * In-page tabs for `/system/price-history`, registered as memory-only menu nodes.
 * Schedules, Database, and Logs are the core components scoped to this module,
 * which every component with an admin page owes its operator. Settings sits last
 * because the tabs before it report state and Settings changes it.
 */
const SUBMENU_TABS: ReadonlyArray<{ label: string; tab: string; icon: string; order: number }> = [
    { label: 'Coverage', tab: 'coverage', icon: 'Table', order: 0 },
    { label: 'Diagnostics', tab: 'diagnostics', icon: 'AlertTriangle', order: 1 },
    { label: 'Schedules', tab: 'schedules', icon: 'Clock', order: 2 },
    { label: 'Database', tab: 'database', icon: 'Database', order: 3 },
    { label: 'Logs', tab: 'logs', icon: 'ScrollText', order: 4 },
    { label: 'Settings', tab: 'settings', icon: 'Settings', order: 5 }
];

/**
 * Name prefix shared by every scheduler job the module registers. The admin
 * page's Schedules tab filters on this prefix, so every job name must start
 * with it, and the lifecycle test asserts that.
 */
const JOB_PREFIX = 'price-history:';

/** Backward-backfill job: seed recent windows and walk deep history in chunks. */
const BACKFILL_JOB = `${JOB_PREFIX}backfill`;
/** Run the backfill often; each tick is bounded, so frequency only speeds catch-up. */
const BACKFILL_CRON = '*/5 * * * *';
/** Forward-append job: pull the days that closed since the last run. */
const FORWARD_JOB = `${JOB_PREFIX}forward-sync`;
/** Daily at 01:00 UTC — yesterday's close is final by then. */
const FORWARD_CRON = '0 1 * * *';

/** Dependencies the price-history module needs at bootstrap. */
export interface IPriceHistoryModuleDependencies {
    /** Mongo access for cursor/settings state. */
    database: IDatabaseService;
    /** ClickHouse access for the series; undefined disables ingestion gracefully. */
    clickhouse: IClickHouseService | undefined;
    /** Scheduler for the two ingestion jobs; null in environments without one. */
    scheduler: ISchedulerService | null;
    /** Registry to publish `'price-history'` for valuation consumers. */
    serviceRegistry: IServiceRegistry;
    /** The vendor registry the per-vendor price adapters attach to and the router reads from. */
    providerRegistry: IProviderRegistry;
    /** Express app the module mounts its admin router onto. */
    app: Express;
    /** Menu service for the System-container item and the submenu tab nodes. */
    menuService: IMenuService;
}

/**
 * Two-phase module: `init()` builds the adapters and the service and ensures its
 * indexes, `run()` wires the jobs and publishes the service.
 */
export class PriceHistoryModule implements IModule<IPriceHistoryModuleDependencies> {
    readonly metadata: IModuleMetadata = {
        id: 'price-history',
        name: 'Price History',
        version: '1.1.0',
        description: 'Scheduled local daily USD price series for TRX and TRC20 tokens, routed across the configured price vendors, for portfolio valuation.'
    };

    private scheduler: ISchedulerService | null = null;
    private serviceRegistry!: IServiceRegistry;
    private app!: Express;
    private menuService!: IMenuService;
    private service!: PriceHistoryService;
    private controller!: PriceHistoryAdminController;
    private readonly logger = logger.child({ module: 'price-history' });

    /**
     * Phase 1: build one price adapter per vendor and attach each to the
     * registry, construct the routing provider and the service, and ensure the
     * Mongo control indexes exist. No jobs, no registry publication yet.
     *
     * @param deps - Injected collaborators.
     */
    async init(deps: IPriceHistoryModuleDependencies): Promise<void> {
        this.scheduler = deps.scheduler;
        this.serviceRegistry = deps.serviceRegistry;
        this.app = deps.app;
        this.menuService = deps.menuService;

        const adapters = [
            new TronScanPriceHistoryProvider(this.logger.child({ provider: 'tronscan' })),
            new CoinGeckoPriceHistoryProvider(this.logger.child({ provider: 'coingecko' })),
            new GeckoTerminalPriceHistoryProvider(this.logger.child({ provider: 'geckoterminal' }))
        ];
        for (const adapter of adapters) {
            deps.providerRegistry.attachPriceHistoryProvider(adapter.id, adapter);
        }

        const routing = new RoutingPriceHistoryProvider(
            deps.providerRegistry,
            () => this.service.getSettings(),
            this.logger.child({ provider: 'routing' })
        );
        PriceHistoryService.setDependencies({
            database: deps.database,
            clickhouse: deps.clickhouse,
            provider: routing,
            registry: deps.providerRegistry,
            emitter: PriceHistoryModule.resolveEmitter(),
            logger: this.logger
        });
        this.service = PriceHistoryService.getInstance();
        this.controller = new PriceHistoryAdminController(this.service, this.serviceRegistry, this.logger);

        await deps.database.createIndex(PROGRESS_COLLECTION, { asset: 1 }, { unique: true });
        await deps.database.createIndex(SETTINGS_COLLECTION, { key: 1 }, { unique: true });

        this.logger.info({ vendors: adapters.map((adapter) => adapter.id) }, 'Price-history module initialized');
    }

    /**
     * Phase 2: register the backfill and forward-sync jobs and publish the
     * service. Jobs are skipped when no scheduler is present (e.g. tests).
     */
    async run(): Promise<void> {
        if (this.scheduler) {
            this.scheduler.register(BACKFILL_JOB, BACKFILL_CRON, async () => {
                await this.service.runBackfillTick();
            });
            this.scheduler.register(FORWARD_JOB, FORWARD_CRON, async () => {
                await this.service.runForwardTick();
            });
        }
        this.serviceRegistry.register('price-history', this.service);

        const adminRouter: Router = createPriceHistoryAdminRouter(this.controller);
        this.app.use(
            '/api/admin/system/price-history',
            createAdminRateLimiter('price-history-admin'),
            requireAdmin,
            adminRouter
        );

        await this.menuService.create({
            namespace: 'main',
            label: 'Price History',
            description: 'Local daily USD price series for portfolio valuation: coverage, source routing, pacing, and manual backfill.',
            url: '/system/price-history',
            icon: 'LineChart',
            order: 28,
            parent: MAIN_SYSTEM_CONTAINER_ID,
            enabled: true
        });
        for (const tab of SUBMENU_TABS) {
            await this.menuService.create({
                namespace: SUBMENU_NAMESPACE,
                label: tab.label,
                url: `/system/price-history?tab=${tab.tab}`,
                icon: tab.icon,
                order: tab.order,
                parent: null,
                enabled: true,
                requiresAdmin: true
            });
        }

        this.logger.info('Price-history module running; admin surface mounted at /system/price-history');
    }

    /**
     * Expose the service for bootstrap wiring (e.g. handing it to the valuation
     * module) without a registry round-trip.
     *
     * @returns The configured price-history service.
     */
    getPriceHistoryService(): PriceHistoryService {
        return this.service;
    }

    /**
     * Resolve the shared WebSocket service for live admin stats, tolerating a
     * deployment with WebSockets disabled (the emitter's own guard makes `emit` a
     * no-op there, and the service treats undefined as "skip broadcasts").
     *
     * @returns The WebSocket service, or undefined when unavailable.
     */
    private static resolveEmitter(): IWebSocketService | undefined {
        try {
            return WebSocketService.getInstance();
        } catch {
            return undefined;
        }
    }
}
