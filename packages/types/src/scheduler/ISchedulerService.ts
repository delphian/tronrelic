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
}
