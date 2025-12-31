/**
 * @fileoverview Scheduler module barrel export.
 *
 * Public API for the scheduler module including the module class,
 * service, controller, and types.
 *
 * @module modules/scheduler
 */

// Module
export { SchedulerModule, type ISchedulerModuleDependencies } from './SchedulerModule.js';

// Service
export { SchedulerService, type CronJobHandler } from './services/index.js';

// API
export {
    SchedulerController,
    createSchedulerRouter,
    type SchedulerJobStatus,
    type SchedulerHealth
} from './api/index.js';

// Database models
export {
    SchedulerConfigModel,
    SchedulerExecutionModel,
    type SchedulerConfigDoc,
    type SchedulerExecutionDoc,
    type ISchedulerConfig,
    type ISchedulerExecution,
    type ISchedulerExecutionFields
} from './database/index.js';

// Jobs
export { registerCoreJobs } from './jobs/index.js';
