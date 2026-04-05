import axios from 'axios';
import mongoose from 'mongoose';
import type { IPluginContext, IPlugin, IDatabaseService, ISchedulerService, IServiceRegistry } from '@/types';
import { logger } from '../lib/logger.js';
import { BlockchainObserverService } from '../services/blockchain-observer/index.js';
import { BaseObserver, BaseBatchObserver, BaseBlockObserver } from '../modules/blockchain/observers/index.js';
import { WebSocketService } from '../services/websocket.service.js';
import { PluginDatabaseService } from '../modules/database/index.js';
import { PluginApiService } from '../services/plugin-api.service.js';
import { PluginMetadataService } from '../services/plugin-metadata.service.js';
import { PluginManagerService } from '../services/plugin-manager.service.js';
import { PluginWebSocketManager } from '../services/plugin-websocket-manager.js';
import { PluginWebSocketRegistry } from '../services/plugin-websocket-registry.js';
import { CacheService } from '../services/cache.service.js';
import { SystemConfigService } from '../services/system-config/index.js';
import { MenuService } from '../modules/menu/services/menu.service.js';
import { ChainParametersService } from '../modules/chain-parameters/chain-parameters.service.js';
import { UsdtParametersService } from '../modules/usdt-parameters/usdt-parameters.service.js';
import { WidgetService } from '../services/widget/widget.service.js';
import { TronGridClient } from '../modules/blockchain/tron-grid.client.js';
import { BlockchainService } from '../modules/blockchain/blockchain.service.js';
import { ClickHouseService } from '../modules/clickhouse/services/clickhouse.service.js';
import { AddressLabelService } from '../modules/address-labels/services/address-label.service.js';
import type TronWeb from 'tronweb';
import { UserService } from '../modules/user/services/user.service.js';
import { SignatureService } from '../modules/auth/signature.service.js';
import { getRedisClient } from './redis.js';
import { discoveredPlugins } from './plugins.generated.js';

/**
 * Returns all discovered plugins from the generated registry.
 *
 * Plugins are discovered at build time by scripts/generate-backend-plugin-registry.mjs
 * which scans src/plugins/ and generates static imports. This eliminates runtime
 * filesystem scanning and enables on-the-fly TypeScript compilation during development.
 *
 * @returns Array of discovered plugins with their manifests and lifecycle hooks
 */
function loadAllPlugins(): IPlugin[] {
    return discoveredPlugins;
}

/**
 * Load and initialize all plugins.
 *
 * Plugins are auto-discovered by scanning src/plugins directory and
 * registered in the database with default state of installed: false, enabled: false.
 * Only plugins that are both installed AND enabled will have their lifecycle
 * hooks called and components loaded.
 *
 * Lifecycle (for installed + enabled plugins only):
 * 1. Register plugin metadata in database (auto-discovery)
 * 2. Install hook (one-time setup: indexes, seed data) - if not already installed
 * 3. Enable hook (activate features)
 * 4. Init hook (every startup: register observers, menu items via context.menuService, start services)
 * 5. API route registration (expose REST endpoints)
 */
/**
 * Load and initialize all discovered plugins.
 *
 * @param database - Shared database service instance from bootstrap
 * @param scheduler - Scheduler service instance for plugin cron job registration (null if disabled)
 */
export async function loadPlugins(database: IDatabaseService, scheduler: ISchedulerService | null, serviceRegistry: IServiceRegistry): Promise<void> {
    await logger.waitUntilInitialized();

    const pluginList = await loadAllPlugins();
    const apiService = PluginApiService.getInstance();

    // Inject database into PluginMetadataService before getInstance()
    PluginMetadataService.setDependencies(database);
    const metadataService = PluginMetadataService.getInstance();
    const pluginManager = PluginManagerService.getInstance();
    const observerService = BlockchainObserverService.getInstance();

    logger.info(`Discovered ${pluginList.length} plugins`);

    // First pass: Register all discovered plugins in database and plugin manager
    const websocketService = WebSocketService.getInstance();
    const wsRegistry = PluginWebSocketRegistry.getInstance();
    const io = websocketService.getIO();
    const redis = getRedisClient();
    const cacheService = new CacheService(redis, database);
    const systemConfigService = SystemConfigService.getInstance();
    const menuService = MenuService.getInstance();
    // Services already initialized with two-phase pattern in bootstrap (index.ts)
    // Caches are guaranteed warm at this point
    const chainParametersService = ChainParametersService.getInstance();
    const usdtParametersService = UsdtParametersService.getInstance();
    const widgetService = WidgetService.getInstance(logger);
    const tronGridClient = TronGridClient.getInstance();
    // Ensure BlockchainService has database injected before getInstance() (may already be set by jobs/index.ts)
    BlockchainService.setDependencies(database);
    const blockchainService = BlockchainService.getInstance();

    // Get AddressLabelService (initialized by AddressLabelsModule in bootstrap)
    const addressLabelService = AddressLabelService.getInstance();

    // Get ClickHouse service if initialized (optional)
    const clickhouseService = ClickHouseService.isInitialized()
        ? ClickHouseService.getInstance()
        : undefined;

    // Resolve TronWeb from the service registry once before the plugin loop
    // so that every plugin context receives the same configured instance.
    const tronWebInstance = serviceRegistry.get<TronWeb>('tronweb');
    if (!tronWebInstance) {
        throw new Error('TronWeb service not registered — ensure bootstrap registers "tronweb" before loading plugins');
    }

    // Create shared HTTP client for all plugins
    const httpClient = axios.create({
        timeout: 30000,
        headers: {
            'User-Agent': 'TronRelic/1.0'
        }
    });

    for (const plugin of pluginList) {
        const pluginLogger = logger.child({ pluginId: plugin.manifest.id, pluginTitle: plugin.manifest.title });

        try {
            // Register plugin in database (creates entry if new)
            await metadataService.registerPlugin(plugin.manifest);

            // Create plugin-scoped database service with injected mongoose connection
            const database = new PluginDatabaseService(pluginLogger, mongoose.connection, plugin.manifest.id);

            // Create plugin-scoped WebSocket manager if Socket.IO is initialized
            let websocketManager: PluginWebSocketManager | undefined;
            if (io) {
                websocketManager = new PluginWebSocketManager(
                    plugin.manifest.id,
                    io,
                    pluginLogger.child({ service: 'websocket' })
                );
                // Register the manager in the global registry
                wsRegistry.register(plugin.manifest.id, plugin.manifest.title, websocketManager);
            } else {
                pluginLogger.warn('Socket.IO not initialized - WebSocket features disabled for this plugin');
            }

            // Create plugin context with injected dependencies
            const context: IPluginContext = {
                http: httpClient,
                observerRegistry: observerService,
                websocketService,
                websocket: websocketManager as any, // Will be defined if io exists
                BaseObserver,
                BaseBatchObserver,
                BaseBlockObserver,
                database,
                clickhouse: clickhouseService,
                cache: cacheService,
                systemConfig: systemConfigService,
                menuService,
                scheduler: scheduler as any, // May be null if scheduler disabled
                chainParameters: chainParametersService,
                usdtParameters: usdtParametersService,
                widgetService,
                tronGrid: tronGridClient,
                blockchainService,
                addressLabelService,
                userService: UserService.getInstance(),
                signatureService: new SignatureService(tronWebInstance),
                services: serviceRegistry,
                logger: pluginLogger
            };

            // Register plugin in the manager (does not initialize)
            pluginManager.registerPlugin(plugin, context);

            pluginLogger.debug('Plugin discovered and registered');
        } catch (error) {
            pluginLogger.error({ error }, '✗ Failed to register plugin');
        }
    }

    // Second pass: Initialize only installed + enabled plugins
    const activePlugins = await metadataService.getActivePlugins();
    logger.info(`Loading ${activePlugins.length} active plugins (installed + enabled)`);

    for (const metadata of activePlugins) {
        const pluginLogger = logger.child({ pluginId: metadata.id, pluginTitle: metadata.title });

        try {
            const loaded = pluginManager.getPlugin(metadata.id);
            if (!loaded) {
                pluginLogger.warn('Plugin is active in database but not discovered in filesystem');
                continue;
            }

            const { plugin, context } = loaded;

            // Run install hook if not already installed (should be rare - usually already installed)
            if (!metadata.installed && plugin.install) {
                await plugin.install(context);
                await metadataService.markInstalled(metadata.id);
                pluginLogger.info('✓ Installed plugin');
            }

            // Run enable hook if defined
            if (plugin.enable) {
                await plugin.enable(context);
                pluginLogger.info('✓ Enabled plugin');
            }

            // Run init hook (every startup)
            if (plugin.init) {
                await plugin.init(context);
                pluginLogger.info('✓ Initialized plugin');
            } else {
                pluginLogger.info('✓ Loaded plugin (no init hook)');
            }

            // Register widgets if defined
            if (plugin.widgets && plugin.widgets.length > 0) {
                for (const widget of plugin.widgets) {
                    await widgetService.register(widget, metadata.id);
                }
                pluginLogger.info(`✓ Registered ${plugin.widgets.length} widget(s)`);
            }

            // Register API routes
            apiService.registerPluginRoutes(plugin);
        } catch (error) {
            pluginLogger.error({ error }, '✗ Failed to load plugin');
            await metadataService.recordError(metadata.id, error as Error);
        }
    }

    // Log summary
    const stats = apiService.getStats();
    logger.info(
        {
            totalDiscovered: pluginList.length,
            totalActive: activePlugins.length,
            pluginsWithRoutes: stats.pluginIds
        },
        `Plugin loading complete: ${activePlugins.length}/${pluginList.length} active`
    );
}
