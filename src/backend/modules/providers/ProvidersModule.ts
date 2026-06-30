/**
 * @fileoverview Providers module: owns runtime configuration and clients for
 * external data providers, starting with TronScan.
 *
 * Why a module: the platform needs an always-on, core home for provider
 * credentials and transports that the admin Providers tab edits and that core
 * ingestion (price-history) consumes. It is not runtime-toggleable and provides
 * shared singletons (the config store and the TronScan client), so it is a module,
 * not a plugin. `init()` wires the config service and client singletons and builds
 * the controller; `run()` mounts the admin API. The system page's Providers tab is
 * registered centrally in bootstrap alongside the other system submenu tabs.
 */

import type { Express, Router } from 'express';
import type { IDatabaseService, IModule, IModuleMetadata } from '@/types';
import { logger } from '../../lib/logger.js';
import { requireAdmin } from '../../api/middleware/admin-auth.js';
import { createAdminRateLimiter } from '../../api/middleware/rate-limit.js';
import { ProviderConfigService } from './services/provider-config.service.js';
import { TronScanClient } from './clients/tron-scan.client.js';
import { ProvidersController } from './api/providers.controller.js';
import { createProvidersRouter } from './api/providers.routes.js';

/** Dependencies the providers module needs at bootstrap. */
export interface IProvidersModuleDependencies {
    /** Core KV store the provider config blobs persist to. */
    database: IDatabaseService;
    /** Express app the module mounts its admin router onto. */
    app: Express;
}

/**
 * Two-phase module wiring the provider-config service, the TronScan client, and
 * the admin API.
 */
export class ProvidersModule implements IModule<IProvidersModuleDependencies> {
    readonly metadata: IModuleMetadata = {
        id: 'providers',
        name: 'Providers',
        version: '1.0.0',
        description: 'Runtime configuration and clients for external data providers (TronScan).'
    };

    private app!: Express;
    private controller!: ProvidersController;
    private readonly logger = logger.child({ module: 'providers' });

    /**
     * Phase 1: wire the config-service and client singletons and build the
     * controller. No routes mounted yet.
     *
     * @param deps - Injected collaborators.
     */
    async init(deps: IProvidersModuleDependencies): Promise<void> {
        this.app = deps.app;

        ProviderConfigService.setDependencies(deps.database, this.logger.child({ service: 'provider-config' }));
        TronScanClient.setDependencies(this.logger.child({ client: 'tronscan' }));

        this.controller = new ProvidersController(
            ProviderConfigService.getInstance(),
            TronScanClient.getInstance(),
            this.logger
        );

        this.logger.info('Providers module initialized');
    }

    /**
     * Phase 2: mount the admin router behind the admin rate limiter and auth gate.
     */
    async run(): Promise<void> {
        const router: Router = createProvidersRouter(this.controller);
        this.app.use(
            '/api/admin/system/providers',
            createAdminRateLimiter('providers-admin'),
            requireAdmin,
            router
        );
        this.logger.info('Providers module running; admin surface mounted at /api/admin/system/providers');
    }
}
