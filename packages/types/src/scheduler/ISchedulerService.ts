/**
 * Cron job handler function signature.
 *
 * Handlers can be either synchronous or asynchronous. The scheduler will
 * await async handlers before considering the job complete.
 */
export type CronJobHandler = () => Promise<void> | void;

/**
 * Scheduler service interface for plugin cron job registration.
 *
 * Allows plugins to schedule periodic tasks using cron expressions without
 * requiring manual scheduler configuration. Jobs are automatically managed
 * by the platform scheduler and persist across restarts.
 *
 * **Why plugins need this:**
 * - Market fetchers need periodic data refreshes (every 10 minutes)
 * - Analytics plugins need periodic aggregation jobs (hourly, daily)
 * - Cleanup tasks need scheduled execution (daily cache purge)
 * - Alert plugins need periodic checks (every minute)
 *
 * **How it works:**
 * 1. Plugin calls `register()` in `init()` lifecycle hook
 * 2. Scheduler creates cron job with provided expression
 * 3. Job executes on schedule, calling handler function
 * 4. Job persists to MongoDB for restart durability
 * 5. Job can be controlled via System Monitor dashboard
 * 6. Disabling the plugin unregisters the job; uninstalling it also deletes the
 *    stored configuration
 *
 * **Teardown is handled for you.** What a plugin receives on `context.scheduler`
 * is a per-plugin facade that records every job the plugin registers. When the
 * plugin is disabled, the platform unregisters all of them and keeps their stored
 * schedules so an operator's edits survive the toggle; when it is uninstalled,
 * those stored schedules are deleted too. A plugin does not have to call
 * `unregister()` in its own `disable()` or `uninstall()` hook, and one that does
 * is not doing anything wrong — the facade tracks what it has already released
 * and will not act twice.
 *
 * One case does not hold, and it is worth knowing before relying on the guarantee.
 * The facade only knows the jobs registered in the current process, so a plugin that
 * was already disabled when the backend started never ran `init()` and registered
 * nothing for it to find. Uninstalling from that state leaves the stored schedules
 * behind, and calling `unregister(name, true)` from the uninstall hook does not help:
 * the facade refuses a name it has no record of this plugin registering, rather than
 * delete a document that may hold another plugin's operator-tuned schedule. Anything
 * left behind is inert, because nothing runs a job that is not registered in memory,
 * so this is housekeeping rather than a job still firing.
 *
 * Register jobs only from `enable()` or `init()`. Registering later, such as from a
 * request handler, throws: a job created outside that window is not tracked and would
 * keep firing after the plugin is gone. Do not register from `install()` either. Install
 * leaves the plugin disabled, so the platform unregisters whatever the install hook
 * registered, and the enable that follows runs `enable()` and `init()` only — it never
 * re-runs `install()`, so the job would never come back.
 *
 * @example
 * ```typescript
 * // In plugin backend.ts init() hook
 * export const myPluginBackendPlugin = definePlugin({
 *     manifest: myManifest,
 *
 *     init: async (context: IPluginContext) => {
 *         // Register market refresh job (every 10 minutes)
 *         context.scheduler.register(
 *             'my-plugin:refresh-markets',
 *             '0 *\/10 * * * *',
 *             async () => {
 *                 const marketService = createMarketService(context);
 *                 await marketService.refreshAll();
 *                 context.logger.info('Market refresh complete');
 *             }
 *         );
 *
 *         // Register daily aggregation job (midnight UTC)
 *         context.scheduler.register(
 *             'my-plugin:daily-aggregation',
 *             '0 0 0 * * *',
 *             async () => {
 *                 await runDailyAggregation(context);
 *             }
 *         );
 *     }
 * });
 * ```
 */
export interface ISchedulerService {
    /**
     * Register a new scheduled cron job.
     *
     * Jobs are identified by unique names (convention: `{plugin-id}:{job-name}`)
     * to prevent collisions across plugins. The scheduler persists jobs to
     * MongoDB so they survive backend restarts.
     *
     * **Job naming convention:**
     * - Use plugin ID prefix to avoid collisions: `resource-markets:refresh`
     * - Use descriptive names: `whale-alerts:check-large-transfers`
     * - Avoid generic names: `refresh`, `sync`, `update`
     *
     * **Cron expression format:**
     * - Standard cron syntax: `second minute hour day month weekday`
     * - Examples:
     *   - `0 *\/10 * * * *` - Every 10 minutes
     *   - `0 0 * * * *` - Every hour
     *   - `0 0 0 * * *` - Midnight UTC daily
     *   - `0 0 12 * * MON` - Noon every Monday
     *
     * **Error handling:**
     * - Handler errors are caught and logged automatically
     * - Failed jobs don't block scheduler or other jobs
     * - Retries are NOT automatic (implement in handler if needed)
     *
     * **Performance considerations:**
     * - Heavy jobs should use queues (BullMQ) instead of direct execution
     * - Long-running jobs may overlap if schedule is too frequent
     * - Consider database/API rate limits when setting schedules
     *
     * @param name - Unique job identifier (prefix with plugin-id to avoid collisions)
     * @param defaultSchedule - Cron expression (e.g., "0 *\/10 * * * *" for every 10 minutes)
     * @param handler - Async function to execute on schedule
     *
     * @throws {Error} If job name already registered by another plugin
     * @throws {Error} If cron expression is invalid
     *
     * @example
     * ```typescript
     * // Every 10 minutes
     * context.scheduler.register(
     *     'resource-markets:refresh',
     *     '0 *\/10 * * * *',
     *     async () => {
     *         await marketService.refreshAll();
     *     }
     * );
     *
     * // Daily at midnight UTC
     * context.scheduler.register(
     *     'my-plugin:daily-cleanup',
     *     '0 0 0 * * *',
     *     async () => {
     *         await cleanupOldData();
     *     }
     * );
     * ```
     */
    register(name: string, defaultSchedule: string, handler: CronJobHandler): void;

    /**
     * Disable a scheduled job without removing it.
     *
     * Sets enabled=false and stops the cron task. The job configuration is
     * preserved in MongoDB and can be re-enabled via the admin UI or by
     * calling updateJobConfig with enabled=true.
     *
     * **When to use:**
     * - When temporarily suspending a job that may be re-enabled later, such as
     *   while a plugin's own configuration is incomplete
     *
     * You do not need this in a `disable()` hook. Disabling a plugin already
     * unregisters every job it registered, which stops the job and keeps its
     * stored configuration.
     *
     * @param name - Job identifier to disable
     * @throws {Error} If job name is not registered
     *
     * @example
     * ```typescript
     * // In plugin disable() lifecycle hook
     * disable: async (context: IPluginContext) => {
     *     await context.scheduler.disable('my-plugin:refresh-markets');
     *     context.logger.info('Market refresh job disabled');
     * }
     * ```
     */
    disable(name: string): Promise<void>;

    /**
     * Completely unregister a job from the scheduler.
     *
     * Stops the cron task, removes the job from memory, and optionally deletes
     * the MongoDB configuration record. Use this during plugin uninstall to
     * fully clean up scheduler state.
     *
     * **When to use:**
     * - When a job should never run again for this plugin instance, for example
     *   after the plugin drops a feature that owned it
     *
     * You do not need this in a `disable()` or `uninstall()` hook. The platform
     * unregisters a plugin's jobs on disable and deletes their stored
     * configuration on uninstall. Calling it anyway is safe: a job this plugin has
     * already released is not unregistered a second time.
     *
     * @param name - Job identifier to unregister
     * @param deleteFromDatabase - If true, also delete the MongoDB config record (default: false)
     * @throws {Error} If job name is not registered
     *
     * @example
     * ```typescript
     * // In plugin uninstall() lifecycle hook
     * uninstall: async (context: IPluginContext) => {
     *     await context.scheduler.unregister('my-plugin:refresh-markets', true);
     *     context.logger.info('Market refresh job unregistered and config deleted');
     * }
     * ```
     */
    unregister(name: string, deleteFromDatabase?: boolean): Promise<void>;
}
