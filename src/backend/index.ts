/**
 * @fileoverview Application entry point with two-phase lifecycle.
 *
 * Orchestrates startup using a strict init/run separation pattern. All modules
 * and services complete their init() phase before any starts run(), ensuring
 * predictable startup and fail-fast behavior.
 *
 * This pattern applies to all initializable components—modules, services, and
 * infrastructure. Components in "Supporting Functions" are legacy singletons
 * awaiting migration to the two-phase pattern.
 *
 * @module index
 */

import { execSync } from 'node:child_process';
import { writeSync } from 'node:fs';
import http from 'node:http';
import { env } from './config/env.js';
import { createExpressApp } from './loaders/express.js';
import { connectDatabase } from './loaders/database.js';
import { createRedisClient, disconnectRedis, getRedisClient } from './loaders/redis.js';
import { logger, createLogger } from './lib/logger.js';
import { WebSocketService } from './services/websocket.service.js';
import { loadPlugins } from './loaders/plugins.js';
import { ServiceRegistry } from './services/service-registry.js';
import { ContentRegistry, CONTENT_TYPES_SERVICE } from './services/content-registry.js';
import { ContentTypesController, createContentTypesAdminRouter } from './services/content-types-admin.js';
import { ContentRouter, CONTENT_ROUTER_SERVICE } from './services/content-router.js';
import { ClassificationGate, AllowAllRoutingPolicy } from './services/content-routing-gate.js';
import { ContentRouterController, createContentRouterAdminRouter } from './services/content-router-admin.js';
import { createInternalPublishSink } from './services/internal-publish-sink.js';
import { HookRegistry, HooksController, createHooksAdminRouter, SsrHeadFragmentsController, SsrHtmlAttributesController, createSsrRouter } from './hooks/index.js';
import { requireAdmin } from './api/middleware/admin-auth.js';
import { SchedulerModule } from './modules/scheduler/index.js';
import { MenuModule, MAIN_SYSTEM_CONTAINER_ID } from './modules/menu/index.js';
import { LogsModule } from './modules/logs/index.js';
import { DatabaseModule } from './modules/database/index.js';
import { ClickHouseModule } from './modules/clickhouse/index.js';
import { PagesModule } from './modules/pages/index.js';
import { WidgetsModule } from './modules/widgets/index.js';
import { IdentityModule } from './modules/identity/index.js';
import { TrafficModule } from './modules/traffic/index.js';
import { AccountHistoryModule } from './modules/account-history/index.js';
import { PriceHistoryModule } from './modules/price-history/index.js';
import { ValuationModule } from './modules/valuation/index.js';
import { ToolsModule } from './modules/tools/index.js';
import { AiToolsModule } from './modules/ai-tools/index.js';
import { CurationModule } from './modules/curation/index.js';
import { NotificationsModule } from './modules/notifications/index.js';
import { SyndicationModule } from './modules/syndication/index.js';
import { BlockchainObserverService } from './services/blockchain-observer/index.js';
import { SystemConfigService } from './services/system-config/index.js';
import { CacheService } from './services/cache.service.js';
import { ChainParametersFetcher } from './modules/chain-parameters/chain-parameters-fetcher.js';
import { ChainParametersService } from './modules/chain-parameters/chain-parameters.service.js';
import { BlockchainService } from './modules/blockchain/blockchain.service.js';
import { TransactionDetailService } from './modules/blockchain/transaction-detail.service.js';
import { registerTransactionAiTools } from './modules/blockchain/transaction-ai-tools.js';
import { TronGridClient } from './modules/blockchain/tron-grid.client.js';
import { UsdtParametersFetcher } from './modules/usdt-parameters/usdt-parameters-fetcher.js';
import { UsdtParametersService } from './modules/usdt-parameters/usdt-parameters.service.js';
import { createApiRouter } from './api/routes/index.js';
import { PluginManagerService } from './services/plugin-manager.service.js';
import type { Express } from 'express';
import type { IDatabaseService, IMenuService, IMenuNode, IPluginManifest, IServiceRegistry, IHookRegistry, IContentRegistry, IContentRouter } from '@/types';
import axios from 'axios';

// ─────────────────────────────────────────────────────────────────────────────
// Port Diagnostics
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Identify and log the process holding a port when EADDRINUSE occurs.
 *
 * Scans /proc/net/tcp6 (then /proc/net/tcp) for the hex-encoded port to
 * find the owning inode, then walks /proc/[pid]/fd/ to match that inode
 * back to a PID. This works without root because /proc entries are readable
 * by the owning user. Falls back to lsof/fuser if /proc parsing fails.
 *
 * @param port - The port number that is already in use
 */
function identifyPortHolder(port: number): void {
    const hexPort = port.toString(16).toUpperCase().padStart(4, '0');

    // Try /proc/net approach first — no elevated privileges needed
    for (const netFile of ['/proc/net/tcp6', '/proc/net/tcp']) {
        try {
            const lines = execSync(`grep ":${hexPort} " ${netFile} 2>/dev/null`, {
                encoding: 'utf8', timeout: 3000
            }).trim().split('\n').filter(Boolean);

            for (const line of lines) {
                const cols = line.trim().split(/\s+/);
                const state = cols[3];
                if (state !== '0A') continue; // 0A = LISTEN

                const inode = cols[9];
                try {
                    const pid = execSync(
                        `find /proc/[0-9]*/fd -lname 'socket:\\[${inode}\\]' 2>/dev/null | head -1 | cut -d/ -f3`,
                        { encoding: 'utf8', timeout: 3000 }
                    ).trim();

                    if (pid) {
                        const cmdline = execSync(
                            `tr '\\0' ' ' < /proc/${pid}/cmdline 2>/dev/null`,
                            { encoding: 'utf8', timeout: 3000 }
                        ).trim();
                        writeSync(2, `[DIAGNOSTIC] Port ${port} held by PID ${pid}: ${cmdline}\n`);
                        return;
                    }
                } catch {
                    // fd walk failed — continue to fallback commands
                }
            }
        } catch {
            // /proc/net file unreadable or grep found nothing
        }
    }

    // Fallback to common CLI tools
    for (const cmd of [
        `lsof -i :${port} -sTCP:LISTEN -P -n 2>/dev/null`,
        `fuser -v ${port}/tcp 2>&1`,
    ]) {
        try {
            const result = execSync(cmd, { encoding: 'utf8', timeout: 3000 }).trim();
            if (result) {
                writeSync(2, `[DIAGNOSTIC] ${cmd}\n${result}\n`);
                return;
            }
        } catch {
            // Command unavailable or no results
        }
    }

    writeSync(2, `[DIAGNOSTIC] Could not identify process on port ${port}\n`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Entry Point
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Main application entry point.
 *
 * Executes the complete startup sequence: infrastructure → modules → scheduler
 * → plugins → server. Registers SIGINT handler for graceful shutdown.
 *
 * @throws Logs error and exits with code 1 if bootstrap fails
 */
async function bootstrap(): Promise<void> {
    try {
        const ctx = await bootstrapInit();
        await bootstrapRun(ctx);

        // Scheduler is now started by SchedulerModule.run() in bootstrapRun()

        try {
            await logger.waitUntilInitialized();
            // Pass scheduler to plugins for context.scheduler injection
            const scheduler = ctx.modules.scheduler.getSchedulerService();
            await loadPlugins(ctx.coreDatabase, scheduler, ctx.serviceRegistry, ctx.hookRegistry);
        } catch (pluginError) {
            logger.error({ pluginError, stack: pluginError instanceof Error ? pluginError.stack : undefined }, 'Plugin initialization failed');
        }

        // Register the admin Plugins dropdown AFTER loadPlugins so PluginMetadataService
        // has its dependencies injected and the initial reconciliation can observe the
        // plugins that were just activated. Bootstrap-time plugin activation bypasses
        // PluginManagerService.loadPlugin(), so no plugin:enabled events fire during
        // loadPlugins — a single post-load sync fills the dropdown, and the event
        // subscriptions set up here handle subsequent runtime enable/disable via
        // the admin UI (which does go through PluginManagerService).
        try {
            await registerPluginsAdminMenu(ctx.menuService);
        } catch (menuError) {
            logger.error({ menuError, stack: menuError instanceof Error ? menuError.stack : undefined }, 'Failed to register plugins admin menu');
        }

        ctx.server.on('error', (err: NodeJS.ErrnoException) => {
            if (err.code === 'EADDRINUSE') {
                writeSync(2, `[FATAL] Port ${env.PORT} is already in use\n`);
                identifyPortHolder(env.PORT);
            } else {
                writeSync(2, `[FATAL] Server error: ${err.message}\n`);
            }

            // Delay briefly so concurrently can read from the pipe and display
            // the message before SIGKILL terminates the entire process group.
            setTimeout(() => process.kill(0, 'SIGKILL'), 200);
        });

        ctx.server.listen(env.PORT, () => {
            logger.info({ port: env.PORT }, 'Server listening');
        });

        const shutdown = async (signal: string) => {
            logger.info({ signal }, 'Received shutdown signal');
            ctx.modules.scheduler.stop();
            ctx.server.close();
            await disconnectRedis();
            process.exit(0);
        };

        process.on('SIGINT', () => void shutdown('SIGINT'));
        process.on('SIGTERM', () => void shutdown('SIGTERM'));
    } catch (error) {
        logger.error({ error }, 'Failed to bootstrap application');
        process.exit(1);
    }
}

void bootstrap();

// ─────────────────────────────────────────────────────────────────────────────
// Two-Phase Lifecycle (applies to all modules and services)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Shared context passed from init phase to run phase.
 *
 * Contains all initialized infrastructure and module instances needed by the
 * run phase. This typed contract ensures init produces everything run requires.
 */
interface BootstrapContext {
    app: Express;
    server: http.Server;
    pinoLogger: ReturnType<typeof createLogger>;
    coreDatabase: IDatabaseService;
    menuService: IMenuService;
    serviceRegistry: IServiceRegistry;
    hookRegistry: IHookRegistry;
    contentRegistry: IContentRegistry;
    contentRouter: IContentRouter;
    modules: {
        database: DatabaseModule;
        clickhouse: ClickHouseModule;
        menu: MenuModule;
        logs: LogsModule;
        pages: PagesModule;
        widgets: WidgetsModule;
        identity: IdentityModule;
        traffic: TrafficModule;
        accountHistory: AccountHistoryModule;
        priceHistory: PriceHistoryModule;
        valuation: ValuationModule;
        tools: ToolsModule;
        notifications: NotificationsModule;
        curation: CurationModule;
        syndication: SyndicationModule;
        aiTools: AiToolsModule;
        scheduler: SchedulerModule;
    };
}

/**
 * Init Phase: Create services, prepare resources.
 *
 * All components complete init() before any starts run(). This two-phase
 * pattern ensures predictable startup:
 *
 * - Init creates services and validates configuration (fail-fast)
 * - Components can reference each other without timing dependencies
 * - No routes are mounted, no side effects occur
 *
 * If any init() fails, the application exits before exposing partial state.
 *
 * @returns Context containing all initialized components and infrastructure
 * @throws If database, redis, or any component init() fails
 */
async function bootstrapInit(): Promise<BootstrapContext> {
    await connectDatabase();
    const redis = createRedisClient();
    await redis.connect();

    const pinoLogger = createLogger();
    const app = createExpressApp();
    const server = http.createServer(app);

    if (env.ENABLE_WEBSOCKETS) {
        WebSocketService.getInstance().initialize(server);
    }

    // Database module first (others depend on it)
    const databaseModule = new DatabaseModule();
    await databaseModule.init({ logger, app });
    const coreDatabase = databaseModule.getDatabaseService();
    app.locals.database = coreDatabase;

    // ClickHouse module (optional, skips if CLICKHOUSE_HOST not configured)
    const clickHouseModule = new ClickHouseModule();
    await clickHouseModule.init({ logger, app });

    // Inject ClickHouse into database service for migrations targeting ClickHouse
    const clickhouse = clickHouseModule.getClickHouseService();
    if (clickhouse) {
        coreDatabase.setClickHouseService(clickhouse);
    }

    // Service registry must exist before the menu module so MenuService can
    // publish itself as `'menu'` for late-binding consumers during run().
    // Constructed before the API router so request-time consumers (e.g. the
    // notifications route resolving `'wallets'` to verify wallet ownership)
    // hold the registry reference; the services they look up are registered
    // later in init() and resolved lazily per request.
    const serviceRegistry = new ServiceRegistry(logger);

    // Mount API routes now that coreDatabase exists. Routers receive the shared
    // database instance via dependency injection.
    app.use('/api', createApiRouter(coreDatabase));

    await initializeCoreServices(coreDatabase);

    // Hook registry is the inverse of the service registry: plugins register
    // handlers against core-declared seams, where the service registry lets
    // plugins publish capabilities for consumers. Instantiate alongside so
    // both are available to the plugin loader.
    const hookRegistry = new HookRegistry(logger);

    // Register shared infrastructure on the service registry so modules and
    // plugins can discover them via late-binding DI instead of importing
    // concrete classes.
    serviceRegistry.register('chain-parameters', ChainParametersService.getInstance());

    // Publish the blockchain service so late-binding consumers can read
    // the latest processed block without importing the concrete singleton.
    // The core block-ticker widget's SSR data fetcher resolves this lazily
    // per request; setDependencies already ran in initializeCoreServices.
    serviceRegistry.register('blockchain', BlockchainService.getInstance());

    // Central content-type registry: one shared, process-lifetime home where
    // providers publish content types and pipelines (curation today,
    // notifications next) discover them. Constructed here as core infrastructure
    // — a peer of the service and hook registries — and published before any
    // module init so curation can resolve it when it wires its services.
    const contentRegistry = new ContentRegistry(logger);
    serviceRegistry.register(CONTENT_TYPES_SERVICE, contentRegistry);

    // Content router: the sink registry and structural Recipient List, a peer of
    // the content-type and hook registries. The classification gate is injected
    // so the deferred authorization pass swaps the policy without touching the
    // router; this slice ships the allow-all stub. Published before any module
    // init so a future sink family (curation, notifications, syndication) can
    // resolve it when wiring its services — exactly as content-types shipped
    // before its consumers.
    const contentRouter = new ContentRouter(new ClassificationGate(new AllowAllRoutingPolicy()), logger);
    serviceRegistry.register(CONTENT_ROUTER_SERVICE, contentRouter);

    // Register the internal publish sink — a credential-free `publish`-kind
    // destination so the curation destination picker has a real, selectable
    // outlet immediately; external publish sinks (a Twitter, a Telegram) register
    // later through the identical IContentSink contract. It "publishes" by writing
    // a durable record and emitting an admin WebSocket signal rather than calling
    // a third party, keeping the picker → select → deliver → record arc
    // demonstrable without any external credentials.
    contentRouter.register(
        createInternalPublishSink(
            coreDatabase,
            logger,
            (event, payload) => WebSocketService.getInstance().emit({ event, payload })
        ),
        'core'
    );

    // Transaction-detail lookup: a lazily-populated, permanent cache that fills
    // misses from the injected provider. Dependencies are injected here rather
    // than self-instantiated so the provider stays swappable.
    TransactionDetailService.setDependencies(coreDatabase, TronGridClient.getInstance());
    const transactionDetailService = TransactionDetailService.getInstance();
    await transactionDetailService.ensureIndexes();
    serviceRegistry.register('transaction-details', transactionDetailService);

    // Expose the transaction-detail lookup to the AI assistant as a read-only,
    // rate-limited core tool. Watches for the assistant service rather than
    // resolving it once, since it is a runtime-toggleable plugin.
    registerTransactionAiTools(serviceRegistry, transactionDetailService);

    // Menu module next (others need menuService)
    const menuModule = new MenuModule();
    await menuModule.init({ database: coreDatabase, serviceRegistry, app });
    const menuService = menuModule.getMenuService();

    const cacheService = new CacheService(getRedisClient(), coreDatabase);

    const sharedDeps = { database: coreDatabase, cacheService, menuService, serviceRegistry, hookRegistry, app };

    const logsModule = new LogsModule();
    const pagesModule = new PagesModule();
    const widgetsModule = new WidgetsModule();
    const identityModule = new IdentityModule();
    const trafficModule = new TrafficModule();
    const accountHistoryModule = new AccountHistoryModule();
    const priceHistoryModule = new PriceHistoryModule();
    const valuationModule = new ValuationModule();
    const toolsModule = new ToolsModule();
    const notificationsModule = new NotificationsModule();
    const curationModule = new CurationModule();
    const syndicationModule = new SyndicationModule();
    const aiToolsModule = new AiToolsModule();
    const schedulerModule = new SchedulerModule();

    await logsModule.init({ pinoLogger, database: coreDatabase, app, serviceRegistry });
    await pagesModule.init(sharedDeps);
    await widgetsModule.init(sharedDeps);
    await schedulerModule.init({ database: coreDatabase, menuService, app });
    const schedulerService = schedulerModule.getSchedulerService();
    await identityModule.init(sharedDeps);
    await trafficModule.init({ ...sharedDeps, scheduler: schedulerService, clickhouse });
    // Account-history: pull-based per-account transaction backfill into ClickHouse.
    // Receives the scheduler service (for its bounded ingestion job) and clickhouse
    // (its store); no-ops ingestion when clickhouse is absent. Independent of block sync.
    await accountHistoryModule.init({ ...sharedDeps, scheduler: schedulerService, clickhouse });
    // Price-history: scheduled local daily USD price series (CoinGecko-backed) into
    // ClickHouse, the data layer portfolio valuation reads from. No-ops ingestion
    // when clickhouse is absent. Inits before the valuation engine that consumes it.
    await priceHistoryModule.init({ database: coreDatabase, clickhouse, scheduler: schedulerService, serviceRegistry, app, menuService });
    // Valuation: joins account-history, price-history, and the caller's wallet set
    // into portfolio summaries. Owns no storage; resolves its data services lazily
    // from the registry, so it only needs the registry at init.
    await valuationModule.init({ serviceRegistry, app });
    await toolsModule.init(sharedDeps);
    // Notifications module: builds the category/channel registries, preference,
    // policy, and audit stores. Inits before ai-tools so its run() (which
    // publishes `'notifications'`) precedes ai-tools' run() that registers a
    // category and fires scheduled-prompt notifications through it.
    await notificationsModule.init(sharedDeps);
    // Curation owns the central human-review queue and publishes `'curation'`.
    // Inits after notifications (its run() fires curation-hold toasts through the
    // `'notifications'` service) and before ai-tools, whose governor watches
    // `'curation'` to verify tool `curationTypeId` bindings.
    await curationModule.init(sharedDeps);
    // Syndication owns durable publish delivery (the transactional outbox + relay)
    // and publishes `'syndication'`. Curation enqueues approved publish legs into
    // it instead of delivering inline best-effort; it resolves the service lazily
    // at decide-time, so init order relative to curation does not matter. Receives
    // the scheduler service so its relay job can register.
    await syndicationModule.init({ database: coreDatabase, serviceRegistry, scheduler: schedulerService, app });
    // The ai-tools module owns the built-in dynamic prompt variables (lifted out
    // of trp-ai-assistant), so it needs the core services those resolvers read.
    // All are singletons wired by initializeCoreServices() above; the resolvers
    // call them lazily at variable-expansion time.
    await aiToolsModule.init({
        ...sharedDeps,
        scheduler: schedulerService,
        blockchainService: BlockchainService.getInstance(),
        observerRegistry: BlockchainObserverService.getInstance(),
        chainParameters: ChainParametersService.getInstance(),
        usdtParameters: UsdtParametersService.getInstance(),
        systemConfig: SystemConfigService.getInstance()
    });

    return {
        app,
        server,
        pinoLogger,
        coreDatabase,
        menuService,
        serviceRegistry,
        hookRegistry,
        contentRegistry,
        contentRouter,
        modules: {
            database: databaseModule,
            clickhouse: clickHouseModule,
            menu: menuModule,
            logs: logsModule,
            pages: pagesModule,
            widgets: widgetsModule,
            identity: identityModule,
            traffic: trafficModule,
            accountHistory: accountHistoryModule,
            priceHistory: priceHistoryModule,
            valuation: valuationModule,
            tools: toolsModule,
            notifications: notificationsModule,
            curation: curationModule,
            syndication: syndicationModule,
            aiTools: aiToolsModule,
            scheduler: schedulerModule,
        },
    };
}

/**
 * Run Phase: Mount routes, register menus, start background tasks.
 *
 * Only called after all init() phases complete successfully. At this point:
 *
 * - All services exist and are fully configured
 * - Cross-component dependencies are resolved (e.g., menuService available)
 * - Safe to mount HTTP routes and register menu items
 *
 * Run order within this phase is flexible—components should not depend on
 * other components' run() completing first.
 *
 * @param ctx - Bootstrap context from init phase containing all components
 */
async function bootstrapRun(ctx: BootstrapContext): Promise<void> {
    const { modules, menuService, hookRegistry, contentRegistry, contentRouter, serviceRegistry, app } = ctx;

    await modules.database.run();
    await modules.clickhouse.run();
    await modules.menu.run();
    await modules.logs.run();
    await modules.pages.run();
    await modules.widgets.run();
    // Traffic runs before identity so its `/api/admin/users/{analytics,traffic}`
    // routers register before identity's `/api/admin/users` account-directory
    // catch-all — the catch-all's `/:id` matcher must not shadow those
    // more-specific prefixes.
    await modules.traffic.run();
    await modules.identity.run();
    await modules.tools.run();
    // Notifications runs after identity (so `'user-groups'` is published for
    // audience resolution) and before ai-tools (which registers a category and
    // fires scheduled-prompt run notifications through the `'notifications'`
    // service published here).
    await modules.notifications.run();
    // Curation runs after notifications (so the `'notifications'` service exists
    // for its curation-hold toast) and before ai-tools (so `'curation'` is
    // published when the governor's registry watch wires the binding resolver).
    await modules.curation.run();
    // Syndication runs after curation (curation enqueues into the `'syndication'`
    // service it publishes here) and before scheduler (which runs last and starts
    // ticking), so the relay job is registered before the scheduler activates.
    await modules.syndication.run();
    await modules.aiTools.run();
    // Account-history runs before scheduler (which runs last and starts ticking),
    // so its `account-history:ingest` job is registered before the scheduler activates.
    await modules.accountHistory.run();
    // Price-history runs before scheduler (which runs last and starts ticking), so
    // its backfill/forward-sync jobs are registered before the scheduler activates.
    await modules.priceHistory.run();
    // Valuation publishes `'valuation'`; runs after the services it consumes are
    // published, though it also resolves them lazily at call time.
    await modules.valuation.run();
    await modules.scheduler.run();

    // Mount the hook-system introspection endpoint. The route is
    // intentionally read-only: it serves the registry's snapshot for
    // the bird's-eye admin UI. Plugins do not interact with this
    // endpoint — they reach the same registry through the per-plugin
    // facade exposed on `context.hooks`.
    const hooksController = new HooksController(hookRegistry);
    app.use('/api/admin/system/hooks', requireAdmin, createHooksAdminRouter(hooksController));
    logger.info('Hook introspection router mounted at /api/admin/system/hooks');

    // Content-type introspection: the read-only aggregate view over the central
    // content registry, the analog of the hooks timeline. The controller joins
    // the curation binding lazily per request.
    const contentTypesController = new ContentTypesController(contentRegistry, serviceRegistry);
    app.use('/api/admin/system/content-types', requireAdmin, createContentTypesAdminRouter(contentTypesController));
    logger.info('Content-type introspection router mounted at /api/admin/system/content-types');

    // Content-router introspection: the read-only view over the sink registry —
    // every sink's accepts/reach, plus the gate's admitted set and structural
    // candidates for an operator-supplied classification. The analog of the
    // content-types and hooks timelines.
    const contentRouterController = new ContentRouterController(contentRouter);
    app.use('/api/admin/system/content-router', requireAdmin, createContentRouterAdminRouter(contentRouterController));
    logger.info('Content-router introspection router mounted at /api/admin/system/content-router');

    // Mount the public SSR hook endpoints. The frontend SSR layer POSTs
    // to /api/ssr/* once per page render with the request context; each
    // controller invokes its respective hook (headFragments,
    // htmlAttributes) and returns the aggregated payload. No admin gate
    // — the consumer is the application's own server-side renderer.
    const ssrFragmentsController = new SsrHeadFragmentsController(hookRegistry, logger);
    const ssrHtmlAttributesController = new SsrHtmlAttributesController(hookRegistry, logger);
    app.use('/api/ssr', createSsrRouter(ssrFragmentsController, ssrHtmlAttributesController));
    logger.info('SSR hook routers mounted at /api/ssr');

    await registerTemporaryMenuItems(menuService);
    logger.info({}, 'All modules initialized');
}

// ─────────────────────────────────────────────────────────────────────────────
// Legacy Components (awaiting two-phase migration)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Initialize legacy singleton services awaiting two-phase migration.
 *
 * These core infrastructure services predate the init/run pattern and use
 * single-call initialization. They should eventually be refactored into
 * proper modules with separate init() and run() phases.
 *
 * @param coreDatabase - Database service instance for services that need persistence
 * @throws If chain parameters or USDT parameters fail to initialize
 * @todo Migrate these services to the two-phase lifecycle pattern
 */
async function initializeCoreServices(coreDatabase: IDatabaseService): Promise<void> {
    BlockchainObserverService.initialize(logger.child({ module: 'blockchain-observer' }));
    SystemConfigService.initialize(logger.child({ module: 'system-config' }), coreDatabase);

    // Inject the database before any BlockchainService.getInstance(). The ai-tools
    // module resolves the singleton during bootstrapInit() to back its built-in
    // blockchain prompt variables — earlier than the scheduler core-jobs and plugin
    // loader that otherwise perform this injection. The constructor calls
    // getDatabase() immediately, so without this the first getInstance() throws and
    // the app never boots. setDependencies is idempotent (registerModel is a
    // Map.set), so the later calls remain harmless.
    BlockchainService.setDependencies(coreDatabase);

    // Chain parameters: inject database, fetch from TronGrid first (populates DB), then warm cache
    ChainParametersService.setDependencies(coreDatabase);
    const chainParamsFetcher = new ChainParametersFetcher(axios, logger, coreDatabase);
    await chainParamsFetcher.fetch();
    if (!await ChainParametersService.getInstance().init()) {
        throw new Error('Chain parameters service failed to initialize');
    }

    // USDT parameters: inject database, fetch from TronGrid first (populates DB), then warm cache
    UsdtParametersService.setDependencies(coreDatabase);
    const usdtParamsFetcher = new UsdtParametersFetcher(axios, logger, coreDatabase);
    await usdtParamsFetcher.fetch();
    if (!await UsdtParametersService.getInstance().init()) {
        throw new Error('USDT parameters service failed to initialize');
    }
}

/**
 * Register system monitoring menu items not yet migrated to modules.
 *
 * Temporary registration for the consolidated System admin page that has
 * not yet been promoted to a dedicated module. Each module should register
 * its own menu items in its run() phase.
 *
 * The "Overview" entry sits at order 5 so it surfaces as the first child of
 * the System container; it consolidates the former Config, Blockchain,
 * WebSockets, and Database pages into one /system/system route.
 *
 * @param menuService - Menu service instance for registering navigation items
 * @todo Remove this function once the consolidated page becomes a proper module
 */
async function registerTemporaryMenuItems(menuService: IMenuService): Promise<void> {
    const items = [
        { label: 'Overview', url: '/system/system', icon: 'SlidersHorizontal', order: 5 },
        { label: 'Hooks', url: '/system/hooks', icon: 'Network', order: 45 },
        { label: 'Content Types', url: '/system/content-types', icon: 'Boxes', order: 46 },
        { label: 'Content Router', url: '/system/content-router', icon: 'Split', order: 47 },
        // Logs (30), Scheduler (35) registered by their modules
        // Pages (40) registered by PagesModule
        // Files (42) registered by trp-files plugin
        // Markets (50) registered by resource-markets plugin
        // Plugins (65) registered by registerPluginsAdminMenu — dropdown of enabled plugin settings
        // All admin items live under the System container; requiresAdmin is auto-applied
    ];

    for (const item of items) {
        await menuService.create({
            namespace: 'main',
            label: item.label,
            url: item.url,
            icon: item.icon,
            order: item.order,
            parent: MAIN_SYSTEM_CONTAINER_ID,
            enabled: true
        });
    }
}

/**
 * Register the admin "Plugins" dropdown and keep its children synced to enabled plugins.
 *
 * Creates a parent menu node whose top link points at /system/plugins and whose children
 * are generated from each enabled plugin's `manifest.adminUrl` — the same value the cog
 * icon uses on the plugin management page. The dropdown stays current with plugin state
 * by subscribing to PluginManagerService lifecycle events; any enable or disable triggers
 * a diff-based reconciliation of the child list that creates missing nodes, updates
 * existing nodes whose label/icon/order have drifted, and removes nodes for disabled
 * plugins.
 *
 * Must run after loadPlugins so PluginMetadataService.setDependencies() has been called
 * and the initial reconciliation can enumerate plugins activated during bootstrap.
 * Bootstrap-time activation bypasses PluginManagerService and therefore emits no
 * plugin:enabled events — the initial sync compensates. Event subscriptions here only
 * handle runtime toggles via the admin UI, which go through PluginManagerService.
 *
 * @param menuService - Menu service for creating/updating/deleting menu nodes
 */
async function registerPluginsAdminMenu(menuService: IMenuService): Promise<void> {
    const container = await menuService.create({
        namespace: 'main',
        label: 'Plugins',
        url: '/system/plugins',
        icon: 'Puzzle',
        order: 65,
        parent: MAIN_SYSTEM_CONTAINER_ID,
        enabled: true
    });

    const parentId = container._id?.toString();
    if (!parentId) {
        throw new Error('Plugins admin menu container created without an _id');
    }

    const pluginManager = PluginManagerService.getInstance();

    // Serialize reconciliation so bursts of lifecycle events (e.g. multiple plugins
    // enabling during bootstrap) never race on create/delete against the same parent.
    let queue: Promise<void> = Promise.resolve();

    const reconcile = async (): Promise<void> => {
        const manifests = await pluginManager.getEnabledManifests();
        const eligible = manifests
            .filter((m): m is IPluginManifest & { adminUrl: string } => typeof m.adminUrl === 'string' && m.adminUrl.length > 0)
            .sort((a, b) => a.title.localeCompare(b.title));

        // Compute the desired order for every eligible plugin up front so inserting a
        // new plugin that sorts before an existing child rewrites that child's order
        // instead of colliding with it.
        const desiredChildren = eligible.map((manifest, index) => ({
            namespace: 'main' as const,
            label: manifest.title,
            url: manifest.adminUrl,
            icon: 'Settings',
            order: (index + 1) * 10,
            parent: parentId,
            enabled: true
        }));
        const desiredByUrl = new Map(desiredChildren.map(child => [child.url, child]));

        const existing: IMenuNode[] = menuService.getChildren(parentId, 'main');
        const existingByUrl = new Map<string, IMenuNode>();
        for (const child of existing) {
            if (!child.url || !desiredByUrl.has(child.url)) {
                if (child._id) {
                    await menuService.delete(child._id.toString());
                }
                continue;
            }
            existingByUrl.set(child.url, child);
        }

        for (const desiredChild of desiredChildren) {
            const existingChild = existingByUrl.get(desiredChild.url);
            if (!existingChild) {
                await menuService.create(desiredChild);
                continue;
            }
            if (
                existingChild._id && (
                    existingChild.label !== desiredChild.label
                    || existingChild.icon !== desiredChild.icon
                    || existingChild.order !== desiredChild.order
                    || existingChild.enabled !== desiredChild.enabled
                )
            ) {
                await menuService.update(existingChild._id.toString(), {
                    label: desiredChild.label,
                    icon: desiredChild.icon,
                    order: desiredChild.order,
                    enabled: desiredChild.enabled
                });
            }
        }
    };

    const syncChildren = (): Promise<void> => {
        queue = queue
            .then(reconcile)
            .catch(error => {
                logger.error({ error }, 'Failed to sync plugins admin dropdown');
            });
        return queue;
    };

    pluginManager.on('plugin:enabled', () => { void syncChildren(); });
    pluginManager.on('plugin:disabled', () => { void syncChildren(); });

    // Initial sync. Typically a no-op during bootstrap (plugins load after this point),
    // but covers the case where a plugin is already enabled when this runs.
    await syncChildren();
}
