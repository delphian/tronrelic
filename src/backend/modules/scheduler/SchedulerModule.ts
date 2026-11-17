/**
 * @fileoverview Scheduler module for cron job management.
 *
 * Provides centralized scheduling with dynamic reconfiguration, execution tracking,
 * and overlap protection. Follows TronRelic's two-phase initialization pattern.
 *
 * @module modules/scheduler/SchedulerModule
 */

import type { Express } from 'express';
import type { IDatabaseService, IMenuService, IModule, IModuleMetadata } from '@/types';
import { logger } from '../../lib/logger.js';
import { env } from '../../config/env.js';
import { MAIN_SYSTEM_CONTAINER_ID } from '../menu/index.js';
import { SchedulerService } from './services/scheduler.service.js';
import { NodeCronTrigger } from './services/NodeCronTrigger.js';
import { SchedulerController } from './api/scheduler.controller.js';
import { createSchedulerRouter } from './api/scheduler.routes.js';
import { registerCoreJobs } from './jobs/core-jobs.js';

/**
 * Menu namespace holding the `/system/scheduler` tab row. Kept out of `main`
 * so the tabs never appear in the site navigation; only the page's own
 * `MenuNavClient` reads it (the menu module's Submenu Pattern).
 */
const SUBMENU_NAMESPACE = 'scheduler';

/**
 * The page's tab row, declared as menu nodes so it inherits per-user gating,
 * ordering, and live refresh like every other admin tab row.
 *
 * Jobs is every job on the deployment, which is the page's purpose. Database
 * and Logs are the tabs every module owning collections and an admin page
 * carries: the module owns `scheduler_configs` and `scheduler_executions`, and
 * writes its own entries under `tronrelic:scheduler`.
 */
const SUBMENU_TABS: ReadonlyArray<{ label: string; tab: string; icon: string; order: number }> = [
    { label: 'Jobs', tab: 'jobs', icon: 'Clock', order: 0 },
    { label: 'Database', tab: 'database', icon: 'Database', order: 1 },
    { label: 'Logs', tab: 'logs', icon: 'ScrollText', order: 2 }
];

/**
 * Dependencies required by the scheduler module.
 */
export interface ISchedulerModuleDependencies {
    database: IDatabaseService;
    menuService: IMenuService;
    app: Express;
}

/**
 * Scheduler module implementation.
 *
 * Manages cron job scheduling with MongoDB-backed configuration persistence.
 * Jobs can be registered by core code and plugins, then controlled at runtime
 * via the admin API.
 *
 * Follows TronRelic's two-phase initialization:
 * - init(): Set up service singleton and controller
 * - run(): Register menu item, mount routes, register core jobs, start scheduler
 */
export class SchedulerModule implements IModule<ISchedulerModuleDependencies> {
    readonly metadata: IModuleMetadata = {
        id: 'scheduler',
        name: 'Scheduler',
        version: '1.0.0',
        description: 'Cron job scheduling with dynamic reconfiguration'
    };

    private database!: IDatabaseService;
    private menuService!: IMenuService;
    private app!: Express;
    private controller!: SchedulerController;
    private schedulerEnabled = false;
    private readonly moduleLogger = logger.child({ module: 'scheduler' });

    /**
     * Initialize the scheduler module.
     *
     * Phase 1: Prepare resources without activating.
     * Sets up the service singleton and creates the controller.
     *
     * @param dependencies - Injected dependencies
     */
    async init(dependencies: ISchedulerModuleDependencies): Promise<void> {
        this.moduleLogger.info('Initializing scheduler module...');

        this.database = dependencies.database;
        this.menuService = dependencies.menuService;
        this.app = dependencies.app;

        this.schedulerEnabled = env.ENABLE_SCHEDULER;

        if (!this.schedulerEnabled) {
            this.moduleLogger.warn('Scheduler disabled by configuration (ENABLE_SCHEDULER=false)');
            return;
        }

        // Initialize the scheduler service singleton. The module chooses the cron
        // library here; the service only knows the ICronTrigger interface. The
        // module's logger goes with it so the service's own entries, and the
        // runs of jobs registered without an owner's logger, land on the Logs
        // tab of /system/scheduler.
        SchedulerService.setDependencies(this.database, new NodeCronTrigger(), this.moduleLogger);

        // Create controller
        this.controller = new SchedulerController(this.database, this.moduleLogger);

        this.moduleLogger.info('Scheduler module initialized');
    }

    /**
     * Run the scheduler module.
     *
     * Phase 2: Activate and integrate with the application.
     * Registers the menu item and the page's tab row, mounts API routes,
     * registers core jobs, and starts the scheduler.
     */
    async run(): Promise<void> {
        this.moduleLogger.info('Running scheduler module...');

        // Register menu item under the System container. `requiresAdmin:
        // true` is auto-applied by MenuService.
        await this.menuService.create({
            namespace: 'main',
            label: 'Scheduler',
            url: '/system/scheduler',
            icon: 'Clock',
            order: 35,
            parent: MAIN_SYSTEM_CONTAINER_ID,
            enabled: true
        });

        // Register the in-page tab row as a namespaced menu (Submenu Pattern).
        // The nodes are memory-only and live outside the System container, so
        // the container's forced `requiresAdmin` does not reach them and the
        // module sets it per node. Registered before the disabled check below,
        // because the page and its Database and Logs tabs still work with
        // ENABLE_SCHEDULER=false.
        for (const tab of SUBMENU_TABS) {
            await this.menuService.create({
                namespace: SUBMENU_NAMESPACE,
                label: tab.label,
                url: `/system/scheduler?tab=${tab.tab}`,
                icon: tab.icon,
                order: tab.order,
                parent: null,
                enabled: true,
                requiresAdmin: true
            });
        }

        if (!this.schedulerEnabled) {
            this.moduleLogger.info('Scheduler module running (scheduler disabled)');
            return;
        }

        // Mount API routes (preserving existing paths for backward compatibility)
        const router = createSchedulerRouter(this.controller);
        this.app.use('/api/admin/system/scheduler', router);

        // Get the scheduler instance and register core jobs
        const scheduler = SchedulerService.getInstance();
        await registerCoreJobs(scheduler, this.database, this.moduleLogger);

        // Start the scheduler (loads config from MongoDB and schedules enabled jobs)
        await scheduler.start();

        this.moduleLogger.info('Scheduler module running');
    }

    /**
     * Get the scheduler service instance.
     *
     * Returns null if the scheduler is disabled via ENABLE_SCHEDULER=false.
     *
     * @returns Scheduler service or null
     */
    getSchedulerService(): SchedulerService | null {
        if (!this.schedulerEnabled) {
            return null;
        }
        try {
            return SchedulerService.getInstance();
        } catch {
            return null;
        }
    }

    /**
     * Stop the scheduler.
     *
     * Called during graceful shutdown to stop all running cron tasks.
     */
    stop(): void {
        if (this.schedulerEnabled) {
            try {
                SchedulerService.getInstance().stop();
            } catch {
                // Scheduler not initialized
            }
        }
    }
}
