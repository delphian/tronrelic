import { EventEmitter } from 'node:events';
import type { IPlugin, IPluginContext, IPluginManifest, IHookRegistry } from '@/types';
import { PluginMetadataService } from './plugin-metadata.service.js';
import { PluginDatabaseService } from '../modules/database/index.js';
import { PluginApiService } from './plugin-api.service.js';
import { BlockchainObserverService } from './blockchain-observer/index.js';
import { BaseObserver } from '../modules/blockchain/observers/BaseObserver.js';
import { WebSocketService } from './websocket.service.js';
import { logger } from '../lib/logger.js';
import { PluginHooks } from '../hooks/index.js';

/**
 * Lifecycle event payloads emitted by PluginManagerService.
 */
export interface IPluginEnabledEvent {
    pluginId: string;
    manifest: IPluginManifest;
}

export interface IPluginDisabledEvent {
    pluginId: string;
}

type PluginLifecycleEvents = {
    'plugin:enabled': [IPluginEnabledEvent];
    'plugin:disabled': [IPluginDisabledEvent];
};

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
    hooks: PluginHooks;
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
    private events: EventEmitter = new EventEmitter();
    private hookRegistry: IHookRegistry | null = null;

    private constructor() {
        this.metadataService = PluginMetadataService.getInstance();
    }

    /**
     * Inject the process-wide hook registry.
     *
     * Called once during bootstrap from the plugin loader. The registry
     * is used to rebuild a plugin's hook facade after it has been
     * disabled and to dispose handlers in bulk as a safety net.
     *
     * @param registry - Shared hook registry instance.
     */
    public setHookRegistry(registry: IHookRegistry): void {
        this.hookRegistry = registry;
    }

    /**
     * Subscribe to a plugin lifecycle event.
     *
     * `plugin:enabled` fires after a plugin transitions to the enabled state
     * (via loadPlugin during bootstrap or enablePlugin at runtime). `plugin:disabled`
     * fires after unloadPlugin or disablePlugin. Events let long-lived consumers
     * (e.g. the admin menu dropdown) stay in sync with plugin state without polling.
     *
     * @param event - Lifecycle event name
     * @param handler - Handler invoked with the event payload
     */
    public on<K extends keyof PluginLifecycleEvents>(
        event: K,
        handler: (...payload: PluginLifecycleEvents[K]) => void
    ): void {
        this.events.on(event, handler as (...args: unknown[]) => void);
    }

    /**
     * Unsubscribe a previously registered lifecycle handler.
     *
     * @param event - Lifecycle event name
     * @param handler - Same handler reference passed to on()
     */
    public off<K extends keyof PluginLifecycleEvents>(
        event: K,
        handler: (...payload: PluginLifecycleEvents[K]) => void
    ): void {
        this.events.off(event, handler as (...args: unknown[]) => void);
    }

    /**
     * Get manifests for plugins that are currently installed AND enabled.
     *
     * Cross-references persistent metadata (`enabled: true` in the database) with
     * the in-memory loaded plugin map so callers receive only manifests whose
     * runtime context is active.
     *
     * @returns Manifests of every enabled plugin, in arbitrary order
     */
    public async getEnabledManifests(): Promise<IPluginManifest[]> {
        const activeMetadata = await this.metadataService.getActivePlugins();
        const activeIds = new Set(activeMetadata.map(m => m.id));
        return Array.from(this.loadedPlugins.values())
            .filter(p => activeIds.has(p.manifest.id))
            .map(p => p.manifest);
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
     * @param hooks - Per-plugin hook facade tied to this context, used by
     *   disable/uninstall paths to close the lifecycle window and drop
     *   every handler the plugin has registered.
     */
    public registerPlugin(plugin: IPlugin, context: IPluginContext, hooks: PluginHooks): void {
        this.loadedPlugins.set(plugin.manifest.id, {
            plugin,
            context,
            manifest: plugin.manifest,
            hooks
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
     * Rebuild a plugin's hook facade and rebind it to the live context.
     *
     * Called immediately before re-entering a plugin's enable/init path
     * so the plugin sees an open lifecycle window. The previous facade
     * (if any) is closed and its handlers disposed, then a fresh facade
     * replaces `context.hooks`.
     *
     * @param loaded - Loaded plugin record.
     */
    private rearmHooks(loaded: ILoadedPlugin): void {
        if (!this.hookRegistry) {
            return;
        }
        try {
            loaded.hooks.closeAndDisposeAll();
        } catch (err) {
            logger.warn({ err, pluginId: loaded.manifest.id }, 'Hook facade dispose threw during rearm');
        }
        this.hookRegistry.disposeForPlugin(loaded.manifest.id);
        const fresh = new PluginHooks(loaded.manifest.id, this.hookRegistry, loaded.context.logger);
        loaded.hooks = fresh;
        loaded.context.hooks = fresh;
    }

    /**
     * Close a plugin's hook facade and drop every handler it owns.
     *
     * Called after a plugin's disable hook completes so any handlers
     * registered during init/enable are torn down regardless of whether
     * the plugin code remembered to dispose them itself.
     *
     * @param loaded - Loaded plugin record.
     */
    private disposeHooks(loaded: ILoadedPlugin): void {
        try {
            loaded.hooks.closeAndDisposeAll();
        } catch (err) {
            logger.warn({ err, pluginId: loaded.manifest.id }, 'Hook facade dispose threw');
        }
        if (this.hookRegistry) {
            this.hookRegistry.disposeForPlugin(loaded.manifest.id);
        }
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

            // Rebind a fresh hook facade so the plugin's install/enable/init
            // path sees an open lifecycle window.
            this.rearmHooks(loaded);

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

            // Seal the lifecycle window. Subsequent register() attempts
            // (e.g. inside request handlers) now throw — handlers
            // registered during install/enable/init stay live.
            loaded.hooks.seal();

            // Mark as enabled in database
            await this.metadataService.markEnabled(pluginId);

            // Register API routes
            const apiService = PluginApiService.getInstance();
            apiService.registerPluginRoutes(plugin);

            this.events.emit('plugin:enabled', { pluginId, manifest: loaded.manifest });

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

        // Run the plugin's disable hook inside its own try/catch so a
        // misbehaving plugin cannot starve the platform's cleanup that
        // follows. The hook is best-effort cleanup the plugin owns; the
        // disposers below are the only thing that guarantees handlers and
        // routes do not leak past the disabled boundary.
        let disableError: Error | null = null;
        if (plugin.disable) {
            try {
                pluginLogger.info('Running disable hook');
                await plugin.disable(context);
            } catch (error) {
                disableError = error instanceof Error ? error : new Error(String(error));
                pluginLogger.error({ error: disableError }, 'Plugin disable hook threw; continuing with platform cleanup');
            }
        }

        try {
            // Close the plugin's hook facade and drop every handler it
            // registered, regardless of whether the plugin's disable hook
            // remembered to call disposers itself.
            this.disposeHooks(loaded);

            // Mark as disabled in database
            await this.metadataService.markDisabled(pluginId);

            // Unregister API routes
            const apiService = PluginApiService.getInstance();
            apiService.unregisterPluginRoutes(pluginId);

            this.events.emit('plugin:disabled', { pluginId });

            if (disableError) {
                await this.metadataService.recordError(pluginId, disableError.message);
                return { success: false, message: `Disable hook threw but platform cleanup completed: ${disableError.message}` };
            }

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

            // Rearm the hook facade so the install hook may register
            // handlers. A previous disable/uninstall cycle leaves the
            // facade closed (closeAndDisposeAll flips it shut), and the
            // install lifecycle window is one of the three points where
            // context.hooks.register(...) is allowed — reinstall and
            // upgrade flows depend on this being a fresh facade.
            this.rearmHooks(loaded);

            // Run install hook if defined
            if (plugin.install) {
                pluginLogger.info('Running install hook');
                await plugin.install(context);
            }

            // Seal the install lifecycle window. The next enable cycle
            // will rearm the facade before plugin.enable/init runs.
            loaded.hooks.seal();

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

            // Rebind a fresh hook facade so the plugin's enable/init path
            // sees an open lifecycle window.
            this.rearmHooks(loaded);

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

            // Seal the lifecycle window now that enable+init have run.
            loaded.hooks.seal();

            // Mark as enabled in database
            await this.metadataService.markEnabled(pluginId);

            // Register API routes
            const apiService = PluginApiService.getInstance();
            apiService.registerPluginRoutes(plugin);

            this.events.emit('plugin:enabled', { pluginId, manifest: loaded.manifest });

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

        const metadata = await this.metadataService.getMetadata(pluginId).catch(() => null);
        if (!metadata) {
            return { success: false, message: 'Plugin metadata not found' };
        }

        if (!metadata.enabled) {
            return { success: false, message: 'Plugin is not enabled' };
        }

        // Run the plugin's disable hook inside its own try/catch so a
        // misbehaving plugin cannot starve the platform's cleanup. The
        // hook is best-effort cleanup the plugin owns; the disposers
        // below are the only thing that guarantees handlers and routes
        // do not leak past the disabled boundary.
        let disableError: Error | null = null;
        if (plugin.disable) {
            try {
                pluginLogger.info('Running disable hook');
                await plugin.disable(context);
            } catch (error) {
                disableError = error instanceof Error ? error : new Error(String(error));
                pluginLogger.error({ error: disableError }, 'Plugin disable hook threw; continuing with platform cleanup');
            }
        }

        try {
            // Close the plugin's hook facade and drop every handler it
            // registered, regardless of whether the plugin's disable hook
            // remembered to call disposers itself.
            this.disposeHooks(loaded);

            // Mark as disabled in database
            await this.metadataService.markDisabled(pluginId);

            // Unregister API routes
            const apiService = PluginApiService.getInstance();
            apiService.unregisterPluginRoutes(pluginId);

            this.events.emit('plugin:disabled', { pluginId });

            if (disableError) {
                await this.metadataService.recordError(pluginId, disableError.message);
                return { success: false, message: `Disable hook threw but platform cleanup completed: ${disableError.message}` };
            }

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
