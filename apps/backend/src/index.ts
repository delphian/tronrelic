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
