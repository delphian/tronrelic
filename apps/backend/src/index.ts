import http from 'node:http';
import { env } from './config/env.js';
import { createExpressApp } from './loaders/express.js';
import { connectDatabase } from './loaders/database.js';
import { createRedisClient, disconnectRedis } from './loaders/redis.js';
import { logger } from './lib/logger.js';
import { WebSocketService } from './services/websocket.service.js';
import { initializeJobs, stopJobs } from './jobs/index.js';
import { loadPlugins } from './loaders/plugins.js';
// Import observers to trigger auto-registration via side effects
import './modules/blockchain/observers/index.js';

async function bootstrap() {
  try {
    await connectDatabase();
    const redis = createRedisClient();
    await redis.connect();

    // Create Express app and HTTP server first
    const app = createExpressApp();
    const server = http.createServer(app);

    // Initialize WebSocket BEFORE loading plugins so they can use it
    if (env.ENABLE_WEBSOCKETS) {
      WebSocketService.getInstance().initialize(server);
    }

    // Load plugins AFTER WebSocket is initialized so they can register handlers
    await loadPlugins();

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
