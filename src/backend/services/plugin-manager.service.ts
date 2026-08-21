import { EventEmitter } from 'node:events';
import type {
    IPlugin,
    IPluginContext,
    IPluginManifest,
    IHookRegistry,
    IServiceRegistry,
    IWidgetsService
} from '@/types';
import { PluginMetadataService } from './plugin-metadata.service.js';
import { PluginDatabaseService } from '../modules/database/index.js';
import { PluginApiService } from './plugin-api.service.js';
import { BlockchainObserverService } from './blockchain-observer/index.js';
import { BaseObserver } from '../modules/blockchain/observers/BaseObserver.js';
import { WebSocketService } from './websocket.service.js';
import { logger } from '../lib/logger.js';
import { PluginHooks } from '../hooks/index.js';
import { PluginObserverRegistry } from '../observers/plugin-observer-registry.js';
import type { PluginSchedulerService } from '../modules/scheduler/index.js';

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
    /**
     * Per-plugin observer facade. Optional because plugins registered before the
     * facade existed — and tests that construct plugins directly — carry none; a
     * missing facade simply means there is no observer teardown to perform.
     */
    observers?: PluginObserverRegistry;
    /**
     * Per-plugin scheduler facade. Optional for the same reason as `observers`,
     * and additionally because `ENABLE_SCHEDULER=false` leaves the process with
     * no scheduler at all; a missing facade simply means there is no cron
     * teardown to perform.
     */
    scheduler?: PluginSchedulerService;
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
    private serviceRegistry: IServiceRegistry | null = null;

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
     * Inject the process-wide service registry.
     *
     * Called once during bootstrap from the plugin loader. Used on
     * plugin disable to look up the unified `'widgets'` service and
     * dispose every widget registration owned by the plugin
     * (placements soft-disabled, widget types and zones removed).
     *
     * @param registry - Shared service registry instance.
     */
    public setServiceRegistry(registry: IServiceRegistry): void {
        this.serviceRegistry = registry;
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
     * @param observers - Per-plugin observer facade tied to this context, used by
     *   disable/uninstall paths to revoke every blockchain subscription the plugin
     *   made and stop the observers behind them. Optional so callers that predate
     *   the facade (and tests constructing plugins directly) keep working; when
     *   absent, observer teardown is skipped and the plugin's observers survive
     *   disable exactly as they did before.
     * @param scheduler - Per-plugin scheduler facade tied to this context, used by
     *   disable/uninstall paths to unregister every cron job the plugin registered.
     *   Optional because the process may be running with the scheduler switched off
     *   entirely (`ENABLE_SCHEDULER=false`), and because tests constructing plugins
     *   directly pass none; when absent, cron teardown is skipped.
     */
    public registerPlugin(
        plugin: IPlugin,
        context: IPluginContext,
        hooks: PluginHooks,
        observers?: PluginObserverRegistry,
        scheduler?: PluginSchedulerService
    ): void {
        this.loadedPlugins.set(plugin.manifest.id, {
            plugin,
            context,
            manifest: plugin.manifest,
            hooks,
            observers,
            scheduler
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
    /**
     * Reopen the plugin's observer facade so its init hook may subscribe again.
     *
     * A previous disable closed the facade, and enable re-runs `init()` — which constructs fresh
     * observers and subscribes them. Without rearming, those calls would throw against a closed
     * facade and the re-enabled plugin would silently observe nothing. Mirrors `rearmHooks` on
     * the same lifecycle transitions.
     *
     * @param loaded - The loaded plugin whose observer facade should accept subscriptions again.
     */
    private rearmObservers(loaded: ILoadedPlugin): void {
        loaded.observers?.rearm();
    }

    /**
     * Reopen the plugin's scheduler facade so its init hook may register jobs again.
     *
     * A previous disable closed the facade, and enable re-runs `init()` — which is where every
     * shipped plugin registers its cron jobs. Without rearming, those calls would throw against a
     * closed facade and the re-enabled plugin would silently run nothing on a schedule. Mirrors
     * `rearmObservers` on the same lifecycle transitions.
     *
     * @param loaded - The loaded plugin whose scheduler facade should accept registrations again.
     */
    private rearmScheduler(loaded: ILoadedPlugin): void {
        loaded.scheduler?.rearm();
    }

    /**
     * Unregister every cron job the plugin owns.
     *
     * Scheduler jobs were the one registration that kept *executing* after a plugin was disabled:
     * the cron task went on firing on its schedule, running a handler closure that still held the
     * old plugin context, and an uninstalled plugin left its `scheduler_configs` documents behind
     * with nothing left to read them. Most plugins never unregistered their own jobs, so this is
     * the platform guarantee rather than a backstop.
     *
     * @param loaded - The loaded plugin whose cron jobs should be unregistered.
     * @param deleteFromDatabase - True on uninstall, so stored job configuration goes too; false
     *                             on disable, so an operator's schedule edits survive a toggle.
     */
    private async disposeScheduler(loaded: ILoadedPlugin, deleteFromDatabase: boolean): Promise<void> {
        if (!loaded.scheduler) {
            return;
        }

        try {
            const unregistered = await loaded.scheduler.unregisterAll(deleteFromDatabase);
            if (unregistered > 0) {
                logger.info(
                    { pluginId: loaded.manifest.id, jobsUnregistered: unregistered, deleteFromDatabase },
                    'Unregistered plugin scheduler jobs'
                );
            }
        } catch (err) {
            logger.warn({ err, pluginId: loaded.manifest.id }, 'Scheduler facade dispose threw');
        }
    }

    /**
     * Tear down everything a half-finished start left registered.
     *
     * `enable()` and `init()` can throw partway through, after the plugin has already
     * registered some of its hooks, observers, and cron jobs — several shipped plugins
     * register three or four jobs one after another. The plugin is never marked enabled
     * when that happens, so `disablePlugin` refuses it with "Plugin is not enabled" and no
     * other route to clean up exists. The registrations that did land would then survive
     * for the life of the process, and a cron job among them would keep firing on its
     * schedule against a plugin that is not running. Releasing them here — hooks,
     * observers, cron jobs, widgets, and API routes, the same set a clean disable
     * releases — leaves the plugin in the state a disable would have left it in.
     *
     * Stored job configuration is kept, matching disable rather than uninstall, because the
     * plugin is still installed and a later retry should find an operator's schedule edits
     * where they left them.
     *
     * Public because the bootstrap loader activates plugins on its own path, outside this
     * service's enable and load methods, and needs the same cleanup when a start fails
     * there. It never throws, so a caller can use it from inside its own catch block
     * without a second failure hiding the first.
     *
     * @param pluginId - Id of the plugin whose partial registrations should be released.
     *                   Unknown ids are ignored, so a caller does not have to check first.
     */
    public async disposePartialStart(pluginId: string): Promise<void> {
        const loaded = this.loadedPlugins.get(pluginId);

        if (loaded) {
            this.disposeHooks(loaded);
            this.disposeObservers(loaded);
            await this.disposeScheduler(loaded, false);
            await this.disposeWidgetsForPlugin(pluginId);

            try {
                PluginApiService.getInstance().unregisterPluginRoutes(pluginId);
            } catch (err) {
                logger.warn({ err, pluginId }, 'Route unregister threw during failed-start cleanup');
            }
        }
    }

    /**
     * Revoke every blockchain observer subscription the plugin owns.
     *
     * Observer subscriptions were the one registration the disable path never tore down, so a
     * disabled plugin's observer kept receiving transactions — writing to its collections and
     * emitting WebSocket events — until the process restarted, while the admin observer table
     * still listed it. The facade also stops each observer, so anything already queued is
     * discarded rather than draining after the plugin is gone.
     *
     * @param loaded - The loaded plugin whose observer subscriptions should be revoked.
     */
    private disposeObservers(loaded: ILoadedPlugin): void {
        if (!loaded.observers) {
            return;
        }

        try {
            const revoked = loaded.observers.closeAndDisposeAll();
            if (revoked > 0) {
                logger.info(
                    { pluginId: loaded.manifest.id, subscriptionsRevoked: revoked },
                    'Revoked plugin observer subscriptions'
                );
            }
        } catch (err) {
            logger.warn({ err, pluginId: loaded.manifest.id }, 'Observer facade dispose threw');
        }
    }

    private disposeHooks(loaded: ILoadedPlugin): void {
        try {
            loaded.hooks.closeAndDisposeAll();
        } catch (err) {
            logger.warn({ err, pluginId: loaded.manifest.id }, 'Hook facade dispose threw');
        }

        // Guarded for the same reason as the facade call above. Teardown runs from
        // inside the callers' own catch blocks, where a second failure would replace
        // the original error — turning a reported plugin failure into a 500, or
        // aborting the startup loop before the remaining plugins are activated.
        try {
            this.hookRegistry?.disposeForPlugin(loaded.manifest.id);
        } catch (err) {
            logger.warn({ err, pluginId: loaded.manifest.id }, 'Hook registry dispose threw');
        }
    }

    /**
     * Dispose every widget registration the plugin owns: soft-disable
     * its plugin-source placements (operator customisations survive),
     * remove its widget types from the type registry, remove any
     * plugin-declared zones from the zone registry. One call, one
     * service.
     *
     * Looks the service up dynamically on each invocation rather than
     * caching it — the widgets module registers `'widgets'` during its
     * `run()` phase, which happens before any plugin is enabled, so
     * the lookup always resolves at the disable-time call site.
     *
     * @param pluginId - Owner id whose widget surface should be torn down.
     */
    private async disposeWidgetsForPlugin(pluginId: string): Promise<void> {
        if (!this.serviceRegistry) return;

        // The registry lookup sits inside the try along with the call it feeds.
        // disposePartialStart promises never to throw, and the bootstrap loader relies
        // on that from inside its own catch — a rejection escaping here would abort the
        // loop before the remaining plugins are activated.
        try {
            const widgets = this.serviceRegistry.get<IWidgetsService>('widgets');
            if (!widgets) return;

            await widgets.unregisterAllForOwner(pluginId);
        } catch (err) {
            logger.warn(
                { err, pluginId },
                'IWidgetsService.unregisterAllForOwner threw during plugin disposal'
            );
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

        /**
         * Whether a failure below should release what the start already registered.
         *
         * False until the metadata read has succeeded and shown the plugin is not
         * already running, and false again once the start has completed. A failure at
         * any other moment belongs to a plugin this method never took charge of, and
         * tearing that plugin down would strip a live one.
         */
        let disposeOnFailure = false;

        try {
            const metadata = await this.metadataService.getMetadata(pluginId);
            if (!metadata) {
                return { success: false, message: 'Plugin metadata not found' };
            }

            // A plugin already recorded as enabled is running now, so a failure below
            // must not trigger the partial-start cleanup: re-running enable()/init()
            // hits "Job X already registered" from the shared scheduler, and tearing
            // down from there would strip a live plugin of its hooks, observers, cron
            // jobs, widgets, and routes while the database still says it is enabled.
            // enablePlugin refuses this case outright; this method stays callable and
            // simply keeps its hands off whatever is already running.
            disposeOnFailure = !metadata.enabled;

            // Rebind the plugin's hook facade so the install/enable/
            // init path sees an open lifecycle window for
            // context.hooks.register(...). Widget types and zones are
            // registered through IWidgetsService on the service
            // registry and are not gated by this facade.
            this.rearmHooks(loaded);
            this.rearmObservers(loaded);
            this.rearmScheduler(loaded);

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

            // Seal the hook lifecycle window. Subsequent
            // context.hooks.register(...) attempts (e.g. inside request
            // handlers) now throw — handlers registered during
            // install/enable/init stay live.
            loaded.hooks.seal();

            // Same window for cron jobs, which ISchedulerService documents as
            // register-during-startup-only. Jobs registered above stay scheduled.
            loaded.scheduler?.seal();

            // Mark as enabled in database
            await this.metadataService.markEnabled(pluginId);
            disposeOnFailure = false;

            // Register API routes
            const apiService = PluginApiService.getInstance();
            apiService.registerPluginRoutes(plugin);

            this.events.emit('plugin:enabled', { pluginId, manifest: loaded.manifest });

            pluginLogger.info('Plugin loaded and enabled successfully');
            return { success: true, message: 'Plugin loaded successfully' };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            pluginLogger.error({ error }, 'Failed to load plugin');
            if (disposeOnFailure) {
                // Only when this method had taken charge of a plugin that was not
                // running and had not finished starting it. Past `markEnabled` the
                // database records the plugin as running, and before the metadata read
                // succeeded there is no basis for touching it at all.
                await this.disposePartialStart(pluginId);
            }
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
            // Close the plugin's hook facade, revoke its blockchain observer
            // subscriptions, and tear down every widget registration it owns,
            // regardless of whether the plugin's disable hook remembered to
            // call disposers itself.
            this.disposeHooks(loaded);
            this.disposeObservers(loaded);
            await this.disposeScheduler(loaded, false);
            await this.disposeWidgetsForPlugin(loaded.manifest.id);

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

        /** Whether the install reached the point where the plugin could register anything. */
        let installStarted = false;

        try {
            const metadata = await this.metadataService.getMetadata(pluginId);
            if (!metadata) {
                return { success: false, message: 'Plugin metadata not found' };
            }

            if (metadata.installed) {
                return { success: false, message: 'Plugin is already installed' };
            }

            // Rearm the plugin's hook facade so the install hook may
            // register handlers. A previous disable/uninstall cycle
            // leaves the facade closed, and the install lifecycle
            // window is one of the three points where
            // context.hooks.register(...) is allowed — reinstall and
            // upgrade flows depend on a fresh facade.
            //
            // Widget types and zones are no longer gated by a per-plugin
            // facade; they are registered through IWidgetsService on the
            // service registry.
            this.rearmHooks(loaded);
            this.rearmObservers(loaded);
            this.rearmScheduler(loaded);
            installStarted = true;

            // Run install hook if defined
            if (plugin.install) {
                pluginLogger.info('Running install hook');
                await plugin.install(context);
            }

            // Seal the install hook lifecycle window. The next enable
            // cycle will rearm the hook facade before plugin.enable/init
            // runs.
            loaded.hooks.seal();

            // Close the observer facade and revoke anything the install hook
            // subscribed. Install leaves the plugin disabled, and a disabled
            // plugin must not observe transactions — nor would any later
            // teardown catch these subscriptions, since disablePlugin()
            // refuses a plugin that is not enabled and uninstallPlugin() only
            // unloads an enabled one. The next enable cycle rearms the facade
            // before init() subscribes for real.
            this.disposeObservers(loaded);

            // Same reasoning for cron jobs: install leaves the plugin disabled, so
            // a job the install hook registered would start firing for a plugin
            // that is not running. Stored configuration is kept, because the next
            // enable re-registers the job and an operator's schedule edit should
            // survive.
            await this.disposeScheduler(loaded, false);

            // Mark as installed in database
            await this.metadataService.markInstalled(pluginId);

            pluginLogger.info('Plugin installed successfully');
            return { success: true, message: 'Plugin installed successfully' };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            pluginLogger.error({ error }, 'Failed to install plugin');
            if (installStarted) {
                // Only once the facades were reopened and the install hook could have
                // registered something. An earlier failure — a metadata read that threw
                // on a spurious install call — belongs to a plugin that may be enabled
                // and running, and must not have its live registrations swept away.
                await this.disposePartialStart(pluginId);
            }
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

                    // unloadPlugin can return unsuccessfully with hooks, observers,
                    // widgets, or routes still registered. The uninstall carries on
                    // regardless and markUninstalled below puts the plugin out of reach
                    // of every lifecycle call, so release them here or they stay live
                    // for the rest of the process.
                    await this.disposePartialStart(pluginId);
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

            // Unregister any cron job the plugin still holds and delete the stored
            // configuration of the ones it registered earlier in this process. Runs
            // after the uninstall hook so a plugin that cleans up its own jobs is
            // honoured first, and runs regardless of whether that hook threw — a
            // half-finished uninstall must not leave a job firing on a schedule.
            await this.disposeScheduler(loaded, true);

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
            let uninstallRecorded = false;
            try {
                await this.metadataService.markUninstalled(pluginId, errorMessage);
                uninstallRecorded = true;
            } catch (dbError) {
                pluginLogger.error({ error: dbError }, 'Failed to update database during error handling');
            }

            // Release everything the plugin registered, and only once the uninstall is
            // on record. The success path does this before writing the record; reaching
            // here means it did not get that far.
            //
            // Recording the uninstall sets installed: false and enabled: false, after
            // which disablePlugin refuses the plugin ("not enabled") and enablePlugin
            // refuses it ("must be installed"). Anything still registered at that point
            // would stay live for the rest of the process with nothing able to reach it,
            // which is why this releases hooks, observers, widgets, and routes and not
            // just cron jobs.
            //
            // When the record could not be written — typically a database outage, which
            // is also what brought execution here — the plugin is left alone. Stripping
            // it would leave metadata saying installed and enabled for a plugin that
            // does nothing, and no lifecycle call could rebuild it short of a restart.
            //
            // Stored job configuration survives either way, because disposePartialStart
            // tears down at disable strength. A plugin that may still be running has its
            // jobs stopped, which reinstalling undoes; an operator's tuned schedule,
            // once deleted, does not come back.
            if (uninstallRecorded) {
                await this.disposePartialStart(pluginId);
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

        /**
         * Whether a failure below should release what the start already registered.
         *
         * False until the metadata read has succeeded and shown the plugin is not
         * already running, and false again once the start has completed. A failure at
         * any other moment belongs to a plugin this method never took charge of, and
         * tearing that plugin down would strip a live one.
         */
        let disposeOnFailure = false;

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

            // Past the guards: the plugin is installed, not running, and this method is
            // about to start it. Only now is a failure ours to clean up after.
            disposeOnFailure = true;

            // Rebind the plugin's hook facade so the enable/init path
            // sees an open lifecycle window for
            // context.hooks.register(...). Widget types and zones are
            // registered through IWidgetsService on the service
            // registry and are not gated by this facade.
            this.rearmHooks(loaded);
            this.rearmObservers(loaded);
            this.rearmScheduler(loaded);

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

            // Seal the lifecycle windows now that enable+init have run.
            loaded.hooks.seal();
            loaded.scheduler?.seal();

            // Mark as enabled in database
            await this.metadataService.markEnabled(pluginId);
            disposeOnFailure = false;

            // Register API routes
            const apiService = PluginApiService.getInstance();
            apiService.registerPluginRoutes(plugin);

            this.events.emit('plugin:enabled', { pluginId, manifest: loaded.manifest });

            pluginLogger.info('Plugin enabled successfully');
            return { success: true, message: 'Plugin enabled successfully' };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            pluginLogger.error({ error }, 'Failed to enable plugin');
            if (disposeOnFailure) {
                // Only when this method had taken charge of a plugin that was not
                // running and had not finished starting it. Past `markEnabled` the
                // database records the plugin as running, and before the metadata read
                // succeeded there is no basis for touching it at all.
                await this.disposePartialStart(pluginId);
            }
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
            // Close the plugin's hook facade, revoke its blockchain observer
            // subscriptions, and tear down every widget registration it owns,
            // regardless of whether the plugin's disable hook remembered to
            // call disposers itself.
            this.disposeHooks(loaded);
            this.disposeObservers(loaded);
            await this.disposeScheduler(loaded, false);
            await this.disposeWidgetsForPlugin(loaded.manifest.id);

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
