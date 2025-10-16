import mongoose, { Schema, Document } from 'mongoose';

/**
 * SchedulerConfigDoc
 *
 * MongoDB document for storing scheduler job configuration.
 * Allows runtime modification of job schedules and enable/disable state
 * without requiring backend restart.
 *
 * **Schema Fields:**
 * - `jobName` - Unique identifier for the scheduled job (e.g., "markets:refresh")
 * - `enabled` - Whether this job should execute on schedule
 * - `schedule` - Cron expression defining execution frequency (e.g., "STAR/10 * * * *" where STAR = asterisk)
 * - `updatedAt` - Timestamp of last configuration change
 * - `updatedBy` - Admin identifier who made the change (future use)
 *
 * **Usage:**
 * The SchedulerService queries this collection on initialization and when
 * configuration updates are received via admin API. Dynamic rescheduling
 * allows administrators to tune job frequency without deployment.
 *
 * @example
 * ```typescript
 * const config = await SchedulerConfigModel.findOne({ jobName: 'markets:refresh' });
 * if (config && config.enabled) {
 *   scheduler.reschedule('markets:refresh', config.schedule);
 * }
 * ```
 */
export interface ISchedulerConfig {
    jobName: string;
    enabled: boolean;
    schedule: string;
    updatedAt: Date;
    updatedBy?: string;
}

export type SchedulerConfigDoc = Document & ISchedulerConfig;

const schedulerConfigSchema = new Schema<SchedulerConfigDoc>(
    {
        jobName: {
            type: String,
            required: true,
            unique: true,
            index: true
        },
        enabled: {
            type: Boolean,
            required: true,
            default: true
        },
        schedule: {
            type: String,
            required: true
        },
        updatedAt: {
            type: Date,
            default: Date.now
        },
        updatedBy: {
            type: String,
            required: false
        }
    },
    {
        collection: 'scheduler_configs',
        timestamps: false
    }
);

export const SchedulerConfigModel = mongoose.model<SchedulerConfigDoc>(
    'SchedulerConfig',
    schedulerConfigSchema
);
