import mongoose, { Schema, Document } from 'mongoose';

/**
 * SchedulerExecutionDoc
 *
 * MongoDB document for tracking scheduler job execution history.
 * Provides observability into job timing, success/failure status, and error details.
 *
 * **Schema Fields:**
 * - `jobName` - Job identifier matching SchedulerConfigModel
 * - `startedAt` - When job execution began
 * - `completedAt` - When job finished (null if still running)
 * - `duration` - Execution time in milliseconds (null if still running)
 * - `status` - Execution outcome: "running" | "success" | "failed"
 * - `error` - Error message if status is "failed"
 *
 * **Usage:**
 * The SchedulerService creates an execution record when a job starts,
 * then updates it with completion status. SystemMonitorService queries
 * this collection to show real execution history instead of hardcoded stubs.
 *
 * **Retention:**
 * Consider adding a TTL index to automatically expire old execution records
 * after 30 days to prevent unbounded collection growth.
 *
 * @example
 * ```typescript
 * const execution = await SchedulerExecutionModel.create({
 *   jobName: 'markets:refresh',
 *   startedAt: new Date(),
 *   status: 'running'
 * });
 * // ... job executes ...
 * await execution.updateOne({
 *   completedAt: new Date(),
 *   duration: Date.now() - execution.startedAt.getTime(),
 *   status: 'success'
 * });
 * ```
 */
export interface ISchedulerExecution {
    jobName: string;
    startedAt: Date;
    completedAt: Date | null;
    duration: number | null;
    status: 'running' | 'success' | 'failed';
    error: string | null;
}

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
