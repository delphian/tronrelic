import http from 'node:http';
import { env } from './config/env.js';
import { createExpressApp } from './loaders/express.js';
import { connectDatabase } from './loaders/database.js';
import { createRedisClient, disconnectRedis } from './loaders/redis.js';
import { logger } from './lib/logger.js';
import { WebSocketService } from './services/websocket.service.js';
import { initializeJobs, stopJobs } from './jobs/index.js';
import { loadPlugins } from './loaders/plugins.js';
import { MenuService } from './modules/menu/menu.service.js';
import { PluginDatabaseService } from './services/plugin-database.service.js';
import { BlockchainObserverService } from './services/blockchain-observer/index.js';

async function bootstrap() {
    try {
        await connectDatabase();
        const redis = createRedisClient();
        await redis.connect();

        // Initialize blockchain observer service explicitly before plugins load
        logger.info({}, 'Initializing blockchain observer service...');
        const observerLogger = logger.child({ module: 'blockchain-observer' });
        BlockchainObserverService.initialize(observerLogger);
        logger.info({}, 'Blockchain observer service initialized');

        // Create Express app and HTTP server first
        logger.info({}, 'Creating Express app...');
        const app = createExpressApp();
        logger.info({}, 'Creating HTTP server...');
        const server = http.createServer(app);
        logger.info({}, 'ExpressApp initialized');

        // Initialize WebSocket BEFORE loading plugins so they can use it
        if (env.ENABLE_WEBSOCKETS) {
            WebSocketService.getInstance().initialize(server);
        }
        logger.info({}, 'WebSocketService initialized');

        // Initialize MenuService with database dependency injection
        // Use 'core' as the namespace to distinguish from plugin collections
        try {
            const menuDatabase = new PluginDatabaseService('core');
            MenuService.setDatabase(menuDatabase);
            await MenuService.getInstance().initialize();
        } catch (menuError) {
            logger.error({ menuError, stack: menuError instanceof Error ? menuError.stack : undefined }, 'MenuService initialization failed');
            throw menuError;
        }
        logger.info({}, 'MenuService initialized');

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
