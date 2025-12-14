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

import http from 'node:http';
import { env } from './config/env.js';
import { createExpressApp } from './loaders/express.js';
import { connectDatabase } from './loaders/database.js';
import { createRedisClient, disconnectRedis, getRedisClient } from './loaders/redis.js';
import { logger, createLogger } from './lib/logger.js';
import { WebSocketService } from './services/websocket.service.js';
import { initializeJobs, stopJobs } from './jobs/index.js';
import { loadPlugins } from './loaders/plugins.js';
import { MenuModule } from './modules/menu/index.js';
import { LogsModule } from './modules/logs/index.js';
import { DatabaseModule } from './modules/database/index.js';
import { ClickHouseModule } from './modules/clickhouse/index.js';
import { PagesModule } from './modules/pages/index.js';
import { ThemeModule } from './modules/theme/index.js';
import { UserModule } from './modules/user/index.js';
import { BlockchainObserverService } from './services/blockchain-observer/index.js';
import { SystemConfigService } from './services/system-config/index.js';
import { CacheService } from './services/cache.service.js';
import { ChainParametersFetcher } from './modules/chain-parameters/chain-parameters-fetcher.js';
import { ChainParametersService } from './modules/chain-parameters/chain-parameters.service.js';
import { UsdtParametersFetcher } from './modules/usdt-parameters/usdt-parameters-fetcher.js';
import { UsdtParametersService } from './modules/usdt-parameters/usdt-parameters.service.js';
import { createApiRouter } from './api/routes/index.js';
import type { Express } from 'express';
import type { IDatabaseService, IMenuService } from '@tronrelic/types';
import axios from 'axios';

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

        await initializeJobs(ctx.coreDatabase);

        try {
            await logger.waitUntilInitialized();
            await loadPlugins(ctx.coreDatabase);
        } catch (pluginError) {
            logger.error({ pluginError, stack: pluginError instanceof Error ? pluginError.stack : undefined }, 'Plugin initialization failed');
        }

        ctx.server.listen(env.PORT, () => {
            logger.info({ port: env.PORT }, 'Server listening');
        });

        process.on('SIGINT', async () => {
            logger.info('Received SIGINT, shutting down');
            stopJobs();
            await disconnectRedis();
            process.exit(0);
        });
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
    modules: {
        database: DatabaseModule;
        clickhouse: ClickHouseModule;
        menu: MenuModule;
        logs: LogsModule;
        pages: PagesModule;
        theme: ThemeModule;
        user: UserModule;
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

    // Mount API routes now that coreDatabase exists
    // Routers receive the shared database instance via dependency injection
    app.use('/api', createApiRouter(coreDatabase));

    await initializeCoreServices(coreDatabase);

    // Menu module next (others need menuService)
    const menuModule = new MenuModule();
    await menuModule.init({ database: coreDatabase, app });
    const menuService = menuModule.getMenuService();

    const cacheService = new CacheService(getRedisClient(), coreDatabase);
    const sharedDeps = { database: coreDatabase, cacheService, menuService, app };

    const logsModule = new LogsModule();
    const pagesModule = new PagesModule();
    const themeModule = new ThemeModule();
    const userModule = new UserModule();

    await logsModule.init({ pinoLogger, database: coreDatabase, app });
    await pagesModule.init(sharedDeps);
    await themeModule.init(sharedDeps);
    await userModule.init(sharedDeps);

    return {
        app,
        server,
        pinoLogger,
        coreDatabase,
        menuService,
        modules: {
            database: databaseModule,
            clickhouse: clickHouseModule,
            menu: menuModule,
            logs: logsModule,
            pages: pagesModule,
            theme: themeModule,
            user: userModule,
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
    const { modules, menuService } = ctx;

    await modules.database.run();
    await modules.clickhouse.run();
    await modules.menu.run();
    await modules.logs.run();
    await modules.pages.run();
    await modules.theme.run();
    await modules.user.run();

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
 * Temporary registrations for system pages (Overview, Config, Scheduler, etc.)
 * that will eventually move to dedicated modules. Each module should register
 * its own menu items in its run() phase.
 *
 * @param menuService - Menu service instance for registering navigation items
 * @todo Remove entries as each feature becomes a proper module
 */
async function registerTemporaryMenuItems(menuService: IMenuService): Promise<void> {
    const items = [
        { label: 'Overview', url: '/system/overview', icon: 'LayoutDashboard', order: 10 },
        { label: 'Config', url: '/system/config', icon: 'Settings', order: 15 },
        // Database (20), Logs (30) registered by their modules
        { label: 'Scheduler', url: '/system/scheduler', icon: 'Clock', order: 35 },
        // Pages (40) registered by PagesModule
        { label: 'Blockchain', url: '/system/blockchain', icon: 'Blocks', order: 45 },
        // Markets (50) registered by resource-markets plugin
        { label: 'Plugins', url: '/system/plugins', icon: 'Puzzle', order: 65 },
        { label: 'WebSockets', url: '/system/websockets', icon: 'Radio', order: 70 },
    ];

    for (const item of items) {
        await menuService.create({
            namespace: 'system',
            label: item.label,
            url: item.url,
            icon: item.icon,
            order: item.order,
            parent: null,
            enabled: true
        });
    }
}
