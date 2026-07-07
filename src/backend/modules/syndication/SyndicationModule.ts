/**
 * @file SyndicationModule.ts
 *
 * Core module owning the platform's durable `publish` delivery family: the
 * transactional outbox, the relay scheduler job that drains it, the dead-letter
 * operator surface, and the `'syndication'` service other components enqueue
 * through. Where curation is the gate sink family and notifications the delivery
 * sink family, syndication is the publish family — it owns what *external*
 * delivery costs: durability across crashes, idempotent retry, and dead-lettering.
 *
 * It is a module rather than a plugin because durable external delivery is non-
 * toggleable infrastructure: once an originator (curation) commits an approved
 * item to syndication, the platform has promised to deliver it, and that promise
 * cannot be turned off at runtime without losing committed effects. The two-phase
 * lifecycle is the standard split — `init()` constructs the service and prepares
 * storage, `run()` registers the relay job, mounts the operator surface, and
 * publishes the service.
 *
 * @see ../../../docs/system/system-content-routing.md — the durable-delivery design.
 * @see ./README.md — the prescriptive module reference.
 */

import type { Express } from 'express';
import type {
    IContentRouter,
    IDatabaseService,
    IHookRegistry,
    IModule,
    IModuleMetadata,
    ISchedulerService,
    IServiceRegistry
} from '@/types';
import { SYNDICATION_SERVICE } from '@/types';
import { logger } from '../../lib/logger.js';
import { requireAdmin } from '../../api/middleware/admin-auth.js';
import { CONTENT_ROUTER_SERVICE } from '../../services/content-router.js';
import { SyndicationService } from './services/syndication-service.js';
import { SyndicationController } from './api/syndication.controller.js';
import { createSyndicationAdminRouter } from './api/syndication.router.js';

/** Scheduler job id for the outbox relay — the durable delivery worker. */
export const SYNDICATION_RELAY_JOB = 'syndication:relay';

/** Cron expression for the relay tick — every minute, matching the core sync cadence. */
export const SYNDICATION_RELAY_SCHEDULE = '*/1 * * * *';

/**
 * Dependencies the syndication module needs at bootstrap. A subset of the shared
 * module dependency bundle plus the scheduler service (the relay runs as a cron
 * job), so the bootstrap injects `sharedDeps` augmented with `scheduler`.
 */
export interface ISyndicationModuleDependencies {
    /** Core database for the outbox collection. */
    database: IDatabaseService;
    /** Service registry to publish `'syndication'` on and to resolve the content router. */
    serviceRegistry: IServiceRegistry;
    /** Core hook registry the relay invokes `scheduler.legDelivered` on after a successful delivery. */
    hookRegistry: IHookRegistry;
    /**
     * Scheduler the relay job registers on. Nullable, matching the platform
     * convention: a deployment with the scheduler disabled (`ENABLE_SCHEDULER`
     * off) still boots the module — enqueue and the operator surface work — but
     * the relay does not run, so committed legs wait until the scheduler returns.
     * This is the design's intended global kill-switch for delivery.
     */
    scheduler: ISchedulerService | null;
    /** Express app the operator router mounts onto. */
    app: Express;
}

/**
 * The durable publish-delivery module.
 */
export class SyndicationModule implements IModule<ISyndicationModuleDependencies> {
    readonly metadata: IModuleMetadata = {
        id: 'syndication',
        name: 'Syndication',
        version: '1.0.0',
        description: 'Durable publish delivery: transactional outbox, retrying relay, dead-letter, and the /api/admin/system/syndication operator surface'
    };

    private database!: IDatabaseService;
    private serviceRegistry!: IServiceRegistry;
    private hookRegistry!: IHookRegistry;
    private scheduler: ISchedulerService | null = null;
    private app!: Express;

    private service!: SyndicationService;
    private controller!: SyndicationController;

    private readonly logger = logger.child({ module: 'syndication' });

    /**
     * Construct the service and prepare the outbox storage. Does not register the
     * relay job, mount routes, or publish the service — that is `run()`.
     *
     * @param dependencies - Injected core infrastructure.
     */
    async init(dependencies: ISyndicationModuleDependencies): Promise<void> {
        this.logger.info('Initializing syndication module...');

        this.database = dependencies.database;
        this.serviceRegistry = dependencies.serviceRegistry;
        this.hookRegistry = dependencies.hookRegistry;
        this.scheduler = dependencies.scheduler;
        this.app = dependencies.app;

        // The content router is core infrastructure published before any module
        // init, so it is present. The relay resolves a leg's sink through it at
        // delivery time. Fail fast if it is missing — syndication cannot deliver
        // without the sink registry.
        const contentRouter = this.serviceRegistry.get<IContentRouter>(CONTENT_ROUTER_SERVICE);
        if (!contentRouter) {
            throw new Error("SyndicationModule requires the 'content-router' service to be published before init");
        }

        this.service = new SyndicationService(this.logger, this.database, contentRouter, this.hookRegistry);
        await this.service.ensureIndexes();
        this.controller = new SyndicationController(this.service);

        this.logger.info('syndication module initialized');
    }

    /**
     * Register the relay scheduler job, mount the operator router, and publish the
     * `'syndication'` service. The relay is a normal scheduler job, so it inherits
     * the global `ENABLE_SCHEDULER` kill-switch and the per-job admin controls.
     */
    async run(): Promise<void> {
        this.logger.info('Running syndication module...');

        // The relay drains the outbox every minute. The scheduler catches handler
        // errors, and runRelayOnce isolates each leg, so a single tick failure
        // never wedges the job. When the scheduler is disabled, enqueue and the
        // operator surface still work — the relay simply does not run, so committed
        // legs wait (the design's global delivery kill-switch).
        if (this.scheduler) {
            this.scheduler.register(SYNDICATION_RELAY_JOB, SYNDICATION_RELAY_SCHEDULE, async () => {
                await this.service.runRelayOnce();
            });
        } else {
            this.logger.warn('scheduler unavailable; syndication relay not registered — enqueued legs will not deliver until it is enabled');
        }

        // Operator surface: dead-letter inspection and manual retry. Admin auth is
        // applied here at mount time, mirroring the other /api/admin/system/* routers.
        this.app.use('/api/admin/system/syndication', requireAdmin, createSyndicationAdminRouter(this.controller));

        this.serviceRegistry.register(SYNDICATION_SERVICE, this.service);

        this.logger.info({ service: SYNDICATION_SERVICE, job: SYNDICATION_RELAY_JOB }, 'syndication module running');
    }

    /**
     * The syndication service, for tests and in-process consumers.
     *
     * @returns The syndication service instance.
     * @throws If called before `init()`.
     */
    getSyndication(): SyndicationService {
        if (!this.service) {
            throw new Error('SyndicationModule not initialized - call init() first');
        }
        return this.service;
    }
}
