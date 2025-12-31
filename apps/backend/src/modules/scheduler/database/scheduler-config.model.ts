/**
 * @fileoverview MongoDB model for scheduler job configuration.
 *
 * Enables runtime modification of job schedules and enable/disable state
 * without requiring backend restart.
 *
 * @module modules/scheduler/database/scheduler-config.model
 */

import mongoose, { Schema, Document } from 'mongoose';

/**
 * Scheduler job configuration interface.
 *
 * @property jobName - Unique identifier for the scheduled job (e.g., "markets:refresh")
 * @property enabled - Whether this job should execute on schedule
 * @property schedule - Cron expression defining execution frequency
 * @property updatedAt - Timestamp of last configuration change
 * @property updatedBy - Admin identifier who made the change (optional)
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
