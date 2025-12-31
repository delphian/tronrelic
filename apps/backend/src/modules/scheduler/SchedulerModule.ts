/**
 * @fileoverview Scheduler module for cron job management.
 *
 * Provides centralized scheduling with dynamic reconfiguration, execution tracking,
 * and overlap protection. Follows TronRelic's two-phase initialization pattern.
 *
 * @module modules/scheduler/SchedulerModule
 */

import type { Express } from 'express';
import type { IDatabaseService, IMenuService, IModule, IModuleMetadata } from '@tronrelic/types';
import { logger } from '../../lib/logger.js';
import { env } from '../../config/env.js';
import { SchedulerService } from './services/scheduler.service.js';
import { SchedulerController } from './api/scheduler.controller.js';
import { createSchedulerRouter } from './api/scheduler.routes.js';
import { registerCoreJobs } from './jobs/core-jobs.js';

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

        // Initialize the scheduler service singleton
        SchedulerService.setDependencies(this.database);

        // Create controller
        this.controller = new SchedulerController(this.database, this.moduleLogger);

        this.moduleLogger.info('Scheduler module initialized');
    }

    /**
     * Run the scheduler module.
     *
     * Phase 2: Activate and integrate with the application.
     * Registers menu item, mounts API routes, registers core jobs, and starts the scheduler.
     */
    async run(): Promise<void> {
        this.moduleLogger.info('Running scheduler module...');

        // Register menu item in system namespace
        await this.menuService.create({
            namespace: 'system',
            label: 'Scheduler',
            url: '/system/scheduler',
            icon: 'Clock',
            order: 35,
            parent: null,
            enabled: true
        });

        if (!this.schedulerEnabled) {
            this.moduleLogger.info('Scheduler module running (scheduler disabled)');
            return;
        }

        // Mount API routes (preserving existing paths for backward compatibility)
        const router = createSchedulerRouter(this.controller);
        this.app.use('/api/admin/system/scheduler', router);

        // Get the scheduler instance and register core jobs
        const scheduler = SchedulerService.getInstance();
        await registerCoreJobs(scheduler, this.database);

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
