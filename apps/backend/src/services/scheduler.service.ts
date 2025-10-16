import cron, { ScheduledTask } from 'node-cron';
import { logger } from '../lib/logger.js';
import { SchedulerConfigModel } from '../database/models/scheduler-config-model.js';
import { SchedulerExecutionModel } from '../database/models/scheduler-execution-model.js';

export type CronJobHandler = () => Promise<void> | void;

/**
 * RegisteredJob
 *
 * Internal representation of a scheduled job with its handler and active cron task.
 *
 * **Fields:**
 * - `name` - Unique job identifier (e.g., "markets:refresh")
 * - `defaultSchedule` - Default cron expression from code registration
 * - `currentSchedule` - Active cron expression (may differ from default if admin changed it)
 * - `enabled` - Whether job is currently active (can be toggled via admin API)
 * - `handler` - Async function to execute on schedule
 * - `task` - Active node-cron ScheduledTask (undefined if job is disabled)
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
 * SchedulerService
 *
 * Centralized cron scheduler with dynamic reconfiguration support.
 * Jobs can be registered during application startup, then runtime configuration
 * (schedule interval, enabled/disabled state) is loaded from MongoDB and can be
 * updated via admin API without backend restart.
 *
 * **Key Features:**
 * - Dynamic rescheduling without restart (reschedule method)
 * - Enable/disable jobs at runtime (updateJobConfig method)
 * - Execution tracking in MongoDB for observability
 * - Automatic config persistence on first registration
 *
 * **Usage Flow:**
 * 1. Code registers jobs with default schedules
 * 2. On start(), service loads config from MongoDB (or creates defaults)
 * 3. Admin can update config via API to change schedule or enable/disable
 * 4. Config changes trigger immediate reschedule without restart
 *
 * @example
 * // Note: {S} represents / in cron expressions below
 * const scheduler = new SchedulerService();
 * scheduler.register('markets:refresh', '*{S}10 * * * *', async () => {
 *   await marketService.refreshMarkets();
 * });
 * await scheduler.start();
 * // Later, via admin API:
 * await scheduler.updateJobConfig('markets:refresh', {
 *   schedule: '*{S}5 * * * *',
 *   enabled: true
 * });
 */
export class SchedulerService {
    private readonly jobs = new Map<string, RegisteredJob>();

    /**
     * Registers a new scheduled job with default configuration.
     *
     * Jobs must be registered before calling start(). The default schedule
     * will be used unless admin has configured a different schedule in MongoDB.
     *
     * @param name - Unique job identifier (e.g., "markets:refresh")
     * @param defaultSchedule - Default cron expression. Note: use slash instead of {S} (e.g., "STAR/10 * * * *" where STAR = asterisk)
     * @param handler - Async function to execute on schedule
     * @throws If job name is already registered
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
    }

    /**
     * Starts all registered jobs by loading configuration from MongoDB
     * and scheduling enabled jobs.
     *
     * For each registered job:
     * 1. Check if configuration exists in MongoDB
     * 2. If not, create default config with defaultSchedule and enabled=true
     * 3. If config exists, use stored schedule and enabled state
     * 4. Schedule enabled jobs with node-cron
     *
     * This method must be called after all jobs are registered via register().
     */
    async start(): Promise<void> {
        for (const [name, job] of this.jobs.entries()) {
            // Load or create config from MongoDB
            let config = await SchedulerConfigModel.findOne({ jobName: name });

            if (!config) {
                // First time seeing this job - create default config
                config = await SchedulerConfigModel.create({
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

            // Update job with config from database
            job.currentSchedule = config.schedule;
            job.enabled = config.enabled;

            if (job.enabled) {
                this.scheduleJob(job);
                logger.info(
                    { jobName: name, schedule: job.currentSchedule },
                    'Scheduler job started'
                );
            } else {
                logger.info({ jobName: name }, 'Scheduler job disabled (skipped)');
            }
        }
    }

    /**
     * Schedules a single job with node-cron.
     *
     * Wraps the handler with execution tracking:
     * - Creates execution record with status "running"
     * - Executes handler
     * - Updates record with success/failure status and duration
     *
     * @param {RegisteredJob} job - Job to schedule
     * @private
     */
    private scheduleJob(job: RegisteredJob): void {
        const task = cron.schedule(job.currentSchedule, async () => {
            const execution = await SchedulerExecutionModel.create({
                jobName: job.name,
                startedAt: new Date(),
                status: 'running',
                completedAt: null,
                duration: null,
                error: null
            });

            const started = Date.now();
            logger.info({ job: job.name }, 'Scheduler job started');

            try {
                await job.handler();
                const duration = Date.now() - started;

                await execution.updateOne({
                    completedAt: new Date(),
                    duration,
                    status: 'success'
                });

                logger.info({ job: job.name, durationMs: duration }, 'Scheduler job finished');
            } catch (error) {
                const duration = Date.now() - started;
                const errorMessage = error instanceof Error ? error.message : String(error);

                await execution.updateOne({
                    completedAt: new Date(),
                    duration,
                    status: 'failed',
                    error: errorMessage
                });

                logger.error({ job: job.name, error }, 'Scheduler job failed');
            }
        });

        job.task = task;
    }

    /**
     * Updates job configuration and dynamically reschedules without restart.
     *
     * Allows admin to change schedule interval or enable/disable jobs at runtime.
     * Changes are persisted to MongoDB and take effect immediately.
     *
     * **Behavior:**
     * - If schedule changes: stops old cron task, starts new one with updated interval
     * - If enabled changes: starts or stops cron task accordingly
     * - If job is disabled and schedule changes: updates config but doesn't start task
     *
     * @param {string} jobName - Job identifier to update
     * @param {Object} updates - Configuration changes
     * @param {string} [updates.schedule] - New cron expression
     * @param {boolean} [updates.enabled] - New enabled state
     * @param {string} [updates.updatedBy] - Admin identifier making the change
     * @throws {Error} If job name is not registered
     *
     * @example
     * // Note: {S} represents / in cron expressions below
     * // Change market refresh interval from 10 to 5 minutes
     * await scheduler.updateJobConfig('markets:refresh', {
     *   schedule: '*{S}5 * * * *',
     *   enabled: true
     * });
     * // Disable blockchain sync temporarily
     * await scheduler.updateJobConfig('blockchain:sync', {
     *   enabled: false
     * });
     */
    async updateJobConfig(
        jobName: string,
        updates: { schedule?: string; enabled?: boolean; updatedBy?: string }
    ): Promise<void> {
        const job = this.jobs.get(jobName);
        if (!job) {
            throw new Error(`Job ${jobName} not registered`);
        }

        // Update MongoDB config
        const updateDoc: any = { updatedAt: new Date() };
        if (updates.schedule !== undefined) {
            updateDoc.schedule = updates.schedule;
        }
        if (updates.enabled !== undefined) {
            updateDoc.enabled = updates.enabled;
        }
        if (updates.updatedBy !== undefined) {
            updateDoc.updatedBy = updates.updatedBy;
        }

        await SchedulerConfigModel.updateOne({ jobName }, updateDoc, { upsert: true });

        // Determine if we need to reschedule
        const scheduleChanged = updates.schedule !== undefined && updates.schedule !== job.currentSchedule;
        const enabledChanged = updates.enabled !== undefined && updates.enabled !== job.enabled;

        // Update in-memory job state
        if (updates.schedule !== undefined) {
            job.currentSchedule = updates.schedule;
        }
        if (updates.enabled !== undefined) {
            job.enabled = updates.enabled;
        }

        // Apply changes to running task
        if (scheduleChanged || enabledChanged) {
            // Stop existing task if any
            if (job.task) {
                job.task.stop();
                job.task = undefined;
                logger.info({ jobName }, 'Stopped existing scheduler task');
            }

            // Start new task if enabled
            if (job.enabled) {
                this.scheduleJob(job);
                logger.info(
                    { jobName, schedule: job.currentSchedule },
                    'Rescheduled job with new configuration'
                );
            } else {
                logger.info({ jobName }, 'Job disabled, not scheduling');
            }
        }
    }

    /**
     * Returns current configuration for a specific job.
     *
     * Useful for admin UI to display current settings before editing.
     *
     * @param {string} jobName - Job identifier
     * @returns {Object|null} Job config or null if not found
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
     * Returns configuration for all registered jobs.
     *
     * Used by SystemMonitorService to display current scheduler state in admin UI.
     *
     * @returns {Array} Array of job configurations
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
     * Stops all running cron tasks.
     *
     * Called during graceful shutdown to ensure jobs don't execute mid-restart.
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
