import { env } from '../config/env.js';
import { SchedulerService } from '../services/scheduler.service.js';
import { getRedisClient } from '../loaders/redis.js';
import { MarketService } from '../modules/markets/market.service.js';
import { BlockchainService } from '../modules/blockchain/blockchain.service.js';
import { logger } from '../lib/logger.js';
import { CacheModel } from '../database/models/cache-model.js';
import { ChainParametersFetcher } from '../modules/chain-parameters/chain-parameters-fetcher.js';
import { UsdtParametersFetcher } from '../modules/usdt-parameters/usdt-parameters-fetcher.js';
import axios from 'axios';

let scheduler: SchedulerService | null = null;

/**
 * Returns the initialized scheduler instance.
 *
 * Used by admin API to update scheduler configuration at runtime.
 * Returns null if scheduler is disabled or not yet initialized.
 *
 * @returns {SchedulerService | null} Scheduler instance or null
 */
export function getScheduler(): SchedulerService | null {
    return scheduler;
}

/**
 * Initializes and starts all scheduled jobs.
 *
 * Registers all cron jobs (markets, blockchain, alerts, etc.) and starts
 * the scheduler. The scheduler loads configuration from MongoDB and schedules
 * enabled jobs according to their configured intervals.
 *
 * @returns {Promise<SchedulerService | null>} Scheduler instance or null if disabled
 */
export async function initializeJobs(): Promise<SchedulerService | null> {
    if (!env.ENABLE_SCHEDULER) {
        logger.warn('Scheduler disabled by configuration');
        return null;
    }

    const redis = getRedisClient();
    const marketService = new MarketService(redis);
    const blockchainService = BlockchainService.getInstance();
    const chainParametersFetcher = new ChainParametersFetcher(axios, logger);
    const usdtParametersFetcher = new UsdtParametersFetcher(axios, logger);

    scheduler = new SchedulerService();

    // Chain parameters: every 10 minutes
    scheduler.register('chain-parameters:fetch', '*/10 * * * *', async () => {
        await chainParametersFetcher.fetch();
    });

    // USDT parameters: every 10 minutes
    scheduler.register('usdt-parameters:fetch', '*/10 * * * *', async () => {
        await usdtParametersFetcher.fetch();
    });

    // Markets: every 10 minutes (configurable via admin API)
    scheduler.register('markets:refresh', '*/10 * * * *', async () => {
        await marketService.refreshMarkets();
    });

    // Blockchain: every minute
    scheduler.register('blockchain:sync', '*/1 * * * *', async () => {
        await blockchainService.syncLatestBlocks();
    });

    // Blockchain pruning: every hour (removes 2 hours of oldest transactions older than 7 days)
    scheduler.register('blockchain:prune', '0 * * * *', async () => {
        await blockchainService.pruneOldTransactions(24 * 7, 2);
    });

  scheduler.register('cache:cleanup', '0 * * * *', async () => {
    await CacheModel.deleteMany({ expiresAt: { $lte: new Date() } });
  });

  await scheduler.start();
  logger.info('Scheduler started with configuration from MongoDB');
  return scheduler;
}

export function stopJobs() {
  scheduler?.stop();
}
