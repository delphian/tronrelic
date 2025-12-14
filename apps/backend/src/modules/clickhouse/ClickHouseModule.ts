/**
 * ClickHouse module implementation.
 *
 * Provides analytical database access for time-series data, aggregations, and
 * high-volume batch operations. ClickHouse complements MongoDB by handling
 * workloads that benefit from columnar storage and fast analytical queries.
 *
 * Why this module exists:
 * - Centralizes ClickHouse connection lifecycle management
 * - Provides IClickHouseService to plugins via dependency injection
 * - Follows TronRelic's two-phase initialization pattern
 * - Makes ClickHouse optional (gracefully skips if not configured)
 *
 * Configuration:
 * - CLICKHOUSE_HOST: HTTP endpoint (e.g., http://localhost:8123)
 * - CLICKHOUSE_DATABASE: Database name (default: tronrelic)
 * - CLICKHOUSE_USER: Username (default: default)
 * - CLICKHOUSE_PASSWORD: Password (optional)
 *
 * If CLICKHOUSE_HOST is not set, the module skips initialization and
 * getClickHouseService() returns undefined.
 */

import type { Express } from 'express';
import type { IModule, IModuleMetadata, ISystemLogService } from '@tronrelic/types';
import { ClickHouseService } from './services/clickhouse.service.js';

/**
 * Dependencies required by the ClickHouse module.
 */
export interface IClickHouseModuleDependencies {
    /** System log service for logging ClickHouse operations */
    logger: ISystemLogService;
    /** Express application for future admin route mounting */
    app: Express;
}

/**
 * ClickHouse module for analytical database access.
 *
 * Implements the IModule interface to provide:
 * - ClickHouse connection management
 * - IClickHouseService singleton for query/insert/exec operations
 * - Optional initialization (skips if CLICKHOUSE_HOST not configured)
 *
 * ## Lifecycle
 *
 * ### init() phase:
 * - Checks if CLICKHOUSE_HOST environment variable is set
 * - If not configured, logs info and skips initialization
 * - If configured, creates ClickHouseService singleton and connects
 * - Connection failure causes application shutdown (fail-fast)
 *
 * ### run() phase:
 * - Currently no-op (reserved for future admin routes)
 * - Could mount ClickHouse status/browser endpoints
 *
 * ## Public API
 *
 * Other modules and plugins access ClickHouse through:
 * ```typescript
 * const clickhouse = clickHouseModule.getClickHouseService();
 * if (clickhouse) {
 *     const results = await clickhouse.query('SELECT ...');
 * }
 * ```
 */
export class ClickHouseModule implements IModule<IClickHouseModuleDependencies> {
    /**
     * Module metadata for introspection and logging.
     */
    readonly metadata: IModuleMetadata = {
        id: 'clickhouse',
        name: 'ClickHouse',
        version: '1.0.0',
        description: 'Analytical database for time-series and aggregation workloads'
    };

    /**
     * Stored dependencies from init() phase.
     */
    private logger!: ISystemLogService;
    private app!: Express;

    /**
     * Whether ClickHouse was successfully initialized.
     */
    private enabled: boolean = false;

    /**
     * Initialize the ClickHouse module with injected dependencies.
     *
     * Phase 1: Prepare resources without activating.
     *
     * Checks for CLICKHOUSE_HOST configuration. If not set, the module
     * gracefully skips initialization and getClickHouseService() will
     * return undefined. If set, connects to ClickHouse and creates the
     * singleton service.
     *
     * @param dependencies - Logger and Express app
     * @throws Error if ClickHouse is configured but connection fails
     */
    async init(dependencies: IClickHouseModuleDependencies): Promise<void> {
        this.logger = dependencies.logger.child({ module: 'clickhouse' });
        this.app = dependencies.app;

        // Check if ClickHouse is configured
        const host = process.env.CLICKHOUSE_HOST;
        if (!host) {
            this.logger.info('ClickHouse not configured (CLICKHOUSE_HOST not set), skipping initialization');
            return;
        }

        this.logger.info('Initializing ClickHouse module...');

        // Initialize singleton service
        ClickHouseService.setDependencies(this.logger);
        const service = ClickHouseService.getInstance();

        // Connect to ClickHouse
        try {
            await service.connect();
            this.enabled = true;
            this.logger.info('ClickHouse module initialized');
        } catch (error) {
            this.logger.error({ error }, 'Failed to connect to ClickHouse');
            throw new Error(`ClickHouse connection failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Run the ClickHouse module after all modules have initialized.
     *
     * Phase 2: Activate and integrate with the application.
     *
     * Currently a no-op. Reserved for future admin routes such as:
     * - GET /api/admin/clickhouse/status - Connection health
     * - GET /api/admin/clickhouse/tables - List tables
     * - POST /api/admin/clickhouse/query - Execute ad-hoc queries
     */
    async run(): Promise<void> {
        if (!this.enabled) {
            return;
        }

        this.logger.info('ClickHouse module running');

        // Future: Mount admin routes for ClickHouse status/browser
        // const router = this.createAdminRouter();
        // this.app.use('/api/admin/clickhouse', requireAdmin, router);
    }

    /**
     * Get the ClickHouse service instance.
     *
     * Returns the singleton ClickHouseService if ClickHouse is configured
     * and connected. Returns undefined if ClickHouse is not configured.
     *
     * Consumers should check for undefined before using:
     * ```typescript
     * const clickhouse = clickHouseModule.getClickHouseService();
     * if (clickhouse) {
     *     await clickhouse.query('SELECT ...');
     * }
     * ```
     *
     * @returns ClickHouseService singleton or undefined if not configured
     */
    public getClickHouseService(): ClickHouseService | undefined {
        if (!this.enabled) {
            return undefined;
        }
        return ClickHouseService.getInstance();
    }

    /**
     * Check if ClickHouse is enabled and connected.
     *
     * @returns True if ClickHouse is configured and connection succeeded
     */
    public isEnabled(): boolean {
        return this.enabled;
    }
}
