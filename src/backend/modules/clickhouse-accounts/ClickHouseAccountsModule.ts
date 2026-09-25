/**
 * @fileoverview ClickHouse accounts module: provisions the ClickHouse users
 * that let different kinds of caller reach ClickHouse under limits the server
 * enforces, and gives admins configuration, accountability, and usage history
 * for each one.
 *
 * Why a separate module from `clickhouse`: the ClickHouse module has to start
 * very early, because migrations and block sync need the connection, while
 * this module needs MongoDB for stored limits and the audit trail and the
 * scheduler for its usage rollup, and the scheduler exists only later in
 * startup. Splitting them keeps both on the normal two-phase lifecycle with
 * every dependency injected.
 */

import type { Express } from 'express';
import type {
    IClickHouseAccountConnector,
    IClickHouseService,
    IDatabaseService,
    IModule,
    IModuleMetadata,
    ISchedulerService,
    IServiceRegistry
} from '@/types';
import { logger } from '../../lib/logger.js';
import { requireAdmin } from '../../api/middleware/admin-auth.js';
import { createAdminRateLimiter } from '../../api/middleware/rate-limit.js';
import { buildAccountDefinitions } from './services/buildAccountDefinitions.js';
import { ClickHouseAccountInspector } from './services/ClickHouseAccountInspector.js';
import { ClickHouseAccountService } from './services/ClickHouseAccountService.js';
import { ClickHouseAccountStore } from './services/ClickHouseAccountStore.js';
import { ClickHouseAccountUsageRollup } from './services/ClickHouseAccountUsageRollup.js';
import { ClickHouseAccountsController } from './api/ClickHouseAccountsController.js';
import { createClickHouseAccountsRouter } from './api/createClickHouseAccountsRouter.js';

/**
 * Prefix every scheduler job this module registers shares, so an admin
 * surface can filter the module's jobs by prefix rather than a fixed list.
 */
export const CLICKHOUSE_ACCOUNTS_JOB_PREFIX = 'clickhouse-accounts:';

/** Job that copies daily totals out of ClickHouse's short-lived query log. */
const ROLLUP_JOB = `${CLICKHOUSE_ACCOUNTS_JOB_PREFIX}rollup-usage`;

/**
 * Hourly, at seven minutes past. The query log keeps three days, so an hourly
 * run leaves plenty of slack for a missed run, and the offset keeps it away
 * from the jobs that fire on the hour.
 */
const ROLLUP_CRON = '0 7 * * * *';

/** Registry name the accounts service is published under. */
export const CLICKHOUSE_ACCOUNTS_SERVICE_NAME = 'clickhouse-accounts';

/**
 * Dependencies the ClickHouse accounts module needs.
 */
export interface IClickHouseAccountsModuleDependencies {
    /** Core database for stored limits and the audit trail. */
    database: IDatabaseService;
    /**
     * The shared ClickHouse connection, or undefined when ClickHouse is not
     * configured, in which case the module does nothing.
     */
    clickhouse: IClickHouseService | undefined;
    /**
     * The same ClickHouse service seen through its account-connector surface,
     * or undefined when ClickHouse is not configured.
     */
    connector: IClickHouseAccountConnector | undefined;
    /** Scheduler for the usage rollup; null in tests or when scheduling is off. */
    scheduler: ISchedulerService | null;
    /** Registry the accounts service is published on for late-binding consumers. */
    serviceRegistry: IServiceRegistry;
    /** Express app the admin router mounts on. */
    app: Express;
}

/**
 * Two-phase module: `init()` builds the service and creates its storage;
 * `run()` applies the accounts to ClickHouse, publishes the service, mounts
 * the admin API, and registers the rollup job.
 */
export class ClickHouseAccountsModule implements IModule<IClickHouseAccountsModuleDependencies> {
    readonly metadata: IModuleMetadata = {
        id: 'clickhouse-accounts',
        name: 'ClickHouse Accounts',
        version: '1.0.0',
        description: 'Server-enforced ClickHouse accounts with admin-tuned limits, audit, and usage history.'
    };

    private readonly logger = logger.child({ module: 'clickhouse-accounts' });
    private deps: IClickHouseAccountsModuleDependencies | null = null;
    private service: ClickHouseAccountService | null = null;
    private rollup: ClickHouseAccountUsageRollup | null = null;

    /**
     * Phase 1: build the service from its collaborators and create the
     * MongoDB indexes and the ClickHouse usage table.
     *
     * With ClickHouse unconfigured the module stores its dependencies and
     * stops, mirroring the ClickHouse module, so the feature simply does not
     * appear. A failure to create storage with ClickHouse configured is thrown,
     * because it means the database is not usable.
     *
     * @param deps - Injected collaborators.
     */
    async init(deps: IClickHouseAccountsModuleDependencies): Promise<void> {
        this.deps = deps;
        if (!deps.clickhouse || !deps.connector) {
            this.logger.info('ClickHouse not configured; ClickHouse accounts module inactive');
        } else {
            const store = new ClickHouseAccountStore(deps.database);
            await store.ensureIndexes();
            this.rollup = new ClickHouseAccountUsageRollup(deps.clickhouse);
            await this.rollup.ensureTable();
            ClickHouseAccountService.setDependencies({
                definitions: buildAccountDefinitions(deps.connector.rootUser()),
                connector: deps.connector,
                clickhouse: deps.clickhouse,
                store,
                inspector: new ClickHouseAccountInspector(deps.clickhouse),
                rollup: this.rollup,
                logger: this.logger
            });
            this.service = ClickHouseAccountService.getInstance();
            this.logger.info('ClickHouse accounts module initialized');
        }
    }

    /**
     * Phase 2: apply every managed account to ClickHouse, publish the service,
     * mount the admin API, and register the usage rollup.
     *
     * @throws Error when called before `init()`.
     */
    async run(): Promise<void> {
        if (!this.deps) {
            throw new Error('ClickHouseAccountsModule.run() called before init()');
        }
        if (this.service && this.rollup) {
            await this.service.applyAll();
            this.deps.serviceRegistry.register(CLICKHOUSE_ACCOUNTS_SERVICE_NAME, this.service);

            const controller = new ClickHouseAccountsController(this.service, this.logger);
            this.deps.app.use(
                '/api/admin/system/clickhouse-accounts',
                createAdminRateLimiter('clickhouse-accounts-admin'),
                requireAdmin,
                createClickHouseAccountsRouter(controller)
            );

            if (this.deps.scheduler) {
                const rollup = this.rollup;
                /**
                 * Copy the last few days of per-user totals out of the query
                 * log before ClickHouse expires it. Failures are logged by the
                 * scheduler; the next hourly run recomputes the same days.
                 */
                const runRollup = async (): Promise<void> => {
                    await rollup.rollup();
                };
                // The module's logger goes with the job so the scheduler's own
                // failure entry lands under this module's log service name.
                this.deps.scheduler.register(ROLLUP_JOB, ROLLUP_CRON, runRollup, { logger: this.logger });
            }
            this.logger.info('ClickHouse accounts module running');
        }
    }

    /**
     * Expose the service for bootstrap wiring and tests without a registry
     * round trip.
     *
     * @returns The service, or null when ClickHouse is not configured.
     */
    getAccountService(): ClickHouseAccountService | null {
        return this.service;
    }
}
