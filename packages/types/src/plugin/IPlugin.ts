import type { ComponentType } from 'react';
import type { IPluginContext } from '../observer/IPluginContext.js';
import type { IPluginManifest } from './IPluginManifest.js';
import type { IAdminUIConfig } from './IAdminUIConfig.js';
import type { IMenuItemConfig } from './IMenuItemConfig.js';
import type { IPageConfig } from './IPageConfig.js';
import type { IApiRouteConfig } from './IApiRouteConfig.js';
import type { IFrontendPluginContext } from './IFrontendPluginContext.js';
import type { IWidgetConfig } from '../widget/IWidgetConfig.js';

/**
 * Complete plugin definition for TronRelic plugin system.
 *
 * Specifies a plugin's backend initialization hook, frontend components, menu items,
 * pages, and admin UI. Plugins use dependency injection to receive backend services
 * and can expose navigation menu items, routable pages, and React components for
 * real-time UI updates, toast notifications, or specialized admin dashboards.
 */
export interface IPlugin {
    /** Plugin metadata and runtime surface indicators */
    manifest: IPluginManifest;

    /**
     * Install lifecycle hook - called once when plugin is first loaded or after updates.
     *
     * Use this to create database indexes, seed initial data, or perform one-time setup.
     * The install hook runs before init() and receives the same plugin context.
     *
     * @param context - Plugin context with database access and other services
     *
     * @example
     * ```typescript
     * install: async (context) => {
     *     // Create indexes for better query performance
     *     await context.database.createIndex('subscriptions', { userId: 1, alertType: 1 });
     *     await context.database.createIndex('alerts', { timestamp: -1 });
     *
     *     // Seed default configuration
     *     const existing = await context.database.get('config');
     *     if (!existing) {
     *         await context.database.set('config', { threshold: 1000000 });
     *     }
     * }
     * ```
     */
    install?: (context: IPluginContext) => void | Promise<void>;

    /**
     * Initialize plugin (receives backend services via dependency injection).
     *
     * This hook runs every time the application starts. Use it to register observers,
     * start background tasks, or connect to external services. The init hook runs after
     * install() completes.
     *
     * @param context - Plugin context with database, observers, and WebSocket access
     */
    init?: (context: IPluginContext) => void | Promise<void>;

    /**
     * Uninstall lifecycle hook - called when plugin is being removed.
     *
     * Use this to clean up database collections, cancel scheduled jobs, or remove
     * any persistent state. This is optional and rarely needed since most plugins
     * are permanent features.
     *
     * @param context - Plugin context with database access
     *
     * @example
     * ```typescript
     * uninstall: async (context) => {
     *     // Drop all plugin collections
     *     const collections = ['subscriptions', 'alerts', 'config'];
     *     for (const name of collections) {
     *         const collection = context.database.getCollection(name);
     *         await collection.drop().catch(() => {}); // Ignore if doesn't exist
     *     }
     * }
     * ```
     */
    uninstall?: (context: IPluginContext) => void | Promise<void>;

    /**
     * Enable lifecycle hook - called when plugin is being enabled.
     *
     * Use this to start background tasks, register event listeners, or activate
     * features that should only run when the plugin is enabled. This hook runs
     * after the plugin is installed and before init().
     *
     * @param context - Plugin context with full access to services
     *
     * @example
     * ```typescript
     * enable: async (context) => {
     *     // Start scheduled tasks
     *     context.logger.info('Plugin enabled, starting background tasks');
     *     // Activate feature-specific functionality
     * }
     * ```
     */
    enable?: (context: IPluginContext) => void | Promise<void>;

    /**
     * Disable lifecycle hook - called when plugin is being disabled.
     *
     * Use this to stop background tasks, unregister event listeners, or deactivate
     * features. The plugin remains installed but inactive. This hook should clean up
     * any runtime state without removing persistent data.
     *
     * @param context - Plugin context with full access to services
     *
     * @example
     * ```typescript
     * disable: async (context) => {
     *     // Stop scheduled tasks
     *     context.logger.info('Plugin disabled, stopping background tasks');
     *     // Deactivate feature-specific functionality
     * }
     * ```
     */
    disable?: (context: IPluginContext) => void | Promise<void>;

    /** Navigation menu items provided by this plugin */
    menuItems?: IMenuItemConfig[];

    /** Routable pages provided by this plugin */
    pages?: IPageConfig[];

    /** Admin pages registered under /system/plugins/{plugin-id}/** */
    adminPages?: IPageConfig[];

    /**
     * API routes registered by this plugin.
     *
     * Defines REST endpoints that the plugin exposes for external integrations,
     * data management, or client-side operations. Routes are automatically mounted
     * under /api/plugins/{plugin-id}/ to prevent naming conflicts.
     *
     * @example
     * ```typescript
     * routes: [
     *     {
     *         method: 'GET',
     *         path: '/subscriptions/:userId',
     *         handler: async (req, res, next) => {
     *             const data = await context.database.findOne('subscriptions', {
     *                 userId: req.params.userId
     *             });
     *             res.json(data);
     *         },
     *         requiresAuth: true,
     *         description: 'Get user subscriptions'
     *     },
     *     {
     *         method: 'POST',
     *         path: '/subscriptions',
     *         handler: createSubscription,
     *         requiresAuth: true
     *     }
     * ]
     * ```
     */
    routes?: IApiRouteConfig[];

    /**
     * Admin API routes registered by this plugin.
     *
     * Defines admin-only REST endpoints for plugin configuration and management.
     * Routes are automatically mounted under /api/plugins/{plugin-id}/system/ and
     * require admin authentication (ADMIN_TOKEN).
     *
     * Admin routes are separated from public routes to:
     * - Enforce admin authentication automatically
     * - Clearly distinguish configuration from public data endpoints
     * - Follow the /system/** namespace convention
     *
     * @example
     * ```typescript
     * adminRoutes: [
     *     {
     *         method: 'GET',
     *         path: '/config',
     *         handler: async (req, res, next) => {
     *             const config = await context.database.get('config');
     *             res.json({ config });
     *         },
     *         description: 'Get plugin configuration'
     *     },
     *     {
     *         method: 'PUT',
     *         path: '/config',
     *         handler: updateConfig,
     *         description: 'Update plugin configuration'
     *     }
     * ]
     * ```
     */
    adminRoutes?: IApiRouteConfig[];

    /** Admin UI configuration (deprecated: use menuItems + pages instead) */
    adminUI?: IAdminUIConfig;

    /**
     * Widget configurations for injecting UI into page zones.
     *
     * Widgets allow plugins to extend existing pages by injecting components into
     * designated zones (e.g., 'main-after', 'sidebar-top'). Each widget specifies
     * which routes it should appear on and provides an async data fetcher for SSR.
     *
     * Unlike pages (which own their full route), widgets extend existing pages by
     * appearing in predefined zones. Multiple widgets can coexist in the same zone,
     * sorted by their order property.
     *
     * @example
     * ```typescript
     * widgets: [
     *     {
     *         id: 'reddit-feed',
     *         zone: 'main-after',
     *         routes: ['/'],
     *         order: 10,
     *         title: 'Community Buzz',
     *         fetchData: async () => {
     *             return { posts: await getRedditPosts(5) };
     *         }
     *     }
     * ]
     * ```
     */
    widgets?: IWidgetConfig[];

    /**
     * Frontend component to auto-render in the app (e.g., toast handlers, event listeners).
     *
     * The component receives IFrontendPluginContext as a prop, providing access to
     * WebSocket for event subscriptions, API client for data fetching, and UI utilities.
     * This is typically used for side-effect components that manage real-time updates,
     * toast notifications, or global event handlers.
     *
     * @example
     * ```typescript
     * function MyPluginHandler({ context }: { context: IFrontendPluginContext }) {
     *     const { websocket, ui } = context;
     *
     *     useEffect(() => {
     *         const handler = (data) => {
     *             // Show toast notification for custom events
     *         };
     *         websocket.socket.on('my:event', handler);
     *         return () => websocket.socket.off('my:event', handler);
     *     }, []);
     *
     *     return null; // Side-effect only, no UI
     * }
     * ```
     */
    component?: ComponentType<{ context: IFrontendPluginContext }>;
}
