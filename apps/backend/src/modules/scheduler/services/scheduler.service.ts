/**
 * @fileoverview Scheduler service for cron job management with MongoDB persistence.
 *
 * Provides centralized scheduling with dynamic reconfiguration, execution tracking,
 * and overlap protection. Implements singleton pattern for consistent job management
 * across the application.
 *
 * @module modules/scheduler/services/scheduler.service
 */

import cron, { ScheduledTask } from 'node-cron';
import type { IDatabaseService } from '@tronrelic/types';
import { logger } from '../../../lib/logger.js';
import { SchedulerConfigModel, type SchedulerConfigDoc } from '../database/scheduler-config.model.js';
import { SchedulerExecutionModel, type SchedulerExecutionDoc } from '../database/scheduler-execution.model.js';

export type CronJobHandler = () => Promise<void> | void;

/**
 * Internal representation of a scheduled job with its handler and active cron task.
 *
 * @property name - Unique job identifier (e.g., "markets:refresh")
 * @property defaultSchedule - Default cron expression from code registration
 * @property currentSchedule - Active cron expression (may differ if admin changed it)
 * @property enabled - Whether job is currently active
 * @property handler - Async function to execute on schedule
 * @property task - Active node-cron ScheduledTask (undefined if disabled)
 */
interface RegisteredJob {
    name: string;
    defaultSchedule: string;
    currentSchedule: string;
    enabled: boolean;
    handler: CronJobHandler;
    task?: ScheduledTask;
}

/**
 * Centralized cron scheduler with dynamic reconfiguration support.
 *
 * Jobs can be registered during application startup, then runtime configuration
 * (schedule interval, enabled/disabled state) is loaded from MongoDB and can be
 * updated via admin API without backend restart.
 *
 * Uses singleton pattern to ensure consistent job management across the application.
 * Call setDependencies() before getInstance() during module initialization.
 *
 * @example
 * // In SchedulerModule.init()
 * SchedulerService.setDependencies(database);
 *
 * // In SchedulerModule.run()
 * const scheduler = SchedulerService.getInstance();
 * scheduler.register('my-job', '0 * * * *', async () => { ... });
 * await scheduler.start();
 */
export class SchedulerService {
    private static instance: SchedulerService | null = null;
    private static database: IDatabaseService | null = null;

    private readonly jobs = new Map<string, RegisteredJob>();
    private readonly runningJobs = new Set<string>();
    private started = false;
    private readonly CONFIG_COLLECTION = 'scheduler_configs';
    private readonly EXECUTION_COLLECTION = 'scheduler_executions';

    /**
     * Inject dependencies before creating the singleton instance.
     *
     * Must be called once during module initialization before any getInstance() calls.
     *
     * @param database - Database service for MongoDB operations
     */
    public static setDependencies(database: IDatabaseService): void {
        SchedulerService.database = database;
    }

    /**
     * Get the singleton scheduler instance.
     *
     * @returns The scheduler service instance
     * @throws Error if setDependencies() was not called first
     */
    public static getInstance(): SchedulerService {
        if (!SchedulerService.instance) {
            if (!SchedulerService.database) {
                throw new Error('SchedulerService.setDependencies() must be called before getInstance()');
            }
            SchedulerService.instance = new SchedulerService(SchedulerService.database);
        }
        return SchedulerService.instance;
    }

    /**
     * Reset the singleton instance.
     *
     * Used for testing to ensure clean state between test runs.
     */
    public static resetInstance(): void {
        if (SchedulerService.instance) {
            SchedulerService.instance.stop();
        }
        SchedulerService.instance = null;
        SchedulerService.database = null;
    }

    /**
     * Create a new scheduler service.
     *
     * Private constructor - use getInstance() instead.
     *
     * @param database - Database service for MongoDB operations
     */
    private constructor(private readonly database: IDatabaseService) {
        this.database.registerModel(this.CONFIG_COLLECTION, SchedulerConfigModel);
        this.database.registerModel(this.EXECUTION_COLLECTION, SchedulerExecutionModel);
    }

    /**
     * Register a new scheduled job with default configuration.
     *
     * If the scheduler has already started, the job will be scheduled immediately.
     * Otherwise, it will be scheduled when start() is called.
     *
     * @param name - Unique job identifier (e.g., "markets:refresh")
     * @param defaultSchedule - Default cron expression (e.g., "0 0 * * *" for daily)
     * @param handler - Async function to execute on schedule
     * @throws Error if job name is already registered
     */
    register(name: string, defaultSchedule: string, handler: CronJobHandler): void {
        if (this.jobs.has(name)) {
            throw new Error(`Job ${name} already registered`);
        }
        this.jobs.set(name, {
            name,
            defaultSchedule,
            currentSchedule: defaultSchedule,
            enabled: true,
            handler,
            task: undefined
        });

        if (this.started) {
            void this.scheduleJobFromDatabase(name);
        }
    }

    /**
     * Disable a scheduled job without removing it.
     *
     * Sets enabled=false and stops the cron task. Job can be re-enabled via
     * admin UI or by calling updateJobConfig with enabled=true.
     *
     * @param name - Job identifier to disable
     * @throws Error if job name is not registered
     */
    async disable(name: string): Promise<void> {
        await this.updateJobConfig(name, { enabled: false });
    }

    /**
     * Completely unregister a job from memory and optionally MongoDB.
     *
     * Use this during plugin uninstall lifecycle hook to clean up registered jobs.
     * The job will be stopped immediately and removed from the scheduler.
     *
     * @param name - Job identifier to unregister
     * @param deleteFromDatabase - If true, also delete the MongoDB config record
     * @throws Error if job name is not registered
     */
    async unregister(name: string, deleteFromDatabase: boolean = false): Promise<void> {
        const job = this.jobs.get(name);
        if (!job) {
            throw new Error(`Job ${name} not registered`);
        }

        if (job.task) {
            job.task.stop();
        }

        this.jobs.delete(name);

        if (deleteFromDatabase) {
            const configModel = this.database.getModel<SchedulerConfigDoc>(this.CONFIG_COLLECTION);
            await configModel.deleteOne({ jobName: name });
        }

        logger.info({ jobName: name, deletedFromDb: deleteFromDatabase }, 'Job unregistered from scheduler');
    }

    /**
     * Start all registered jobs by loading configuration from MongoDB.
     *
     * For each registered job:
     * 1. Check if configuration exists in MongoDB
     * 2. If not, create default config with defaultSchedule and enabled=true
     * 3. If config exists, use stored schedule and enabled state
     * 4. Schedule enabled jobs with node-cron
     */
    async start(): Promise<void> {
        for (const [name] of this.jobs.entries()) {
            await this.scheduleJobFromDatabase(name);
        }
        this.started = true;
    }

    /**
     * Load configuration for a single job from MongoDB and schedule if enabled.
     *
     * @param name - Job name to schedule
     */
    private async scheduleJobFromDatabase(name: string): Promise<void> {
        const job = this.jobs.get(name);
        if (!job) {
            logger.error({ jobName: name }, 'Attempted to schedule unknown job');
            return;
        }

        const configModel = this.database.getModel<SchedulerConfigDoc>(this.CONFIG_COLLECTION);
        let config = await configModel.findOne({ jobName: name });

        if (!config) {
            config = await configModel.create({
                jobName: name,
                enabled: true,
                schedule: job.defaultSchedule,
                updatedAt: new Date()
            });
            logger.info(
                { jobName: name, schedule: job.defaultSchedule },
                'Created default scheduler config'
            );
        }

        job.currentSchedule = config.schedule;
        job.enabled = config.enabled;

        if (job.enabled) {
            this.scheduleJob(job);
            logger.info(
                { jobName: name, schedule: job.currentSchedule },
                `Scheduler job started: ${name}`
            );
        } else {
            logger.info({ jobName: name }, 'Scheduler job disabled (skipped)');
        }
    }

    /**
     * Schedule a single job with node-cron.
     *
     * Wraps the handler with execution tracking and overlap protection.
     *
     * @param job - Job to schedule
     */
    private scheduleJob(job: RegisteredJob): void {
        const task = cron.schedule(job.currentSchedule, async () => {
            if (this.runningJobs.has(job.name)) {
                logger.warn(
                    { jobName: job.name },
                    `Scheduled Job Skipped: ${job.name} - previous execution still running`
                );
                return;
            }

            this.runningJobs.add(job.name);

            const executionModel = this.database.getModel<SchedulerExecutionDoc>(this.EXECUTION_COLLECTION);
            const execution = await executionModel.create({
                jobName: job.name,
                startedAt: new Date(),
                status: 'running',
                completedAt: null,
                duration: null,
                error: null
            });

            const started = Date.now();
            logger.debug({ job: job.name }, `Scheduled Job Start: ${job.name}`);

            try {
                await job.handler();
                const duration = Date.now() - started;

                await execution.updateOne({
                    completedAt: new Date(),
                    duration,
                    status: 'success'
                });

                logger.info(
                    {
                        job: job.name,
                        durationMs: duration,
                        status: 'success'
                    },
                    `Scheduled Job Complete: ${job.name}`
                );
            } catch (error) {
                const duration = Date.now() - started;
                const errorMessage = error instanceof Error ? error.message : String(error);

                await execution.updateOne({
                    completedAt: new Date(),
                    duration,
                    status: 'failed',
                    error: errorMessage
                });

                logger.error(
                    {
                        job: job.name,
                        durationMs: duration,
                        status: 'failed',
                        error: errorMessage
                    },
                    `Scheduled Job Failed: ${job.name}`
                );
            } finally {
                this.runningJobs.delete(job.name);
            }
        });

        job.task = task;
    }

    /**
     * Update job configuration and dynamically reschedule without restart.
     *
     * Changes are persisted to MongoDB and take effect immediately.
     *
     * @param jobName - Job identifier to update
     * @param updates - Configuration changes
     * @throws Error if job name is not registered
     */
    async updateJobConfig(
        jobName: string,
        updates: { schedule?: string; enabled?: boolean; updatedBy?: string }
    ): Promise<void> {
        const job = this.jobs.get(jobName);
        if (!job) {
            throw new Error(`Job ${jobName} not registered`);
        }

        const updateDoc: Record<string, unknown> = { updatedAt: new Date() };
        if (updates.schedule !== undefined) {
            updateDoc.schedule = updates.schedule;
        }
        if (updates.enabled !== undefined) {
            updateDoc.enabled = updates.enabled;
        }
        if (updates.updatedBy !== undefined) {
            updateDoc.updatedBy = updates.updatedBy;
        }

        const configModel = this.database.getModel<SchedulerConfigDoc>(this.CONFIG_COLLECTION);
        await configModel.updateOne({ jobName }, updateDoc, { upsert: true });

        const scheduleChanged = updates.schedule !== undefined && updates.schedule !== job.currentSchedule;
        const enabledChanged = updates.enabled !== undefined && updates.enabled !== job.enabled;

        if (updates.schedule !== undefined) {
            job.currentSchedule = updates.schedule;
        }
        if (updates.enabled !== undefined) {
            job.enabled = updates.enabled;
        }

        if (scheduleChanged || enabledChanged) {
            if (job.task) {
                job.task.stop();
                job.task = undefined;
                logger.info({ jobName }, 'Stopped existing scheduler task');
            }

            if (job.enabled) {
                this.scheduleJob(job);
                if (enabledChanged) {
                    logger.warn({ jobName, schedule: job.currentSchedule }, `Scheduler job enabled: ${jobName}`);
                } else {
                    logger.info(
                        { jobName, schedule: job.currentSchedule },
                        'Rescheduled job with new configuration'
                    );
                }
            } else {
                if (enabledChanged) {
                    logger.warn({ jobName }, `Scheduler job disabled: ${jobName}`);
                } else {
                    logger.info({ jobName }, 'Job disabled, not scheduling');
                }
            }
        }
    }

    /**
     * Get configuration for a specific job.
     *
     * @param jobName - Job identifier
     * @returns Job config or null if not found
     */
    getJobConfig(jobName: string): {
        name: string;
        schedule: string;
        enabled: boolean;
        defaultSchedule: string;
    } | null {
        const job = this.jobs.get(jobName);
        if (!job) {
            return null;
        }
        return {
            name: job.name,
            schedule: job.currentSchedule,
            enabled: job.enabled,
            defaultSchedule: job.defaultSchedule
        };
    }

    /**
     * Get configuration for all registered jobs.
     *
     * @returns Array of job configurations
     */
    getAllJobConfigs(): Array<{
        name: string;
        schedule: string;
        enabled: boolean;
        defaultSchedule: string;
    }> {
        return Array.from(this.jobs.values()).map(job => ({
            name: job.name,
            schedule: job.currentSchedule,
            enabled: job.enabled,
            defaultSchedule: job.defaultSchedule
        }));
    }

    /**
     * Stop all running cron tasks.
     *
     * Called during graceful shutdown.
     */
    stop(): void {
        this.jobs.forEach(job => {
            if (job.task) {
                job.task.stop();
            }
        });
        logger.info('All scheduler jobs stopped');
    }
}
