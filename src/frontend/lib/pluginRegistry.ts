import type { IMenuItemConfig, IPageConfig, IPlugin } from '@/types';
import { frontendPlugins } from '../components/plugins/plugins.generated';

/**
 * Plugin menu and page registry for dynamic navigation.
 *
 * This module provides centralized access to plugin-provided menu items and pages.
 * It aggregates navigation and routing configurations from all loaded plugins,
 * enabling the UI to discover and render plugin features without hardcoding imports.
 *
 * The registry is self-bootstrapping at module load time: importing this module
 * synchronously registers every plugin from `plugins.generated.ts`. This works on
 * both server (for catch-all route SSR) and client (for synchronous render-time
 * lookups in PluginPageHandler), eliminating the polling pattern that previously
 * caused loading flash on plugin pages.
 *
 * Enabled-state filtering happens elsewhere — the catch-all server route filters
 * via /api/plugins/manifests in the request path, and PluginLoader filters
 * side-effect components by the same mechanism. The registry itself contains
 * every built-in plugin regardless of enabled state.
 */

interface PluginRegistryState {
    plugins: IPlugin[];
    menuItems: IMenuItemConfig[];
    pages: IPageConfig[];
}

type PluginRegistryListener = () => void;

class PluginRegistry {
    private state: PluginRegistryState = {
        plugins: [],
        menuItems: [],
        pages: []
    };

    private bootstrapped = false;

    private listeners: Set<PluginRegistryListener> = new Set();

    /**
     * Subscribe to plugin registration events.
     *
     * The provided callback will be invoked whenever a plugin is registered,
     * allowing components to reactively update when new plugins are loaded.
     *
     * @param listener - Callback function to invoke on plugin registration
     * @returns Unsubscribe function to remove the listener
     */
    subscribe(listener: PluginRegistryListener): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    /**
     * Notify all subscribers that the registry state has changed.
     *
     * This method is called internally after plugin registration to trigger
     * reactive updates in subscribed components.
     */
    private notify(): void {
        this.listeners.forEach(listener => listener());
    }

    /**
     * Register a plugin with the menu/page system.
     *
     * This method extracts menu items, pages, and admin pages from the plugin
     * definition and stores them for consumption by navigation and routing
     * components. It should be called by the plugin loader after successfully
     * loading a frontend plugin.
     *
     * Automatically adds the plugin ID to each page configuration for proper
     * context injection during rendering.
     *
     * @param plugin - The plugin definition containing menu items, pages, and/or admin pages
     */
    registerPlugin(plugin: IPlugin): void {
        this.state.plugins.push(plugin);

        if (plugin.menuItems) {
            this.state.menuItems.push(...plugin.menuItems);
        }

        if (plugin.pages) {
            // Add plugin ID to each page for context injection
            const pagesWithPluginId = plugin.pages.map(page => ({
                ...page,
                pluginId: plugin.manifest.id
            }));
            this.state.pages.push(...pagesWithPluginId);
        }

        // Register admin pages (also added to pages array)
        if (plugin.adminPages) {
            // Add plugin ID to each admin page for context injection
            const adminPagesWithPluginId = plugin.adminPages.map(page => ({
                ...page,
                pluginId: plugin.manifest.id
            }));
            this.state.pages.push(...adminPagesWithPluginId);
        }

        // Sort menu items by order and category
        this.state.menuItems.sort((a, b) => {
            // Group by category first
            const categoryA = a.category || 'default';
            const categoryB = b.category || 'default';
            if (categoryA !== categoryB) {
                return categoryA.localeCompare(categoryB);
            }

            // Then by order within category
            const orderA = a.order ?? 999;
            const orderB = b.order ?? 999;
            return orderA - orderB;
        });

        // Notify subscribers of the change
        this.notify();
    }

    /**
     * Bootstrap the registry from a known set of plugins, idempotently.
     *
     * Called once at module load time with the synchronously-imported list from
     * `plugins.generated.ts`. Subsequent calls are no-ops. The registry's
     * existing `clear()` and `registerPlugin()` methods remain available for
     * tests that need to reset state.
     *
     * @param plugins - Plugin instances to register synchronously
     */
    bootstrap(plugins: IPlugin[]): void {
        if (this.bootstrapped) {
            return;
        }
        this.bootstrapped = true;
        for (const plugin of plugins) {
            this.registerPlugin(plugin);
        }
    }

    /**
     * Get every plugin registered with the registry, regardless of enabled
     * state. Consumers that care about enabled state must filter externally
     * (typically via /api/plugins/manifests).
     *
     * @returns Array of all registered plugin instances
     */
    getAllPlugins(): IPlugin[] {
        return this.state.plugins;
    }

    /**
     * Get all registered menu items.
     *
     * Returns menu items sorted by category and order. This enables the
     * navigation component to render plugin menus in a predictable, organized manner.
     *
     * @returns Array of menu item configurations from all registered plugins
     */
    getMenuItems(): IMenuItemConfig[] {
        return this.state.menuItems;
    }

    /**
     * Get all registered pages.
     *
     * Returns page configurations that can be consumed by dynamic routing systems.
     * Each page maps a URL path to a React component provided by a plugin.
     *
     * @returns Array of page configurations from all registered plugins
     */
    getPages(): IPageConfig[] {
        return this.state.pages;
    }

    /**
     * Get a specific page by path.
     *
     * Looks up a page configuration by its URL path. This is useful for
     * dynamic route handlers that need to render the appropriate component
     * based on the current route.
     *
     * @param path - The URL path to lookup (e.g., '/whales', '/my-plugin/settings')
     * @returns The page configuration if found, undefined otherwise
     */
    getPageByPath(path: string): IPageConfig | undefined {
        return this.state.pages.find(page => page.path === path);
    }

    /**
     * Clear all registered plugins, menu items, and pages.
     *
     * This is primarily useful for testing or hot-reloading scenarios where
     * you need to reset the registry state and re-register plugins. Also resets
     * the bootstrap flag so a subsequent bootstrap() call repopulates state.
     */
    clear(): void {
        this.state = {
            plugins: [],
            menuItems: [],
            pages: []
        };
        this.bootstrapped = false;
    }
}

// Export singleton instance
export const pluginRegistry = new PluginRegistry();

// Self-bootstrap from the generated plugin list at module load. Runs once on
// both server and client thanks to Node's module cache and Next.js's bundling.
pluginRegistry.bootstrap(frontendPlugins);
