import { env } from '../config/env.js';
import { SchedulerService } from '../services/scheduler.service.js';
import { getRedisClient } from '../loaders/redis.js';
import { MarketService } from '../modules/markets/market.service.js';
import { BlockchainService } from '../modules/blockchain/blockchain.service.js';
import { logger } from '../lib/logger.js';
import { CacheModel } from '../database/models/cache-model.js';
import { AlertService } from '../services/alert.service.js';
import { QueueService } from '../services/queue.service.js';
import { ChainParametersFetcher } from '../modules/chain-parameters/chain-parameters-fetcher.js';
import { UsdtParametersFetcher } from '../modules/usdt-parameters/usdt-parameters-fetcher.js';
import axios from 'axios';

let scheduler: SchedulerService | null = null;

export function initializeJobs() {
    if (!env.ENABLE_SCHEDULER) {
        logger.warn('Scheduler disabled by configuration');
        return null;
    }

    const redis = getRedisClient();
    const marketService = new MarketService(redis);
    const blockchainService = BlockchainService.getInstance();
    const alertService = new AlertService();
    const chainParametersFetcher = new ChainParametersFetcher(axios, logger);
    const usdtParametersFetcher = new UsdtParametersFetcher(axios, logger);

    const alertDispatchQueue = new QueueService('alerts-dispatch', async () => {
        await alertService.dispatchPendingAlerts();
    });
    const alertParityQueue = new QueueService('alerts-parity', async () => {
        await alertService.verifyParity();
    });

    scheduler = new SchedulerService();

    // Chain parameters: every 10 minutes
    scheduler.register('chain-parameters:fetch', '*/10 * * * *', async () => {
        await chainParametersFetcher.fetch();
    });

    // USDT parameters: every 10 minutes
    scheduler.register('usdt-parameters:fetch', '*/10 * * * *', async () => {
        await usdtParametersFetcher.fetch();
    });

    // Markets: every 5 minutes
    scheduler.register('markets:refresh', '*/5 * * * *', async () => {
        await marketService.refreshMarkets();
    });

    // Blockchain: every minute
    scheduler.register('blockchain:sync', '*/1 * * * *', async () => {
        await blockchainService.syncLatestBlocks();
    });

  scheduler.register('cache:cleanup', '0 * * * *', async () => {
    await CacheModel.deleteMany({ expiresAt: { $lte: new Date() } });
  });

  scheduler.register('alerts:dispatch', '*/1 * * * *', async () => {
    await alertDispatchQueue.enqueue('dispatch', {});
  });

  scheduler.register('alerts:parity', '*/5 * * * *', async () => {
    await alertParityQueue.enqueue('verify', {});
  });

  scheduler.start();
  logger.info('Scheduler started');
  return scheduler;
}

export function stopJobs() {
  scheduler?.stop();
}
