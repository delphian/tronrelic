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
import type { IDatabaseService } from '@/types';
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
     * Report whether a job is currently registered.
     *
     * The per-plugin scheduler facade has to tell "no job exists under this name
     * anywhere" apart from "this name belongs to something else" before it decides
     * whether to delegate an unregister call. Asking is better than calling
     * `unregister()` and reading the error it throws, which would tie the caller to
     * the wording of a message.
     *
     * @param name - Job identifier to look for.
     * @returns True when the scheduler currently holds a job under this name.
     */
    hasJob(name: string): boolean {
        return this.jobs.has(name);
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
     * Delete stored configuration for jobs that are no longer registered.
     *
     * `unregister()` deletes a job's `scheduler_configs` document only while the
     * job is still in memory, which leaves a gap on the plugin uninstall path: a
     * plugin is disabled before it is uninstalled, so by the time the uninstall
     * runs its jobs are already out of the scheduler and their configuration
     * documents can no longer be reached by name. Those documents would then
     * outlive the plugin with nothing left that reads them. This method closes
     * that gap by deleting purely by name, with no registration check.
     *
     * Do not use it to stop a job. A registered job keeps running from memory
     * after its configuration is deleted, and the next start would simply write
     * the defaults back. Call `unregister()` for anything still registered.
     *
     * @param names - Job names to delete configuration for. An empty array is a
     *                no-op, so callers do not have to guard the common case of a
     *                plugin that registered nothing.
     * @returns Count of documents deleted, which the caller can log to show how
     *          much stale configuration the cleanup actually found.
     */
    async deleteJobConfigs(names: string[]): Promise<number> {
        let deleted = 0;

        if (names.length > 0) {
            const configModel = this.database.getModel<SchedulerConfigDoc>(this.CONFIG_COLLECTION);
            const result = await configModel.deleteMany({ jobName: { $in: names } });
            deleted = result.deletedCount ?? 0;

            logger.info({ jobNames: names, deleted }, 'Deleted scheduler job configuration');
        }

        return deleted;
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

        // Checked before the create() below as well as after it. An unregister that
        // arrives during the lookup has already run its own deleteOne and found
        // nothing, so writing the default document now would leave an orphan record
        // for a job that no longer exists, and nothing would ever delete it.
        if (this.wasUnregisteredMidStart(name, job)) {
            return;
        }

        let createdConfigId: unknown = null;

        if (!config) {
            config = await configModel.create({
                jobName: name,
                enabled: true,
                schedule: job.defaultSchedule,
                updatedAt: new Date()
            });
            createdConfigId = config._id;
            logger.info(
                { jobName: name, schedule: job.defaultSchedule },
                'Created default scheduler config'
            );
        }

        if (this.wasUnregisteredMidStart(name, job)) {
            // An unregister that landed while the insert above was in flight ran its
            // own deleteOne first and found nothing, so the document just written has
            // no job behind it and nothing else would ever remove it. Take it back out.
            //
            // By `_id`, never by name. The name can belong to a different document by
            // now: the plugin may have been re-enabled and re-registered the same job,
            // whose own start wrote a fresh config. Deleting by name would take that
            // live job's document instead, losing an operator's schedule edit while the
            // job kept running from memory.
            // Also skipped when a job holds the name again. The plugin may have been
            // re-enabled and re-registered while this call was suspended, and that
            // job's own start will have read the very document written above. Removing
            // it would leave a running job with no stored schedule, dropping an
            // operator's tuning back to the default at the next restart.
            if (createdConfigId && !this.jobs.has(name)) {
                await configModel.deleteOne({ _id: createdConfigId });
            }

            return;
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
     * Report whether the job captured at the top of `scheduleJobFromDatabase` has
     * been unregistered while a database round trip was in flight.
     *
     * `register()` starts `scheduleJobFromDatabase` without awaiting it, so a plugin
     * that is installed and immediately disabled — or enabled and quickly disabled —
     * unregisters the job microseconds after adding it. At that moment the job's
     * `task` is still undefined, so `unregister()` stops nothing and simply drops the
     * map entry. Carrying on with the captured job would create a live cron task on an
     * object the scheduler no longer holds a reference to, which nothing could ever
     * stop, or write a configuration document for a job that no longer exists.
     *
     * @param name - Job name the in-flight start was working on.
     * @param job - The job object captured before the first await, compared by
     *              identity so a same-named job registered since is treated as a
     *              different job rather than this one.
     * @returns True when the caller should abandon the start, having logged why.
     */
    private wasUnregisteredMidStart(name: string, job: RegisteredJob): boolean {
        const gone = this.jobs.get(name) !== job;

        if (gone) {
            logger.info({ jobName: name }, 'Scheduler job unregistered before it could start');
        }

        return gone;
    }

    /**
     * Schedule a single job with node-cron.
     *
     * The cron tick delegates to {@link executeJob} so a scheduled run and a
     * manual {@link runNow} share one execution path — identical overlap
     * protection, audit record, and never-throw contract. The callback is sync and
     * fire-and-forget (`void`) because executeJob owns all error handling, so an
     * unhandled rejection can never escape the node-cron callback.
     *
     * `recoverMissedExecutions` must stay on, and the reason is not obvious from
     * its name. node-cron does not sleep until the next matching time; it polls
     * on a `setTimeout(…, 1000)` chain measured from the end of the previous
     * poll, so each poll lands a few milliseconds later within its second than
     * the one before. Once that drift accumulates past a second, two
     * consecutive polls land in second N and second N+2, and no poll ever
     * observes the second in between. The library does look back at that second
     * on the following poll, but it only fires it when this option is set —
     * which it is not by default.
     *
     * A five-field cron expression is padded to a seconds field of exactly `0`,
     * so a job written `0 * * * *` has one firing second per hour. Losing that
     * one second loses the whole run, with no execution record and no warning.
     * Measured on production, roughly one second in every three hundred is
     * skipped, which costs an hourly job a run about once a fortnight. There is
     * no way to buy those back by editing a schedule, because the narrow window
     * is the point of an hourly or daily job.
     *
     * Turning recovery on cannot stampede. After a long stall node-cron replays
     * every missed match inside a single poll callback, and {@link executeJob}
     * adds the job to `runningJobs` synchronously before its first `await`, so
     * the first replayed match runs and the rest return early and log that the
     * previous execution is still running.
     *
     * @param job - Job to schedule
     */
    private scheduleJob(job: RegisteredJob): void {
        const task = cron.schedule(
            job.currentSchedule,
            () => {
                void this.executeJob(job);
            },
            { recoverMissedExecutions: true }
        );

        job.task = task;
    }

    /**
     * Execute one job's handler exactly once, with single-flight overlap
     * protection and full execution tracking.
     *
     * Why extracted from the cron callback: the manual {@link runNow} trigger must
     * behave identically to a scheduled tick — same guard against a second
     * concurrent run, same `scheduler_executions` audit row, same contract of never
     * rejecting — so the logic lives here rather than inline where only cron could
     * reach it.
     *
     * Never rejects: a handler failure is captured to the execution record and
     * logged, so both callers (cron and runNow) can fire-and-forget safely. The
     * running-set membership is released in `finally` and the execution row is
     * created *inside* the try, so even a failure while writing that row cannot
     * wedge the job into a permanently "running" state that would silently skip
     * every future tick and every future manual run.
     *
     * @param job - The registered job to execute.
     */
    private async executeJob(job: RegisteredJob): Promise<void> {
        if (this.runningJobs.has(job.name)) {
            logger.warn(
                { jobName: job.name },
                `Scheduled Job Skipped: ${job.name} - previous execution still running`
            );
            return;
        }

        this.runningJobs.add(job.name);
        const started = Date.now();
        logger.debug({ job: job.name }, `Scheduled Job Start: ${job.name}`);

        // Held as a nullable outer binding so the catch can tell whether the row was
        // ever created (creation itself may throw); the success path uses the
        // non-null `created` const directly.
        let execution: SchedulerExecutionDoc | null = null;
        try {
            const executionModel = this.database.getModel<SchedulerExecutionDoc>(this.EXECUTION_COLLECTION);
            const created = await executionModel.create({
                jobName: job.name,
                startedAt: new Date(),
                status: 'running',
                completedAt: null,
                duration: null,
                error: null
            });
            execution = created;

            await job.handler();
            const duration = Date.now() - started;

            await created.updateOne({
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

            // The row may not exist if creation itself threw; only update what we have.
            // Guard this write in its own try-catch: a failing handler often coincides
            // with a struggling database, so the update can itself reject. Letting it
            // escape would break the never-rejects contract and surface as an unhandled
            // rejection in the fire-and-forget callers (scheduleJob, runNow).
            if (execution) {
                try {
                    await execution.updateOne({
                        completedAt: new Date(),
                        duration,
                        status: 'failed',
                        error: errorMessage
                    });
                } catch (updateError) {
                    logger.error(
                        { job: job.name, error: updateError },
                        `Failed to persist failure status for job: ${job.name}`
                    );
                }
            }

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
    }

    /**
     * Trigger a registered job's handler immediately, outside its cron schedule.
     *
     * Why: operators need to force a run without waiting for the next tick — to
     * pick up a newly added work item, recover after a failed run, or exercise a
     * low-frequency job (e.g. a 4-hourly balance snapshot) that has not yet reached
     * its first scheduled boundary. The job's enabled flag is intentionally ignored
     * because a manual run is an explicit operator action that neither touches the
     * cron task nor mutates persisted config: a disabled job can be run once without
     * re-enabling it.
     *
     * Single-flight is preserved. If the job is already running (scheduled or
     * manual) this is a no-op reporting `started: false`, never a second concurrent
     * execution. The run is fire-and-forget — {@link executeJob} records the
     * outcome to the executions collection — so this resolves as soon as the run is
     * accepted and the HTTP caller is not held open for a long-running job.
     *
     * @param name - Registered job identifier to run.
     * @returns `{ started: true }` when a run was kicked off, `{ started: false }`
     *   when one was already in flight.
     * @throws Error if the job name is not registered.
     */
    async runNow(name: string): Promise<{ started: boolean }> {
        const job = this.jobs.get(name);
        if (!job) {
            throw new Error(`Job ${name} not registered`);
        }
        if (this.runningJobs.has(name)) {
            return { started: false };
        }
        // Fire-and-forget: executeJob re-checks the running set synchronously before
        // its first await, so there is no window for a stacked run between here and
        // there. We do not await it — the HTTP layer returns 202 immediately.
        void this.executeJob(job);
        return { started: true };
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
