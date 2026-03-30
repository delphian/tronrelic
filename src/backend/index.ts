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
import { SchedulerModule } from './modules/scheduler/index.js';
import { MenuModule } from './modules/menu/index.js';
import { LogsModule } from './modules/logs/index.js';
import { DatabaseModule } from './modules/database/index.js';
import { ClickHouseModule } from './modules/clickhouse/index.js';
import { PagesModule } from './modules/pages/index.js';
import { ThemeModule } from './modules/theme/index.js';
import { UserModule } from './modules/user/index.js';
import { AddressLabelsModule } from './modules/address-labels/index.js';
import { BlockchainObserverService } from './services/blockchain-observer/index.js';
import { SystemConfigService } from './services/system-config/index.js';
import { CacheService } from './services/cache.service.js';
import { ChainParametersFetcher } from './modules/chain-parameters/chain-parameters-fetcher.js';
import { ChainParametersService } from './modules/chain-parameters/chain-parameters.service.js';
import { UsdtParametersFetcher } from './modules/usdt-parameters/usdt-parameters-fetcher.js';
import { UsdtParametersService } from './modules/usdt-parameters/usdt-parameters.service.js';
import { createApiRouter } from './api/routes/index.js';
import type { Express } from 'express';
import type { IDatabaseService, IMenuService, IServiceRegistry } from '@/types';
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
            await loadPlugins(ctx.coreDatabase, scheduler, ctx.serviceRegistry);
        } catch (pluginError) {
            logger.error({ pluginError, stack: pluginError instanceof Error ? pluginError.stack : undefined }, 'Plugin initialization failed');
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
    modules: {
        database: DatabaseModule;
        clickhouse: ClickHouseModule;
        menu: MenuModule;
        logs: LogsModule;
        pages: PagesModule;
        theme: ThemeModule;
        user: UserModule;
        addressLabels: AddressLabelsModule;
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

    // Mount API routes now that coreDatabase exists
    // Routers receive the shared database instance via dependency injection
    app.use('/api', createApiRouter(coreDatabase));

    await initializeCoreServices(coreDatabase);

    // Menu module next (others need menuService)
    const menuModule = new MenuModule();
    await menuModule.init({ database: coreDatabase, app });
    const menuService = menuModule.getMenuService();

    const cacheService = new CacheService(getRedisClient(), coreDatabase);
    const serviceRegistry = new ServiceRegistry(logger);
    const sharedDeps = { database: coreDatabase, cacheService, menuService, serviceRegistry, app };

    const logsModule = new LogsModule();
    const pagesModule = new PagesModule();
    const themeModule = new ThemeModule();
    const userModule = new UserModule();
    const addressLabelsModule = new AddressLabelsModule();
    const schedulerModule = new SchedulerModule();

    await logsModule.init({ pinoLogger, database: coreDatabase, app });
    await pagesModule.init(sharedDeps);
    await themeModule.init(sharedDeps);
    await schedulerModule.init({ database: coreDatabase, menuService, app });
    const schedulerService = schedulerModule.getSchedulerService();
    await userModule.init({ ...sharedDeps, scheduler: schedulerService });
    await addressLabelsModule.init(sharedDeps);

    return {
        app,
        server,
        pinoLogger,
        coreDatabase,
        menuService,
        serviceRegistry,
        modules: {
            database: databaseModule,
            clickhouse: clickHouseModule,
            menu: menuModule,
            logs: logsModule,
            pages: pagesModule,
            theme: themeModule,
            user: userModule,
            addressLabels: addressLabelsModule,
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
    const { modules, menuService } = ctx;

    await modules.database.run();
    await modules.clickhouse.run();
    await modules.menu.run();
    await modules.logs.run();
    await modules.pages.run();
    await modules.theme.run();
    await modules.user.run();
    await modules.addressLabels.run();
    await modules.scheduler.run();

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
        // Database (20), Logs (30), Scheduler (35) registered by their modules
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
