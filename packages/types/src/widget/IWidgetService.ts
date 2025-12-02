import type { IWidgetConfig } from './IWidgetConfig.js';
import type { IWidgetData } from './IWidgetData.js';

/**
 * Service interface for managing plugin widget registration and data fetching.
 *
 * Provides centralized control over widget lifecycle with route matching and
 * SSR data fetching. Widgets are registered by plugins during initialization
 * and can be queried by route to determine which widgets should render.
 *
 * The service maintains an in-memory registry of widgets and provides methods
 * for fetching widget data during SSR or client-side rendering.
 *
 * @example
 * ```typescript
 * // Register a widget in plugin init() hook
 * await context.widgetService.register({
 *     id: 'my-plugin:feed',
 *     zone: 'main-after',
 *     routes: ['/'],
 *     order: 10,
 *     title: 'My Feed',
 *     fetchData: async () => ({ items: [] })
 * });
 *
 * // Fetch widgets for a route (in SSR)
 * const widgets = await widgetService.fetchWidgetsForRoute('/');
 * ```
 */
export interface IWidgetService {
    /**
     * Register a widget with the service.
     *
     * Adds the widget to the in-memory registry. The widget will be included
     * in future calls to fetchWidgetsForRoute() if the route matches.
     *
     * If a widget with the same ID already exists, it will be replaced.
     * This allows plugins to re-register widgets on hot reload.
     *
     * @param config - Widget configuration including zone, routes, and data fetcher
     * @param pluginId - ID of the plugin registering this widget
     * @returns Promise that resolves when registration is complete
     *
     * @example
     * ```typescript
     * await widgetService.register({
     *     id: 'reddit-feed',
     *     zone: 'main-after',
     *     routes: ['/'],
     *     order: 10,
     *     title: 'Community Buzz',
     *     fetchData: async () => ({ posts: [] })
     * }, 'reddit-sentiment');
     * ```
     */
    register(config: IWidgetConfig, pluginId: string): Promise<void>;

    /**
     * Unregister a widget from the service.
     *
     * Removes the widget from the in-memory registry. The widget will no longer
     * appear in calls to fetchWidgetsForRoute().
     *
     * This is called when a plugin is disabled or uninstalled.
     *
     * @param widgetId - Unique ID of the widget to unregister
     * @returns Promise that resolves when unregistration is complete
     *
     * @example
     * ```typescript
     * await widgetService.unregister('reddit-sentiment:feed');
     * ```
     */
    unregister(widgetId: string): Promise<void>;

    /**
     * Unregister all widgets for a plugin.
     *
     * Removes all widgets registered by the specified plugin. Used during
     * plugin disable/uninstall to clean up all widget registrations.
     *
     * @param pluginId - ID of the plugin whose widgets should be unregistered
     * @returns Promise that resolves when all widgets are unregistered
     *
     * @example
     * ```typescript
     * await widgetService.unregisterAll('reddit-sentiment');
     * ```
     */
    unregisterAll(pluginId: string): Promise<void>;

    /**
     * Fetch widget data for a specific route.
     *
     * Filters registered widgets by route match, executes their fetchData()
     * functions in parallel, and returns the results sorted by zone and order.
     *
     * This method is called during SSR to provide initial widget data. Each
     * widget's fetchData() function runs with a timeout to prevent slow widgets
     * from blocking page render.
     *
     * Widgets with failing fetchData() functions are excluded from results
     * (errors are logged but not thrown).
     *
     * @param route - URL path to match against widget routes (e.g., '/', '/dashboard')
     * @returns Promise resolving to array of widget data with pre-fetched content
     *
     * @example
     * ```typescript
     * // In Next.js layout or page
     * const widgets = await widgetService.fetchWidgetsForRoute('/');
     * // Returns: [{ id: 'reddit-feed', zone: 'main-after', data: {...} }]
     * ```
     */
    fetchWidgetsForRoute(route: string): Promise<IWidgetData[]>;

    /**
     * Get all registered widgets (without fetching data).
     *
     * Returns the raw widget configurations for all registered widgets.
     * Useful for admin interfaces or debugging.
     *
     * @returns Array of widget configurations
     *
     * @example
     * ```typescript
     * const allWidgets = widgetService.getAllWidgets();
     * console.log(`${allWidgets.length} widgets registered`);
     * ```
     */
    getAllWidgets(): IWidgetConfig[];

    /**
     * Get widgets for a specific zone (without fetching data).
     *
     * Returns widget configurations filtered by zone. Useful for debugging
     * or admin interfaces that need to show which widgets are in each zone.
     *
     * @param zone - Zone name to filter by
     * @returns Array of widget configurations in the specified zone
     *
     * @example
     * ```typescript
     * const mainAfter = widgetService.getWidgetsByZone('main-after');
     * console.log(`${mainAfter.length} widgets in main-after zone`);
     * ```
     */
    getWidgetsByZone(zone: string): IWidgetConfig[];
}
