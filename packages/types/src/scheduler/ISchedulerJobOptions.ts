/**
 * @fileoverview Optional settings a caller passes when registering a scheduler job.
 */

import type { ISystemLogService } from '../system-log/index.js';

/**
 * Optional settings for `ISchedulerService.register()`.
 *
 * Exists so a job's run outcomes are recorded under the component that owns the
 * job. Without it the scheduler logs every start, success, skip, and failure
 * through its own logger, so a module's or plugin's job failure is filed under
 * the core `tronrelic` service name and never appears on that component's own
 * Logs tab.
 */
export interface ISchedulerJobOptions {
    /**
     * Logger the scheduler uses for this job's run outcomes. Pass the owning
     * component's child logger, such as `logger.child({ module: '<id>' })`, so
     * entries record under `tronrelic:<id>`. A plugin does not need to set this:
     * the per-plugin scheduler facade supplies the plugin's own logger.
     */
    logger?: ISystemLogService;
}
