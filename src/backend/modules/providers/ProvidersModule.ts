/**
 * @fileoverview Providers module: owns the vendor registry, runtime
 * configuration, and transport clients for external data vendors.
 *
 * Why a module: the platform needs an always-on, core home for vendor
 * credentials and transports that the system console edits and that core
 * ingestion (price-history) consumes. It is not runtime-toggleable and provides
 * shared singletons (the registry, the config store, and the vendor clients), so
 * it is a module, not a plugin. `init()` wires the singletons, declares every
 * vendor in the registry, and builds the controller; `run()` mounts the admin
 * API. The editing surface is the system page's Configuration tab, registered
 * centrally in bootstrap alongside the other system submenu tabs.
 *
 * A vendor is declared here with its descriptor, defaults, connectivity test,
 * and enabled check. Capability implementations (the price-history adapter for
 * each vendor) are attached by the module that owns the capability during its
 * own `init()`, which is why this module inits before price-history.
 *
 * TronScan, CoinGecko, and GeckoTerminal are live price vendors. TronGrid is
 * staged: its config and connectivity test are wired, but blockchain sync still
 * reads `TRONGRID_API_KEY*` from env until the switchover moves it here.
 */

import type { Express, Router } from 'express';
import type { IDatabaseService, IModule, IModuleMetadata } from '@/types';
import { logger } from '../../lib/logger.js';
import { requireAdmin } from '../../api/middleware/admin-auth.js';
import { createAdminRateLimiter } from '../../api/middleware/rate-limit.js';
import { ProviderConfigService } from './services/provider-config.service.js';
import { ProviderRegistry, type IProviderRegistry } from './services/provider-registry.service.js';
import { TronScanClient } from './clients/tron-scan.client.js';
import { TronGridProviderClient } from './clients/tron-grid.client.js';
import { CoinGeckoClient } from './clients/coin-gecko.client.js';
import { GeckoTerminalClient } from './clients/gecko-terminal.client.js';
import { ProvidersController } from './api/providers.controller.js';
import { createProvidersRouter } from './api/providers.routes.js';
import {
    TRONSCAN_DESCRIPTOR,
    DEFAULT_TRONSCAN_CONFIG,
    TRONGRID_DESCRIPTOR,
    DEFAULT_TRONGRID_CONFIG,
    COINGECKO_DESCRIPTOR,
    DEFAULT_COINGECKO_CONFIG,
    GECKOTERMINAL_DESCRIPTOR,
    DEFAULT_GECKOTERMINAL_CONFIG
} from './database/index.js';

/** Dependencies the providers module needs at bootstrap. */
export interface IProvidersModuleDependencies {
    /** Core KV store the provider config blobs persist to. */
    database: IDatabaseService;
    /** Express app the module mounts its admin router onto. */
    app: Express;
}

/**
 * Two-phase module wiring the registry, the provider-config service, the vendor
 * clients, and the admin API.
 */
export class ProvidersModule implements IModule<IProvidersModuleDependencies> {
    readonly metadata: IModuleMetadata = {
        id: 'providers',
        name: 'Providers',
        version: '1.1.0',
        description: 'Vendor registry, runtime configuration, and clients for external data providers (TronScan, TronGrid, CoinGecko, GeckoTerminal).'
    };

    private app!: Express;
    private registry!: ProviderRegistry;
    private controller!: ProvidersController;
    private readonly logger = logger.child({ module: 'providers' });

    /**
     * Phase 1: wire the config-service and client singletons, declare every
     * vendor in the registry, and build the controller. No routes mounted yet.
     *
     * @param deps - Injected collaborators.
     */
    async init(deps: IProvidersModuleDependencies): Promise<void> {
        this.app = deps.app;

        ProviderConfigService.setDependencies(deps.database, this.logger.child({ service: 'provider-config' }));
        TronScanClient.setDependencies(this.logger.child({ client: 'tronscan' }));
        TronGridProviderClient.setDependencies(this.logger.child({ client: 'trongrid' }));
        CoinGeckoClient.setDependencies(this.logger.child({ client: 'coingecko' }));
        GeckoTerminalClient.setDependencies(this.logger.child({ client: 'geckoterminal' }));

        const configService = ProviderConfigService.getInstance();
        this.registry = ProviderRegistry.getInstance();
        this.registry.registerVendor({
            descriptor: TRONSCAN_DESCRIPTOR,
            defaults: DEFAULT_TRONSCAN_CONFIG,
            testConnection: () => TronScanClient.getInstance().testConnection(),
            isEnabled: async () => (await configService.getTronScanConfig()).enabled
        });
        this.registry.registerVendor({
            descriptor: TRONGRID_DESCRIPTOR,
            defaults: DEFAULT_TRONGRID_CONFIG,
            testConnection: async () => {
                const result = await TronGridProviderClient.getInstance().testConnection();
                return { ok: result.ok, message: result.message };
            },
            isEnabled: async () => (await configService.getTronGridConfig()).enabled
        });
        this.registry.registerVendor({
            descriptor: COINGECKO_DESCRIPTOR,
            defaults: DEFAULT_COINGECKO_CONFIG,
            testConnection: () => CoinGeckoClient.getInstance().testConnection(),
            isEnabled: async () => (await configService.getCoinGeckoConfig()).enabled
        });
        this.registry.registerVendor({
            descriptor: GECKOTERMINAL_DESCRIPTOR,
            defaults: DEFAULT_GECKOTERMINAL_CONFIG,
            testConnection: () => GeckoTerminalClient.getInstance().testConnection(),
            isEnabled: async () => (await configService.getGeckoTerminalConfig()).enabled
        });

        this.controller = new ProvidersController(
            configService,
            this.registry,
            TronGridProviderClient.getInstance(),
            this.logger
        );

        this.logger.info({ vendors: this.registry.listVendors().map((vendor) => vendor.descriptor.id) }, 'Providers module initialized');
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

    /**
     * Expose the registry for bootstrap wiring, so a consumer module receives it
     * through its own dependencies rather than reaching for the singleton.
     *
     * @returns The vendor registry.
     */
    getRegistry(): IProviderRegistry {
        return this.registry;
    }
}
