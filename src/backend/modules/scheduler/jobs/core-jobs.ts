/**
 * @fileoverview Core scheduler job registrations.
 *
 * Registers the built-in scheduler jobs for blockchain sync, parameter updates,
 * and cleanup tasks. Called during SchedulerModule.run() after the scheduler
 * service is initialized.
 *
 * @module modules/scheduler/jobs/core-jobs
 */

import type { IDatabaseService } from '@/types';
import axios from 'axios';
import { logger } from '../../../lib/logger.js';
import { BlockchainService } from '../../blockchain/blockchain.service.js';
import { ChainParametersFetcher } from '../../chain-parameters/chain-parameters-fetcher.js';
import { ChainParametersService } from '../../chain-parameters/chain-parameters.service.js';
import { UsdtParametersFetcher } from '../../usdt-parameters/usdt-parameters-fetcher.js';
import { SystemLogService } from '../../logs/index.js';
import { SystemConfigService } from '../../../services/system-config/index.js';
import { CacheModel, type CacheDoc } from '../../../database/models/cache-model.js';
import {
    CoreNetworkActivityRollupModel,
    CORE_NETWORK_ACTIVITY_ROLLUPS_COLLECTION
} from '../../../database/models/core-network-activity-rollup-model.js';
import { runOverviewRollup } from '../../blockchain/overview-rollup.job.js';
import { logger as blockchainLogger } from '../../blockchain/logger.js';
import { SchedulerService } from '../services/scheduler.service.js';

/**
 * Register all core scheduler jobs.
 *
 * This function registers the 9 built-in jobs:
 * - chain-parameters:fetch - Fetch TRON chain parameters every 10 minutes
 * - usdt-parameters:fetch - Fetch USDT transfer energy cost every 10 minutes
 * - blockchain:sync - Sync latest blocks every 15 seconds
 * - blockchain:prune-transactions - Remove expired transactions in small batches every minute
 * - blockchain:prune - Remove old blocks every hour
 * - blockchain:token-metadata - Resolve active TRC-20 token metadata into ClickHouse every hour
 * - network-activity:rollup - Pre-aggregate the network-activity widget every 5 minutes
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

    // Register the network-activity rollup model. The model is bound to the
    // `core_network_activity_rollups` collection at definition time (third
    // model() arg), where Mongoose autoIndex builds its unique index; this
    // registration just makes the model resolvable by collection name.
    database.registerModel(CORE_NETWORK_ACTIVITY_ROLLUPS_COLLECTION, CoreNetworkActivityRollupModel);

    // Inject database into BlockchainService before first getInstance() call
    BlockchainService.setDependencies(database);

    const blockchainService = BlockchainService.getInstance();
    const chainParametersFetcher = new ChainParametersFetcher(axios, logger, database);
    const usdtParametersFetcher = new UsdtParametersFetcher(axios, logger, database);

    // Chain parameters: every 10 minutes. The fetched snapshot is pushed into
    // the service's in-memory cache as well as the database, because the
    // service's synchronous converters (getEnergyFromTRX, getBandwidthFromTRX,
    // getTRXFromEnergy, getAPY, getEnergyFee) read that cache directly and
    // cannot await a reload. Writing only the document would let a quiet
    // process keep converting against the snapshot it warmed at startup.
    scheduler.register('chain-parameters:fetch', '*/10 * * * *', async () => {
        const parameters = await chainParametersFetcher.fetch();
        ChainParametersService.getInstance().primeCache(parameters);
    });

    // USDT parameters: every 10 minutes
    scheduler.register('usdt-parameters:fetch', '*/10 * * * *', async () => {
        await usdtParametersFetcher.fetch();
    });

    // Blockchain sync: every 15 seconds, using node-cron's optional leading
    // seconds field (the same 6-field form the address-tags jobs use).
    //
    // It ran every minute for as long as the worker paced itself to three
    // seconds per block, which stretched a tick's twenty blocks across the
    // whole minute and made the two match by accident. Pacing now lives in
    // `BlockEmitter` and ingestion runs flat out, so a one-minute tick would
    // deliver its blocks in a ten-second burst and then idle — swinging the
    // emitter's buffer by a full tick's production and emptying it right at the
    // tick boundary, which is exactly when a late tick would leave the feed
    // exposed. Four ticks a minute keeps that buffer close to level.
    //
    // `blockchainConfig.lock.ttlSeconds` is sized against this period and has
    // to move with it. Changing the schedule from `/system/scheduler` without
    // changing that TTL lets two runs overlap and race the cursor.
    //
    // The schedule a deployment actually runs is the one stored in
    // `scheduler_configs`, written when the job was first registered and read
    // back on every boot. Deployments created before this change keep the
    // one-minute schedule until an operator edits it at `/system/scheduler`.
    // The blockchain jobs pass the blockchain module's logger so the scheduler's
    // own entries for them land under `tronrelic:blockchain`, which is what the
    // Logs tab on /system/system filters by.
    scheduler.register('blockchain:sync', '*/15 * * * * *', async () => {
        await blockchainService.syncLatestBlocks();
    }, { logger: blockchainLogger });

    // Transaction pruning: every minute, in small batches, removing rows older
    // than 4 days — coupled to TARGET_HOURLY_BUCKETS (96) in
    // overview-rollup.job.ts, which must never backfill past this cutoff.
    // It is a job of its own rather than a new schedule on `blockchain:prune`,
    // because a deployment runs the schedule stored in `scheduler_configs` for
    // an existing job name, so changing that job's default here would not
    // reach production. Deleting an hour of transactions in one statement held
    // block commits far below the chain's rate for up to 16 minutes an hour.
    scheduler.register('blockchain:prune-transactions', '* * * * *', async () => {
        await blockchainService.pruneOldTransactions(24 * 4);
    }, { logger: blockchainLogger });

    // Block pruning: every hour, removing 24 hours of the oldest rows older than
    // the configured block retention (32 days by default) — block docs are tiny,
    // so the larger batch drains the initial backlog in weeks, not months.
    scheduler.register('blockchain:prune', '0 * * * *', async () => {
        await blockchainService.pruneOldBlocks();
    }, { logger: blockchainLogger });

    // TRC-20 token metadata: hourly at :17, away from the top of the hour
    // where the prune and cleanup jobs run. Reads the ClickHouse transfer
    // ledger for tokens active in the last day and resolves their decimals,
    // symbol, and name into `tron._token`, capped per run because each token
    // costs three calls on the TronGrid queue block sync shares. Does nothing
    // without ClickHouse.
    scheduler.register('blockchain:token-metadata', '17 * * * *', async () => {
        await blockchainService.refreshTokenMetadata();
    }, { logger: blockchainLogger });

    // Network-activity rollup: every 5 minutes. Pre-aggregates the
    // transactions/transfers/volume buckets backing the core:network-activity
    // widget so the request path is a cheap read instead of a live week-long
    // aggregation. Each run recomputes only a bounded recent window and backfills
    // one chunk of history, so it never scans the full window in a single pass.
    scheduler.register('network-activity:rollup', '*/5 * * * *', async () => {
        await runOverviewRollup(database);
    }, { logger: blockchainLogger });

    // Kick one rollup now (fire-and-forget) so the widget has data without
    // waiting for the first cron tick. The scheduled run lets failures throw so
    // the scheduler records them; this boot kick has no scheduler wrapper, so it
    // guards itself with .catch() to avoid an unhandledRejection.
    void runOverviewRollup(database).catch((error) => {
        logger.warn({ error }, 'Initial network-activity rollup failed');
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
