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
import { PluginDatabaseService, DatabaseService } from './services/database/index.js';
import { PagesModule } from './modules/pages/index.js';
import { BlockchainObserverService } from './services/blockchain-observer/index.js';
import { SystemConfigService } from './services/system-config/index.js';
import { CacheService } from './services/cache.service.js';

async function bootstrap() {
    try {
        await connectDatabase();
        const redis = createRedisClient();
        await redis.connect();

        // Create database service and Pino logger for logs module
        const coreDatabase = new DatabaseService(); // No prefix for core services
        const pinoLogger = createLogger();

        // Initialize blockchain observer service BEFORE creating Express app
        // This must happen early because routes (like blockchain.router.ts) depend on it
        logger.info({}, 'Initializing blockchain observer service...');
        const observerLogger = logger.child({ module: 'blockchain-observer' });
        BlockchainObserverService.initialize(observerLogger);
        logger.info({}, 'Blockchain observer service initialized');

        // Initialize system configuration service with database dependency
        logger.info({}, 'Initializing system configuration service...');
        const configLogger = logger.child({ module: 'system-config' });
        SystemConfigService.initialize(configLogger, coreDatabase);
        logger.info({}, 'System configuration service initialized');

        // Initialize migration system
        logger.info({}, 'Initializing database migration system...');
        try {
            await coreDatabase.initializeMigrations();
            logger.info({}, 'Database migration system initialized');
        } catch (migrationError) {
            logger.error({ migrationError, stack: migrationError instanceof Error ? migrationError.stack : undefined }, 'Migration system initialization failed');
            // Continue startup - migration system failure should not prevent app from running
        }

        // Initialize logs module FIRST (before other modules need logging)
        // This configures the logger singleton with MongoDB persistence
        // Note: We only call init() here, run() happens later after menu module initializes
        logger.info({}, 'Initializing logs module...');
        const logsModule = new LogsModule();

        // Create Express app AFTER all services it depends on are initialized
        // Routes created here will have access to BlockchainObserverService
        const app = createExpressApp(coreDatabase);

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
            const menuDatabase = new DatabaseService({ prefix: 'core_' });
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
        } catch (error) {
            logger.error({ error, stack: error instanceof Error ? error.stack : undefined }, 'MenuModule or PagesModule initialization failed');
            throw error;
        }
        logger.info({}, 'MenuModule and PagesModule initialized');

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
