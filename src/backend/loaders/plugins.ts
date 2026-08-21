import axios from 'axios';
import mongoose from 'mongoose';
import type { IPluginContext, IPlugin, IDatabaseService, IServiceRegistry, IHookRegistry } from '@/types';
import { PLUGIN_ID_PATTERN } from '@/types';
import { PluginHooks } from '../hooks/index.js';
import { PluginObserverRegistry } from '../observers/plugin-observer-registry.js';
import { logger } from '../lib/logger.js';
import { BlockchainObserverService } from '../services/blockchain-observer/index.js';
import { BaseObserver, BaseBatchObserver, BaseBlockObserver } from '../modules/blockchain/observers/index.js';
import { WebSocketService } from '../services/websocket.service.js';
import { PluginDatabaseService } from '../modules/database/index.js';
import { PluginClickHouseService } from '../modules/clickhouse/index.js';
import { PluginSchedulerService, type IPluginSchedulerHost } from '../modules/scheduler/index.js';
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
import { TronGridClient } from '../modules/blockchain/tron-grid.client.js';
import { BlockchainService } from '../modules/blockchain/blockchain.service.js';
import { ClickHouseService } from '../modules/clickhouse/services/clickhouse.service.js';
import { SignatureService } from '../modules/auth/signature.service.js';
import { getRedisClient } from './redis.js';
import { loadDiscoveredPlugins } from './plugins.generated.js';

/**
 * Loads all discovered plugins from the generated registry.
 *
 * The registry is produced at build time by scripts/generate-backend-plugin-registry.mjs
 * which scans src/plugins/ and emits dynamic-import call sites — one per plugin —
 * so esbuild does not crawl plugin source into the backend bundle. Each plugin
 * file is loaded at its own filesystem location at runtime, so its bare-specifier
 * dependencies resolve via the plugin's own node_modules.
 */
async function loadAllPlugins(): Promise<IPlugin[]> {
    return loadDiscoveredPlugins();
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
 * @param scheduler - Shared scheduler that owns the cron tasks, wrapped per plugin before it
 *                    reaches `context.scheduler` so the plugin manager can unregister a
 *                    plugin's jobs on disable. Null when `ENABLE_SCHEDULER=false`, in which
 *                    case plugins receive no scheduler at all, exactly as before.
 * @param serviceRegistry - Shared registry plugins publish services on and read them from
 * @param hookRegistry - Shared hook registry each plugin's hook facade registers against
 */
export async function loadPlugins(
    database: IDatabaseService,
    scheduler: IPluginSchedulerHost | null,
    serviceRegistry: IServiceRegistry,
    hookRegistry: IHookRegistry
): Promise<void> {
    await logger.waitUntilInitialized();

    const pluginList = await loadAllPlugins();
    const apiService = PluginApiService.getInstance();

    // Inject database into PluginMetadataService before getInstance()
    PluginMetadataService.setDependencies(database);
    const metadataService = PluginMetadataService.getInstance();
    const pluginManager = PluginManagerService.getInstance();
    pluginManager.setHookRegistry(hookRegistry);
    pluginManager.setServiceRegistry(serviceRegistry);
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
    const tronGridClient = TronGridClient.getInstance();
    // Ensure BlockchainService has database injected before getInstance() (may already be set by jobs/index.ts)
    BlockchainService.setDependencies(database);
    const blockchainService = BlockchainService.getInstance();

    // Get ClickHouse service if initialized (optional)
    const clickhouseService = ClickHouseService.isInitialized()
        ? ClickHouseService.getInstance()
        : undefined;

    // Create a TronWeb instance for signature verification in plugin contexts.
    // Uses the TronGridClient factory so the instance has platform defaults
    // (TronGrid host, API key) baked in without importing them directly.
    const tronWebInstance = tronGridClient.createTronWeb();

    // Create shared HTTP client for all plugins
    const httpClient = axios.create({
        timeout: 30000,
        headers: {
            'User-Agent': 'TronRelic/1.0'
        }
    });

    for (const plugin of pluginList) {
        const pluginLogger = logger.child({ pluginId: plugin.manifest.id, pluginTitle: plugin.manifest.title });

        // Check the id's format before the plugin is registered anywhere.
        // pluginPrefix() embeds the id verbatim in every collection and table
        // name the plugin owns, so the id has to be safe on two counts: it must
        // not contain the '_' that delimits it from the name following it, and
        // it must be safe to interpolate into SQL, because the ClickHouse
        // client does not escape a table name. PLUGIN_ID_PATTERN is what makes
        // both true. Skipping the plugin rather than throwing matches how the
        // loader already handles an individual plugin's problems: one bad
        // plugin must not stop the application from starting.
        // The typeof test comes first because RegExp.test() coerces its
        // argument: a manifest with a missing or null id would otherwise be
        // tested as the strings 'undefined' or 'null', both of which satisfy
        // the pattern. Two such plugins would then share plugin_undefined_,
        // which is the collision this gate exists to stop.
        if (typeof plugin.manifest.id !== 'string' || !PLUGIN_ID_PATTERN.test(plugin.manifest.id)) {
            pluginLogger.error(
                { pluginId: plugin.manifest.id },
                '✗ Skipping plugin: manifest.id must be lowercase letters, digits, and ' +
                'hyphens, starting with a letter, because any other character collides with a ' +
                'hyphenated id under the ClickHouse prefix rule. Use hyphens instead.'
            );
            continue;
        }

        try {
            // Register plugin in database (creates entry if new)
            await metadataService.registerPlugin(plugin.manifest);

            // Create plugin-scoped database service with injected mongoose connection
            const database = new PluginDatabaseService(pluginLogger, mongoose.connection, plugin.manifest.id);

            // Scope ClickHouse the same way, so a plugin names its tables
            // logically instead of repeating the physical prefix. Stays
            // undefined when ClickHouse is not configured, which is a
            // supported deployment — the context field is optional and
            // plugins already check it before use.
            const clickhouse = clickhouseService
                ? new PluginClickHouseService(clickhouseService, plugin.manifest.id)
                : undefined;

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

            // Per-plugin hook facade. Tags every registration with the
            // plugin id, enforces the lifecycle window, and lets the plugin
            // manager dispose every handler the plugin owns when it is
            // disabled or uninstalled.
            const pluginHooks = new PluginHooks(plugin.manifest.id, hookRegistry, pluginLogger);

            // Per-plugin observer facade. Records every subscription the plugin
            // makes so the plugin manager can revoke them — and stop the
            // observers behind them — when it is disabled. Without this a
            // disabled plugin's observer keeps consuming every matching
            // transaction for the life of the process.
            const pluginObservers = new PluginObserverRegistry(
                plugin.manifest.id,
                observerService,
                pluginLogger
            );

            // Per-plugin scheduler facade. Records every cron job the plugin
            // registers so the plugin manager can unregister them when it is
            // disabled and delete their stored configuration when it is
            // uninstalled. Without this a disabled plugin's job keeps firing on
            // its schedule for the life of the process, running a handler that
            // still holds the old plugin context. Left undefined when the
            // scheduler is switched off entirely (`ENABLE_SCHEDULER=false`), so
            // `context.scheduler` stays exactly what it was before — there are no
            // jobs to track when there is no scheduler.
            const pluginScheduler = scheduler
                ? new PluginSchedulerService(plugin.manifest.id, scheduler, pluginLogger)
                : undefined;

            // Create plugin context with injected dependencies. Widget
            // operations go through `services.get('widgets')` — see
            // IWidgetsService — so no widget-specific facade rides on
            // the context.
            const context: IPluginContext = {
                http: httpClient,
                observerRegistry: pluginObservers,
                websocketService,
                websocket: websocketManager as any, // Will be defined if io exists
                BaseObserver,
                BaseBatchObserver,
                BaseBlockObserver,
                database,
                clickhouse,
                cache: cacheService,
                systemConfig: systemConfigService,
                menuService,
                scheduler: (pluginScheduler ?? null) as any, // May be null if scheduler disabled
                chainParameters: chainParametersService,
                usdtParameters: usdtParametersService,
                tronGrid: tronGridClient,
                blockchainService,
                signatureService: new SignatureService(tronWebInstance),
                services: serviceRegistry,
                hooks: pluginHooks,
                logger: pluginLogger
            };

            // Register plugin in the manager (does not initialize)
            pluginManager.registerPlugin(plugin, context, pluginHooks, pluginObservers, pluginScheduler);

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

        /** Whether the plugin's own start-up hooks all completed. */
        let started = false;

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

            // Seal the lifecycle window on the hook facade. Handlers
            // registered during install/enable/init stay live for the
            // plugin's enabled lifetime; subsequent register() calls
            // (e.g. inside request handlers) now throw.
            loaded.hooks.seal();

            // Same window for cron jobs. Sealing here as well as in
            // PluginManagerService keeps the guarantee ISchedulerService
            // documents the same either way a plugin was activated —
            // this loader at startup, or /system/plugins at runtime.
            loaded.scheduler?.seal();
            started = true;

            // Register API routes
            apiService.registerPluginRoutes(plugin);
        } catch (error) {
            pluginLogger.error({ error }, '✗ Failed to load plugin');

            // Release whatever the half-finished start already registered. A plugin
            // that registers several cron jobs in a row and then throws would
            // otherwise leave the earlier ones firing on their schedule for the life
            // of the process, running handlers whose init() never finished.
            //
            // Note what this costs, because it differs from the same cleanup in
            // PluginManagerService. This loop only ever sees plugins the database
            // already records as installed and enabled, so the plugin is left reading
            // as enabled in /system/plugins while doing nothing. recordError below
            // stamps lastError and lastErrorAt on its metadata, which is the signal an
            // operator has to work from; recovery is Disable then Enable, or another
            // restart, which runs this loop again. That is accepted because the
            // alternative is cron jobs firing for a plugin that never started.
            //
            // Skipped once the plugin's own hooks have all run, because a later failure
            // such as route registration belongs to a plugin that is otherwise working.
            if (!started) {
                await pluginManager.disposePartialStart(metadata.id);
            }
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
