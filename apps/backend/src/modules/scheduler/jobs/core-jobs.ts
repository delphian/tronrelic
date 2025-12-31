/**
 * @fileoverview Core scheduler job registrations.
 *
 * Registers the built-in scheduler jobs for blockchain sync, parameter updates,
 * and cleanup tasks. Called during SchedulerModule.run() after the scheduler
 * service is initialized.
 *
 * @module modules/scheduler/jobs/core-jobs
 */

import type { IDatabaseService } from '@tronrelic/types';
import axios from 'axios';
import { logger } from '../../../lib/logger.js';
import { BlockchainService } from '../../blockchain/blockchain.service.js';
import { ChainParametersFetcher } from '../../chain-parameters/chain-parameters-fetcher.js';
import { UsdtParametersFetcher } from '../../usdt-parameters/usdt-parameters-fetcher.js';
import { SystemLogService } from '../../logs/index.js';
import { SystemConfigService } from '../../../services/system-config/index.js';
import { CacheModel, type CacheDoc } from '../../../database/models/cache-model.js';
import { SchedulerService } from '../services/scheduler.service.js';

/**
 * Register all core scheduler jobs.
 *
 * This function registers the 6 built-in jobs:
 * - chain-parameters:fetch - Fetch TRON chain parameters every 10 minutes
 * - usdt-parameters:fetch - Fetch USDT transfer energy cost every 10 minutes
 * - blockchain:sync - Sync latest blocks every minute
 * - blockchain:prune - Remove old transactions every hour
 * - cache:cleanup - Clean expired cache entries every hour
 * - system-logs:cleanup - Clean old system logs every hour
 *
 * @param scheduler - The scheduler service instance
 * @param database - Database service for job operations
 */
export async function registerCoreJobs(
    scheduler: SchedulerService,
    database: IDatabaseService
): Promise<void> {
    // Register CacheModel for cache cleanup job
    database.registerModel('caches', CacheModel);

    // Inject database into BlockchainService before first getInstance() call
    BlockchainService.setDependencies(database);

    const blockchainService = BlockchainService.getInstance();
    const chainParametersFetcher = new ChainParametersFetcher(axios, logger, database);
    const usdtParametersFetcher = new UsdtParametersFetcher(axios, logger, database);

    // Chain parameters: every 10 minutes
    scheduler.register('chain-parameters:fetch', '*/10 * * * *', async () => {
        await chainParametersFetcher.fetch();
    });

    // USDT parameters: every 10 minutes
    scheduler.register('usdt-parameters:fetch', '*/10 * * * *', async () => {
        await usdtParametersFetcher.fetch();
    });

    // Blockchain sync: every minute
    scheduler.register('blockchain:sync', '*/1 * * * *', async () => {
        await blockchainService.syncLatestBlocks();
    });

    // Blockchain pruning: every hour (removes 2 hours of oldest transactions older than 7 days)
    scheduler.register('blockchain:prune', '0 * * * *', async () => {
        await blockchainService.pruneOldTransactions(24 * 7, 2);
    });

    // Cache cleanup: every hour
    scheduler.register('cache:cleanup', '0 * * * *', async () => {
        await database.deleteMany<CacheDoc>('caches', { expiresAt: { $lte: new Date() } });
    });

    // System logs cleanup: every hour
    scheduler.register('system-logs:cleanup', '0 * * * *', async () => {
        const systemLogService = SystemLogService.getInstance();
        const systemConfigService = SystemConfigService.getInstance();
        const config = await systemConfigService.getConfig();

        // Delete logs older than retention days
        const retentionDate = new Date();
        retentionDate.setDate(retentionDate.getDate() - config.systemLogsRetentionDays);
        const deletedByAge = await systemLogService.deleteOldLogs(retentionDate);

        // Delete excess logs beyond maxCount
        const deletedByCount = await systemLogService.deleteExcessLogs(config.systemLogsMaxCount);

        const totalDeleted = deletedByAge + deletedByCount;
        if (totalDeleted > 0) {
            logger.info({
                deletedByAge,
                deletedByCount,
                totalDeleted,
                retentionDays: config.systemLogsRetentionDays,
                maxCount: config.systemLogsMaxCount
            }, 'System logs cleanup completed');
        }
    });

    logger.info('Core scheduler jobs registered');
}
