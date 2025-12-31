/**
 * @fileoverview HTTP controller for scheduler admin API endpoints.
 *
 * Provides endpoints for viewing scheduler status, job health metrics,
 * and updating job configurations at runtime.
 *
 * @module modules/scheduler/api/scheduler.controller
 */

import type { Request, Response } from 'express';
import type { IDatabaseService, ISystemLogService } from '@tronrelic/types';
import { env } from '../../../config/env.js';
import { SchedulerService } from '../services/scheduler.service.js';
import {
    SchedulerExecutionModel,
    type SchedulerExecutionDoc,
    type ISchedulerExecutionFields
} from '../database/scheduler-execution.model.js';

/**
 * Job status returned by the scheduler status endpoint.
 */
export interface SchedulerJobStatus {
    name: string;
    schedule: string;
    enabled: boolean;
    lastRun: string | null;
    nextRun: string | null;
    status: 'running' | 'success' | 'failed' | 'never_run';
    duration: number | null;
    error: string | null;
}

/**
 * Health metrics returned by the scheduler health endpoint.
 */
export interface SchedulerHealth {
    enabled: boolean;
    uptime: number | null;
    totalJobsExecuted: number;
    successRate: number;
    overdueJobs: string[];
}

/**
 * Safely convert a Date to ISO string, handling potential null/undefined.
 *
 * @param date - Date value to convert
 * @returns ISO string or null
 */
function safeToISOString(date: Date | null | undefined): string | null {
    if (!date) {
        return null;
    }
    try {
        return date.toISOString();
    } catch {
        return null;
    }
}

/**
 * Controller for scheduler admin API endpoints.
 *
 * Handles job status queries, health metrics, and configuration updates.
 * All endpoints require admin authentication.
 */
export class SchedulerController {
    private readonly EXECUTION_COLLECTION = 'scheduler_executions';

    /**
     * Create a new scheduler controller.
     *
     * @param database - Database service for execution history queries
     * @param logger - Logger instance for request logging
     */
    constructor(
        private readonly database: IDatabaseService,
        private readonly logger: ISystemLogService
    ) {
        this.database.registerModel(this.EXECUTION_COLLECTION, SchedulerExecutionModel);
    }

    /**
     * Get execution model for querying job history.
     */
    private getExecutionModel() {
        return this.database.getModel<SchedulerExecutionDoc>(this.EXECUTION_COLLECTION);
    }

    /**
     * GET /status - Get status of all scheduled jobs.
     *
     * Returns configuration and last execution info for each registered job.
     */
    getStatus = async (_req: Request, res: Response): Promise<void> => {
        try {
            const scheduler = SchedulerService.getInstance();
            const jobConfigs = scheduler.getAllJobConfigs();
            const jobs: SchedulerJobStatus[] = [];

            for (const config of jobConfigs) {
                const lastExecution = await this.getExecutionModel()
                    .findOne({ jobName: config.name })
                    .sort({ startedAt: -1 })
                    .lean() as ISchedulerExecutionFields | null;

                let status: 'running' | 'success' | 'failed' | 'never_run' = 'never_run';
                let lastRun: string | null = null;
                let duration: number | null = null;
                let error: string | null = null;

                if (lastExecution) {
                    status = lastExecution.status;
                    lastRun = safeToISOString(lastExecution.startedAt);
                    duration = lastExecution.duration ? lastExecution.duration / 1000 : null;
                    error = lastExecution.error;
                }

                jobs.push({
                    name: config.name,
                    schedule: config.schedule,
                    enabled: config.enabled,
                    lastRun,
                    nextRun: null,
                    status: config.enabled ? status : 'never_run',
                    duration,
                    error
                });
            }

            res.json({ success: true, jobs });
        } catch (error) {
            this.logger.error({ error }, 'Failed to get scheduler status');
            res.status(500).json({
                success: false,
                error: 'Failed to get scheduler status'
            });
        }
    };

    /**
     * GET /health - Get scheduler health metrics.
     *
     * Returns overall scheduler health including uptime and success rate.
     */
    getHealth = async (_req: Request, res: Response): Promise<void> => {
        try {
            const executionModel = this.getExecutionModel();
            const totalJobsExecuted = await executionModel.countDocuments();
            const successfulJobs = await executionModel.countDocuments({ status: 'success' });
            const successRate = totalJobsExecuted > 0
                ? Math.round((successfulJobs / totalJobsExecuted) * 100)
                : 100;

            const health: SchedulerHealth = {
                enabled: env.ENABLE_SCHEDULER,
                uptime: process.uptime(),
                totalJobsExecuted,
                successRate,
                overdueJobs: []
            };

            res.json({ success: true, health });
        } catch (error) {
            this.logger.error({ error }, 'Failed to get scheduler health');
            res.status(500).json({
                success: false,
                error: 'Failed to get scheduler health'
            });
        }
    };

    /**
     * PATCH /job/:jobName - Update job configuration.
     *
     * Allows updating schedule and enabled state at runtime.
     *
     * @param req.params.jobName - Job identifier to update
     * @param req.body.schedule - New cron expression (optional)
     * @param req.body.enabled - New enabled state (optional)
     */
    updateJob = async (req: Request, res: Response): Promise<void> => {
        try {
            const { jobName } = req.params;
            const { schedule, enabled } = req.body;

            let scheduler: SchedulerService;
            try {
                scheduler = SchedulerService.getInstance();
            } catch {
                res.status(503).json({
                    success: false,
                    error: 'Scheduler is not enabled or not initialized'
                });
                return;
            }

            if (schedule !== undefined && typeof schedule !== 'string') {
                res.status(400).json({
                    success: false,
                    error: 'Schedule must be a valid cron expression string'
                });
                return;
            }

            if (enabled !== undefined && typeof enabled !== 'boolean') {
                res.status(400).json({
                    success: false,
                    error: 'Enabled must be a boolean'
                });
                return;
            }

            await scheduler.updateJobConfig(jobName, { schedule, enabled });

            this.logger.info({ jobName, schedule, enabled }, 'Scheduler job updated');

            res.json({
                success: true,
                message: `Scheduler job ${jobName} updated successfully`,
                job: scheduler.getJobConfig(jobName)
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            this.logger.error({ error, jobName: req.params.jobName }, 'Failed to update scheduler job');
            res.status(400).json({
                success: false,
                error: message
            });
        }
    };
}
