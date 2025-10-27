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
import { PagesModule } from './modules/pages/index.js';
import { BlockchainObserverService } from './services/blockchain-observer/index.js';
import { SystemConfigService } from './services/system-config/index.js';
import { CacheService } from './services/cache.service.js';

async function bootstrap() {
    try {
        await connectDatabase();
        const redis = createRedisClient();
        await redis.connect();

        // Create Pino logger for logs module
        const pinoLogger = createLogger();

        // Initialize database module FIRST (two-phase: init creates services, run mounts routes)
        logger.info({}, 'Initializing database module (phase 1: init)...');
        const databaseModule = new DatabaseModule();

        // Create Express app early so we can pass it to modules
        // Note: At this point no routes are mounted yet, that happens in module run() phases
        const app = createExpressApp(null as any); // Will update with database reference below

        // Phase 1: Initialize database module (creates DatabaseService, initializes migrations)
        await databaseModule.init({
            logger: logger,
            app: app
        });
        const coreDatabase = databaseModule.getDatabaseService();
        logger.info({}, 'Database module initialized (services created, migrations scanned)');

        // Now update the Express app with the actual database reference
        // This is needed for routes that were created during createExpressApp()
        (app as any).locals.database = coreDatabase;

        // Initialize blockchain observer service BEFORE other modules
        // This must happen early because routes depend on it
        logger.info({}, 'Initializing blockchain observer service...');
        const observerLogger = logger.child({ module: 'blockchain-observer' });
        BlockchainObserverService.initialize(observerLogger);
        logger.info({}, 'Blockchain observer service initialized');

        // Initialize system configuration service with database dependency
        logger.info({}, 'Initializing system configuration service...');
        const configLogger = logger.child({ module: 'system-config' });
        SystemConfigService.initialize(configLogger, coreDatabase);
        logger.info({}, 'System configuration service initialized');

        // Initialize logs module FIRST (before other modules need logging)
        // This configures the logger singleton with MongoDB persistence
        // Note: We only call init() here, run() happens later after menu module initializes
        logger.info({}, 'Initializing logs module...');
        const logsModule = new LogsModule();

        await logsModule.init({
            pinoLogger,
            database: coreDatabase,
            app
        });
        logger.info({}, 'Logs module initialized - logging with MongoDB persistence active');

        // Create HTTP server (app was already created for logs module)
        logger.info({}, 'Creating HTTP server...');
        const server = http.createServer(app);
        logger.info({}, 'HTTP server initialized');

        // Initialize WebSocket BEFORE loading plugins so they can use it
        if (env.ENABLE_WEBSOCKETS) {
            WebSocketService.getInstance().initialize(server);
        }
        logger.info({}, 'WebSocketService initialized');

        // Initialize menu module with database dependency injection
        // Use 'core_' as the prefix to distinguish from plugin collections
        try {
            const { DatabaseService } = await import('./modules/database/index.js');
            const menuDatabase = new DatabaseService(logger, { prefix: 'core_' });
            const menuModule = new MenuModule();

            // Phase 1: Initialize MenuModule (create services, load menu tree)
            await menuModule.init({
                database: menuDatabase,
                app
            });

            // Phase 2: Run MenuModule (mount routes)
            await menuModule.run();

            // Now run logs module so it can register its menu item
            // (MenuService is now available via getInstance())
            await logsModule.run();
            logger.info({}, 'Logs module menu registration complete');

            // Get MenuService instance for other modules to use
            const menuService = menuModule.getMenuService();

            // Initialize pages module with all dependencies (database, cache, menu, app)
            // Using two-phase initialization pattern: init() then run()
            const redis = getRedisClient();
            const cacheService = new CacheService(redis);
            const pagesModule = new PagesModule();

            // Phase 1: Initialize (create services, prepare resources)
            await pagesModule.init({
                database: coreDatabase,
                cacheService,
                menuService,
                app
            });

            // Phase 2: Run (mount routes, register menu items)
            await pagesModule.run();

            // Phase 2: Run database module (mount migration routes)
            await databaseModule.run();
            logger.info({}, 'Database module running (migration routes mounted)');

            // ============================================================================
            // TEMPORARY: Register remaining system monitoring menu items
            // ============================================================================
            // These menu items are for system monitoring pages that haven't been migrated
            // to the module system yet. They are registered directly here as a temporary
            // measure until each corresponding feature is converted to a proper module.
            //
            // TODO: As each system monitoring feature is migrated to a module, remove the
            // corresponding menu registration from this section and add it to the module's
            // run() phase (following the pattern in LogsModule.ts and PagesModule.ts).
            //
            // Pages still needing module migration:
            // - Overview (system overview dashboard)
            // - Blockchain (blockchain sync monitoring)
            // - Scheduler (job scheduler management)
            // - Markets (market data monitoring)
            // - Health (system health checks)
            // - Config (configuration display)
            // - Plugins (plugin management)
            // - WebSockets (WebSocket statistics)
            // ============================================================================
            try {
                logger.info({}, 'Registering temporary system monitoring menu items...');

                // Overview - Main dashboard (order: 10)
                await menuService.create({
                    namespace: 'system',
                    label: 'Overview',
                    url: '/system/overview',
                    icon: 'LayoutDashboard',
                    order: 10,
                    parent: null,
                    enabled: true
                    // persist defaults to false (memory-only entry)
                });

                // Config - Configuration display (order: 15)
                await menuService.create({
                    namespace: 'system',
                    label: 'Config',
                    url: '/system/config',
                    icon: 'Settings',
                    order: 15,
                    parent: null,
                    enabled: true
                });

                // Database menu item already registered by DatabaseModule (order: 20)

                // Logs menu item already registered by LogsModule (order: 30)

                // Scheduler - Job scheduler management (order: 35)
                await menuService.create({
                    namespace: 'system',
                    label: 'Scheduler',
                    url: '/system/scheduler',
                    icon: 'Clock',
                    order: 35,
                    parent: null,
                    enabled: true
                });

                // Blockchain - Blockchain sync status (order: 45)
                await menuService.create({
                    namespace: 'system',
                    label: 'Blockchain',
                    url: '/system/blockchain',
                    icon: 'Blocks',
                    order: 45,
                    parent: null,
                    enabled: true
                });

                // Markets - Market data monitoring (order: 50)
                await menuService.create({
                    namespace: 'system',
                    label: 'Markets',
                    url: '/system/markets',
                    icon: 'TrendingUp',
                    order: 50,
                    parent: null,
                    enabled: true
                });

                // Health - System health checks (order: 55)
                await menuService.create({
                    namespace: 'system',
                    label: 'Health',
                    url: '/system/health',
                    icon: 'Activity',
                    order: 55,
                    parent: null,
                    enabled: true
                });

                // Plugins - Plugin management (order: 65)
                await menuService.create({
                    namespace: 'system',
                    label: 'Plugins',
                    url: '/system/plugins',
                    icon: 'Puzzle',
                    order: 65,
                    parent: null,
                    enabled: true
                });

                // Pages menu item already registered by PagesModule (order: 40)

                // WebSockets - WebSocket statistics (order: 70)
                await menuService.create({
                    namespace: 'system',
                    label: 'WebSockets',
                    url: '/system/websockets',
                    icon: 'Radio',
                    order: 70,
                    parent: null,
                    enabled: true
                });

                logger.info({}, 'Temporary system monitoring menu items registered');
            } catch (menuError) {
                logger.error({ menuError }, 'Failed to register temporary system menu items');
                throw menuError;
            }
            // ============================================================================
            // END TEMPORARY MENU REGISTRATIONS
            // ============================================================================
        } catch (error) {
            logger.error({ error, stack: error instanceof Error ? error.stack : undefined }, 'Module initialization failed');
            throw error;
        }
        logger.info({}, 'All core modules initialized');

        // Load plugins AFTER WebSocket is initialized so they can register handlers
        try {
            await loadPlugins();
        } catch (pluginError) {
            logger.error({ pluginError, stack: pluginError instanceof Error ? pluginError.stack : undefined }, 'Plugin initialization failed')
        }
        logger.info({}, 'Plugins initialized');

        await initializeJobs();

        server.listen(env.PORT, () => {
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
