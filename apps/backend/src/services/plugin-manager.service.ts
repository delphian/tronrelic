import type { IPlugin, IPluginContext, IPluginManifest } from '@tronrelic/types';
import { PluginMetadataService } from './plugin-metadata.service.js';
import { PluginDatabaseService } from '../modules/database/index.js';
import { PluginApiService } from './plugin-api.service.js';
import { BlockchainObserverService } from './blockchain-observer/index.js';
import { BaseObserver } from '../modules/blockchain/observers/BaseObserver.js';
import { WebSocketService } from './websocket.service.js';
import { logger } from '../lib/logger.js';

/**
 * Loaded plugin instance with its context.
 *
 * Stores the plugin definition and its injected context so lifecycle
 * hooks can be called during hot reload operations.
 */
interface ILoadedPlugin {
    plugin: IPlugin;
    context: IPluginContext;
    manifest: IPluginManifest;
}

/**
 * Plugin manager service for dynamic plugin lifecycle management.
 *
 * Handles plugin installation, uninstallation, enabling, and disabling with
 * hot reload support. Manages the loaded plugin registry and coordinates
 * lifecycle hooks with database state updates.
 */
export class PluginManagerService {
    private static instance: PluginManagerService;
    private loadedPlugins: Map<string, ILoadedPlugin> = new Map();
    private metadataService: PluginMetadataService;

    private constructor() {
        this.metadataService = PluginMetadataService.getInstance();
    }

    /**
     * Get singleton instance of the plugin manager service.
     *
     * The singleton pattern ensures consistent plugin state management
     * throughout the application lifecycle.
     *
     * @returns Shared plugin manager service instance
     */
    public static getInstance(): PluginManagerService {
        if (!PluginManagerService.instance) {
            PluginManagerService.instance = new PluginManagerService();
        }
        return PluginManagerService.instance;
    }

    /**
     * Register a plugin in the loaded plugins map.
     *
     * Called during initial plugin discovery to track available plugins.
     * Does not initialize the plugin - use loadPlugin() for that.
     *
     * @param plugin - Plugin definition
     * @param context - Plugin context with injected dependencies
     */
    public registerPlugin(plugin: IPlugin, context: IPluginContext): void {
        this.loadedPlugins.set(plugin.manifest.id, {
            plugin,
            context,
            manifest: plugin.manifest
        });
    }

    /**
     * Get a loaded plugin by ID.
     *
     * @param pluginId - Unique plugin identifier
     * @returns Loaded plugin instance or undefined if not found
     */
    public getPlugin(pluginId: string): ILoadedPlugin | undefined {
        return this.loadedPlugins.get(pluginId);
    }

    /**
     * Get all loaded plugin manifests.
     *
     * @returns Array of plugin manifests for all discovered plugins
     */
    public getAllManifests(): IPluginManifest[] {
        return Array.from(this.loadedPlugins.values()).map(p => p.manifest);
    }

    /**
     * Load and initialize a plugin.
     *
     * Runs the install hook (if not already installed), enable hook, and init hook
     * in sequence. Registers API routes if the plugin provides them.
     *
     * @param pluginId - Unique plugin identifier
     * @returns Success status and message
     */
    public async loadPlugin(pluginId: string): Promise<{ success: boolean; message: string }> {
        const loaded = this.loadedPlugins.get(pluginId);
        if (!loaded) {
            return { success: false, message: 'Plugin not found' };
        }

        const { plugin, context } = loaded;
        const pluginLogger = context.logger;

        try {
            const metadata = await this.metadataService.getMetadata(pluginId);
            if (!metadata) {
                return { success: false, message: 'Plugin metadata not found' };
            }

            // Run install hook if not already installed
            if (!metadata.installed && plugin.install) {
                pluginLogger.info('Running install hook');
                await plugin.install(context);
                await this.metadataService.markInstalled(pluginId);
            }

            // Run enable hook if defined
            if (plugin.enable) {
                pluginLogger.info('Running enable hook');
                await plugin.enable(context);
            }

            // Run init hook if defined
            if (plugin.init) {
                pluginLogger.info('Running init hook');
                await plugin.init(context);
            }

            // Mark as enabled in database
            await this.metadataService.markEnabled(pluginId);

            // Register API routes
            const apiService = PluginApiService.getInstance();
            apiService.registerPluginRoutes(plugin);

            pluginLogger.info('Plugin loaded and enabled successfully');
            return { success: true, message: 'Plugin loaded successfully' };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            pluginLogger.error({ error }, 'Failed to load plugin');
            await this.metadataService.recordError(pluginId, errorMessage);
            return { success: false, message: errorMessage };
        }
    }

    /**
     * Unload and disable a plugin.
     *
     * Runs the disable hook to clean up runtime state. Does not uninstall
     * the plugin or remove persistent data.
     *
     * @param pluginId - Unique plugin identifier
     * @returns Success status and message
     */
    public async unloadPlugin(pluginId: string): Promise<{ success: boolean; message: string }> {
        const loaded = this.loadedPlugins.get(pluginId);
        if (!loaded) {
            return { success: false, message: 'Plugin not found' };
        }

        const { plugin, context } = loaded;
        const pluginLogger = context.logger;

        try {
            // Run disable hook if defined
            if (plugin.disable) {
                pluginLogger.info('Running disable hook');
                await plugin.disable(context);
            }

            // Mark as disabled in database
            await this.metadataService.markDisabled(pluginId);

            // Unregister API routes
            const apiService = PluginApiService.getInstance();
            apiService.unregisterPluginRoutes(pluginId);

            pluginLogger.info('Plugin unloaded and disabled successfully');
            return { success: true, message: 'Plugin unloaded successfully' };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            pluginLogger.error({ error }, 'Failed to unload plugin');
            await this.metadataService.recordError(pluginId, errorMessage);
            return { success: false, message: errorMessage };
        }
    }

    /**
     * Install a plugin.
     *
     * Runs the install hook and marks the plugin as installed in the database.
     * Does not enable or initialize the plugin.
     *
     * @param pluginId - Unique plugin identifier
     * @returns Success status and message
     */
    public async installPlugin(pluginId: string): Promise<{ success: boolean; message: string }> {
        const loaded = this.loadedPlugins.get(pluginId);
        if (!loaded) {
            return { success: false, message: 'Plugin not found' };
        }

        const { plugin, context } = loaded;
        const pluginLogger = context.logger;

        try {
            const metadata = await this.metadataService.getMetadata(pluginId);
            if (!metadata) {
                return { success: false, message: 'Plugin metadata not found' };
            }

            if (metadata.installed) {
                return { success: false, message: 'Plugin is already installed' };
            }

            // Run install hook if defined
            if (plugin.install) {
                pluginLogger.info('Running install hook');
                await plugin.install(context);
            }

            // Mark as installed in database
            await this.metadataService.markInstalled(pluginId);

            pluginLogger.info('Plugin installed successfully');
            return { success: true, message: 'Plugin installed successfully' };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            pluginLogger.error({ error }, 'Failed to install plugin');
            await this.metadataService.recordError(pluginId, errorMessage);
            return { success: false, message: errorMessage };
        }
    }

    /**
     * Uninstall a plugin.
     *
     * Runs the uninstall hook and marks the plugin as uninstalled in the database.
     * Always sets installed: false even if the uninstall hook fails. Automatically
     * disables the plugin if it's currently enabled.
     *
     * @param pluginId - Unique plugin identifier
     * @returns Success status and message
     */
    public async uninstallPlugin(pluginId: string): Promise<{ success: boolean; message: string }> {
        const loaded = this.loadedPlugins.get(pluginId);
        if (!loaded) {
            return { success: false, message: 'Plugin not found' };
        }

        const { plugin, context } = loaded;
        const pluginLogger = context.logger;

        try {
            const metadata = await this.metadataService.getMetadata(pluginId);
            if (!metadata) {
                return { success: false, message: 'Plugin metadata not found' };
            }

            if (!metadata.installed) {
                return { success: false, message: 'Plugin is not installed' };
            }

            // Disable the plugin first if it's enabled
            if (metadata.enabled) {
                const disableResult = await this.unloadPlugin(pluginId);
                if (!disableResult.success) {
                    pluginLogger.warn({ error: disableResult.message }, 'Failed to disable plugin during uninstall');
                }
            }

            // Run uninstall hook if defined
            let uninstallError: string | undefined;
            if (plugin.uninstall) {
                try {
                    pluginLogger.info('Running uninstall hook');
                    await plugin.uninstall(context);
                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    pluginLogger.error({ error }, 'Uninstall hook failed, marking as uninstalled anyway');
                    uninstallError = errorMessage;
                }
            }

            // Always mark as uninstalled, even if hook failed
            await this.metadataService.markUninstalled(pluginId, uninstallError);

            pluginLogger.info('Plugin uninstalled');
            return {
                success: true,
                message: uninstallError
                    ? `Plugin uninstalled with errors: ${uninstallError}`
                    : 'Plugin uninstalled successfully'
            };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            pluginLogger.error({ error }, 'Failed to uninstall plugin');

            // Still try to mark as uninstalled
            try {
                await this.metadataService.markUninstalled(pluginId, errorMessage);
            } catch (dbError) {
                pluginLogger.error({ error: dbError }, 'Failed to update database during error handling');
            }

            return { success: false, message: errorMessage };
        }
    }

    /**
     * Enable a plugin.
     *
     * Runs the enable hook and init hook, then marks the plugin as enabled.
     * Requires the plugin to be installed first.
     *
     * @param pluginId - Unique plugin identifier
     * @returns Success status and message
     */
    public async enablePlugin(pluginId: string): Promise<{ success: boolean; message: string }> {
        const loaded = this.loadedPlugins.get(pluginId);
        if (!loaded) {
            return { success: false, message: 'Plugin not found' };
        }

        const { plugin, context } = loaded;
        const pluginLogger = context.logger;

        try {
            const metadata = await this.metadataService.getMetadata(pluginId);
            if (!metadata) {
                return { success: false, message: 'Plugin metadata not found' };
            }

            if (!metadata.installed) {
                return { success: false, message: 'Plugin must be installed before enabling' };
            }

            if (metadata.enabled) {
                return { success: false, message: 'Plugin is already enabled' };
            }

            // Run enable hook if defined
            if (plugin.enable) {
                pluginLogger.info('Running enable hook');
                await plugin.enable(context);
            }

            // Run init hook if defined
            if (plugin.init) {
                pluginLogger.info('Running init hook');
                await plugin.init(context);
            }

            // Mark as enabled in database
            await this.metadataService.markEnabled(pluginId);

            // Register API routes
            const apiService = PluginApiService.getInstance();
            apiService.registerPluginRoutes(plugin);

            pluginLogger.info('Plugin enabled successfully');
            return { success: true, message: 'Plugin enabled successfully' };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            pluginLogger.error({ error }, 'Failed to enable plugin');
            await this.metadataService.recordError(pluginId, errorMessage);
            return { success: false, message: errorMessage };
        }
    }

    /**
     * Disable a plugin.
     *
     * Runs the disable hook and marks the plugin as disabled. The plugin
     * remains installed but inactive.
     *
     * @param pluginId - Unique plugin identifier
     * @returns Success status and message
     */
    public async disablePlugin(pluginId: string): Promise<{ success: boolean; message: string }> {
        const loaded = this.loadedPlugins.get(pluginId);
        if (!loaded) {
            return { success: false, message: 'Plugin not found' };
        }

        const { plugin, context } = loaded;
        const pluginLogger = context.logger;

        try {
            const metadata = await this.metadataService.getMetadata(pluginId);
            if (!metadata) {
                return { success: false, message: 'Plugin metadata not found' };
            }

            if (!metadata.enabled) {
                return { success: false, message: 'Plugin is not enabled' };
            }

            // Run disable hook if defined
            if (plugin.disable) {
                pluginLogger.info('Running disable hook');
                await plugin.disable(context);
            }

            // Mark as disabled in database
            await this.metadataService.markDisabled(pluginId);

            // Unregister API routes
            const apiService = PluginApiService.getInstance();
            apiService.unregisterPluginRoutes(pluginId);

            pluginLogger.info('Plugin disabled successfully');
            return { success: true, message: 'Plugin disabled successfully' };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            pluginLogger.error({ error }, 'Failed to disable plugin');
            await this.metadataService.recordError(pluginId, errorMessage);
            return { success: false, message: errorMessage };
        }
    }
}
