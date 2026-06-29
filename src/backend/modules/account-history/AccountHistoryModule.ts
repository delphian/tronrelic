/**
 * @fileoverview AccountHistoryModule — pull-based per-account transaction ingest.
 *
 * Tracks the full transaction history of operator-chosen TRON accounts into
 * ClickHouse, independent of the forward block-sync pipeline. It owns one
 * service (`IAccountHistoryService`, published as `'account-history'`), a bounded
 * scheduler ingestion job, an admin API, and a `/system/account-history` menu
 * entry. The module is always-on (a core module cannot be toggled), so the
 * tracked set and the `ingestionEnabled` setting are the real control surface;
 * it degrades to a no-op when ClickHouse is absent.
 */

import type { Express, Router } from 'express';
import type {
    HookRegisterDisposer,
    IClickHouseService,
    IDatabaseService,
    IHookRegistry,
    IMenuService,
    IModule,
    IModuleMetadata,
    ISchedulerService,
    IServiceRegistry,
    IWebSocketService
} from '@/types';
import { logger } from '../../lib/logger.js';
import { MAIN_SYSTEM_CONTAINER_ID } from '../menu/index.js';
import { requireAdmin } from '../../api/middleware/admin-auth.js';
import { requireLogin } from '../../api/middleware/require-login.js';
import { createAdminRateLimiter, createRateLimiter } from '../../api/middleware/rate-limit.js';
import { HOOKS } from '../../hooks/registry.js';
import { WebSocketService } from '../../services/websocket.service.js';
import { AccountHistoryService } from './services/account-history.service.js';
import { AccountHistoryController } from './api/account-history.controller.js';
import { AccountHistoryUserController } from './api/account-history-user.controller.js';
import { createAccountHistoryRouter } from './api/account-history.routes.js';
import { createAccountHistoryUserRouter } from './api/account-history-user.routes.js';
import { TronGridAccountHistoryProvider } from './providers/trongrid-account-history.provider.js';

/**
 * Dependencies the account-history module requires at bootstrap.
 */
export interface IAccountHistoryModuleDependencies {
    /** Core database for the control collections. */
    database: IDatabaseService;
    /** Express app the module mounts its admin router onto. */
    app: Express;
    /** Menu service for the System-container admin entry. */
    menuService: IMenuService;
    /** Scheduler for the recurring ingestion job; null disables the job. */
    scheduler: ISchedulerService | null;
    /** ClickHouse store; undefined makes ingestion and reads no-ops. */
    clickhouse: IClickHouseService | undefined;
    /** Service registry for publishing `'account-history'` and resolving `'wallets'`. */
    serviceRegistry: IServiceRegistry;
    /**
     * Declared-hook registry. The module registers a `'core'` handler on the
     * `http.walletLinked` seam so a freshly verified wallet is auto-enrolled
     * into the backfill program.
     */
    hookRegistry: IHookRegistry;
}

/**
 * Cron for the ingestion job. Every two minutes keeps backfills moving while
 * staying gentle on the shared TronGrid budget; operators retune it from the
 * scheduler (and see it on the module's Schedules tab).
 */
const INGESTION_CRON = '*/2 * * * *';

/** Scheduler job name; the `account-history:` prefix scopes the module's Schedules tab. */
const INGESTION_JOB = 'account-history:ingest';

/**
 * Cron for the forward-sync job. Slower than the backfill: completed accounts
 * only need their leading edge refreshed, and each poll is cheap (normally one
 * page per endpoint). Five minutes keeps finished accounts current without
 * crowding the shared TronGrid budget the live block sync depends on.
 */
const FORWARD_SYNC_CRON = '*/5 * * * *';

/** Scheduler job name for the completed-account forward delta poll. */
const FORWARD_SYNC_JOB = 'account-history:forward-sync';

/**
 * Two-phase core module wiring the account-history service, job, API, and menu.
 */
export class AccountHistoryModule implements IModule<IAccountHistoryModuleDependencies> {
    readonly metadata: IModuleMetadata = {
        id: 'account-history',
        name: 'Account History',
        version: '1.0.0',
        description: 'Pull-based per-account TRON transaction history ingested into ClickHouse'
    };

    private app!: Express;
    private menuService!: IMenuService;
    private scheduler!: ISchedulerService | null;
    private serviceRegistry!: IServiceRegistry;
    private hookRegistry!: IHookRegistry;
    private service!: AccountHistoryService;
    private controller!: AccountHistoryController;
    private userController!: AccountHistoryUserController;

    /**
     * Disposer for the `http.walletLinked` handler. A core module lives for the
     * process lifetime so this is never called; kept for symmetry with the
     * plugin facade pattern and to make the registration auditable.
     */
    private walletLinkedDisposer: HookRegisterDisposer | null = null;

    private readonly logger = logger.child({ module: 'account-history' });

    /**
     * Phase 1: create the service and controller; do not mount routes.
     *
     * @param dependencies - Injected collaborators.
     */
    async init(dependencies: IAccountHistoryModuleDependencies): Promise<void> {
        this.logger.info('Initializing account-history module...');

        this.app = dependencies.app;
        this.menuService = dependencies.menuService;
        this.scheduler = dependencies.scheduler;
        this.serviceRegistry = dependencies.serviceRegistry;
        this.hookRegistry = dependencies.hookRegistry;

        const provider = new TronGridAccountHistoryProvider();
        const emitter = AccountHistoryModule.resolveEmitter();

        AccountHistoryService.setDependencies({
            database: dependencies.database,
            clickhouse: dependencies.clickhouse,
            provider,
            emitter,
            logger: this.logger
        });
        this.service = AccountHistoryService.getInstance();
        await this.service.ensureIndexes();

        this.controller = new AccountHistoryController(this.service, this.logger);
        this.userController = new AccountHistoryUserController(this.service, this.serviceRegistry, this.logger);

        this.logger.info('Account-history module initialized');
    }

    /**
     * Phase 2: register the menu entry, mount the admin router, register the
     * ingestion job, and publish the service for late-binding consumers.
     */
    async run(): Promise<void> {
        this.logger.info('Running account-history module...');

        try {
            await this.menuService.create({
                namespace: 'main',
                label: 'Account History',
                url: '/system/account-history',
                icon: 'History',
                order: 27,
                parent: MAIN_SYSTEM_CONTAINER_ID,
                enabled: true
            });
            this.logger.info('Account-history menu item registered under the System container');
        } catch (error) {
            this.logger.error({ error }, 'Failed to register account-history menu item');
            throw new Error(`Failed to register account-history menu item: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }

        const router: Router = createAccountHistoryRouter(this.controller);
        this.app.use(
            '/api/admin/system/account-history',
            createAdminRateLimiter('account-history-admin'),
            requireAdmin,
            router
        );
        this.logger.info('Account-history admin router mounted at /api/admin/system/account-history');

        // Login-gated, ownership-scoped progress for a user's own verified
        // wallets — kept separate from the admin surface so a signed-in user
        // never reaches the full tracked set.
        const userRouter: Router = createAccountHistoryUserRouter(this.userController);
        this.app.use(
            '/api/account-history',
            createRateLimiter({ windowSeconds: 60, maxRequests: 60, keyPrefix: 'account-history-user' }),
            requireLogin,
            userRouter
        );
        this.logger.info('Account-history user router mounted at /api/account-history');

        if (this.scheduler) {
            this.scheduler.register(INGESTION_JOB, INGESTION_CRON, async () => {
                await this.service.runIngestionTick();
            });
            this.scheduler.register(FORWARD_SYNC_JOB, FORWARD_SYNC_CRON, async () => {
                await this.service.runForwardSyncTick();
            });
            this.logger.info('Account-history ingestion and forward-sync jobs registered');
        } else {
            this.logger.info('Scheduler disabled — account-history ingestion and forward-sync jobs not registered');
        }

        this.serviceRegistry.register('account-history', this.service);
        this.logger.info('Registered account-history on the service registry');

        // Auto-enroll a freshly verified wallet into the backfill program when a
        // user links it. Observer isolation keeps a failed enroll from breaking
        // the link; addTrackedAccount is idempotent, so a re-link (or an address
        // an operator already tracks) is a harmless label-only no-op.
        this.walletLinkedDisposer = this.hookRegistry.register(
            'core',
            HOOKS.http.walletLinked,
            async ({ address }) => {
                await this.service.addTrackedAccount({ address, label: 'user-verified' });
            },
            { priority: 100 }
        );
        this.logger.info('Registered http.walletLinked handler — verified wallets auto-enroll into account history');

        this.logger.info('Account-history module running');
    }

    /**
     * Resolve the WebSocket emitter for live stats, tolerating a deployment with
     * WebSockets disabled (the emitter's own guard makes `emit` a no-op there).
     *
     * @returns The shared WebSocket service, or undefined if unavailable.
     */
    private static resolveEmitter(): IWebSocketService | undefined {
        try {
            return WebSocketService.getInstance();
        } catch {
            return undefined;
        }
    }
}
