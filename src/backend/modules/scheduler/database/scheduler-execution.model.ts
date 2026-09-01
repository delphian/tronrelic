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
        // Deliberately carries no `index: true`. The TTL index declared at the
        // bottom of this file uses the same `{ startedAt: 1 }` key, and MongoDB
        // will not hold two indexes on one key pattern. With both declared,
        // Mongoose built the plain index first, warned `Duplicate schema index
        // on {"startedAt":1}`, and the TTL options were never applied — so the
        // 30-day retention this file documents never actually ran. Adding
        // `index: true` back here silently disables retention again.
        startedAt: {
            type: Date,
            required: true
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

// TTL index to auto-delete execution records older than 30 days. This is also
// the only index on `startedAt`, and it has to stay that way — see the note on
// the field above. A deployment that booted the old schema already holds a
// plain `startedAt_1` index that this declaration cannot replace in place, so
// migration `001_repair_scheduler_execution_ttl` drops it and rebuilds it with
// the expiry attached.
schedulerExecutionSchema.index({ startedAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

export const SchedulerExecutionModel = mongoose.model<SchedulerExecutionDoc>(
    'SchedulerExecution',
    schedulerExecutionSchema
);
