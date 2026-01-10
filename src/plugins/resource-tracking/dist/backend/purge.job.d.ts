import type { IPluginDatabase, ISystemLogService } from '@/types';
/**
 * Purge old delegation transactions and summation data based on retention policies.
 *
 * This job runs hourly (configurable) to remove data older than the configured
 * retention periods. Delegation transaction details are kept for 48 hours by default,
 * while aggregated summation data is retained for 6 months by default.
 *
 * The purge job ensures storage requirements remain manageable while preserving
 * enough historical data for analysis and debugging. Retention periods can be
 * adjusted via the plugin settings without code changes.
 *
 * @param database - Plugin-scoped database service for deleting expired records
 * @param logger - Scoped logger for job execution tracking
 */
export declare function runPurgeJob(database: IPluginDatabase, logger: ISystemLogService): Promise<void>;
//# sourceMappingURL=purge.job.d.ts.map