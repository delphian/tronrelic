/**
 * @fileoverview MongoDB model for scheduler job execution history.
 *
 * Provides observability into job timing, success/failure status, and error details.
 * Records are automatically deleted after 30 days via TTL index.
 *
 * @module modules/scheduler/database/scheduler-execution.model
 */

import mongoose, { Schema, Document } from 'mongoose';

/**
 * Scheduler job execution record interface.
 *
 * @property jobName - Job identifier matching SchedulerConfigModel
 * @property startedAt - When job execution began
 * @property completedAt - When job finished (null if still running)
 * @property duration - Execution time in milliseconds (null if still running)
 * @property status - Execution outcome: "running" | "success" | "failed"
 * @property error - Error message if status is "failed"
 */
export interface ISchedulerExecution {
    jobName: string;
    startedAt: Date;
    completedAt: Date | null;
    duration: number | null;
    status: 'running' | 'success' | 'failed';
    error: string | null;
}

/**
 * Plain field interface for SchedulerExecution documents.
 * Use this when working with `.lean()` queries to avoid type mismatches.
 */
export type ISchedulerExecutionFields = ISchedulerExecution;

export type SchedulerExecutionDoc = Document & ISchedulerExecution;

const schedulerExecutionSchema = new Schema<SchedulerExecutionDoc>(
    {
        jobName: {
            type: String,
            required: true,
            index: true
        },
        startedAt: {
            type: Date,
            required: true,
            index: true
        },
        completedAt: {
            type: Date,
            default: null
        },
        duration: {
            type: Number,
            default: null
        },
        status: {
            type: String,
            enum: ['running', 'success', 'failed'],
            required: true,
            default: 'running'
        },
        error: {
            type: String,
            default: null
        }
    },
    {
        collection: 'scheduler_executions',
        timestamps: false
    }
);

// TTL index to auto-delete execution records older than 30 days
schedulerExecutionSchema.index({ startedAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

export const SchedulerExecutionModel = mongoose.model<SchedulerExecutionDoc>(
    'SchedulerExecution',
    schedulerExecutionSchema
);
