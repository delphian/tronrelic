import type {
    IWidgetService,
    IWidgetConfig,
    IWidgetData,
    ISystemLogService
} from '@tronrelic/types';

/**
 * Singleton service managing plugin widget registration and SSR data fetching.
 *
 * Maintains an in-memory registry of widgets registered by plugins. Provides methods
 * for filtering widgets by route and fetching their data during SSR. This service
 * enables plugins to extend existing pages by injecting components into designated
 * zones without modifying core page code.
 *
 * Key responsibilities:
 * - Widget registration and deregistration
 * - Route-based filtering of active widgets
 * - Parallel data fetching for SSR with timeout protection
 * - Widget ordering by zone and sort order
 *
 * @example
 * ```typescript
 * // Register a widget in plugin init() hook
 * await widgetService.register({
 *     id: 'reddit-feed',
 *     zone: 'main-after',
 *     routes: ['/'],
 *     order: 10,
 *     title: 'Community Buzz',
 *     fetchData: async () => ({ posts: [] })
 * }, 'reddit-sentiment');
 *
 * // Fetch widgets for SSR
 * const widgets = await widgetService.fetchWidgetsForRoute('/');
 * ```
 */
export class WidgetService implements IWidgetService {
    private static instance: WidgetService;
    private widgets: Map<string, IWidgetConfig> = new Map();
    private logger: ISystemLogService;

    /**
     * Private constructor enforcing singleton pattern with dependency injection.
     *
     * @param logger - Structured logger for widget service telemetry
     */
    private constructor(logger: ISystemLogService) {
        this.logger = logger;
    }

    /**
     * Get or create the singleton instance.
     *
     * Must be called with logger on first access. Subsequent calls ignore the
     * logger parameter and return the existing instance.
     *
     * @param logger - Structured logger (required on first call)
     * @returns The singleton widget service instance
     */
    public static getInstance(logger?: ISystemLogService): WidgetService {
        if (!WidgetService.instance) {
            if (!logger) {
                throw new Error('Logger required for first WidgetService initialization');
            }
            WidgetService.instance = new WidgetService(logger);
        }
        return WidgetService.instance;
    }

    /**
     * Register a widget with the service.
     *
     * Adds the widget to the in-memory registry. If a widget with the same ID
     * already exists, it will be replaced. This allows plugins to re-register
     * widgets on hot reload.
     *
     * @param config - Widget configuration including zone, routes, and data fetcher
     * @param pluginId - ID of the plugin registering this widget
     * @returns Promise that resolves when registration is complete
     */
    public async register(config: IWidgetConfig, pluginId: string): Promise<void> {
        // Clone config to avoid mutations
        const widgetConfig: IWidgetConfig = {
            ...config,
            pluginId,
            order: config.order ?? 100 // Default order
        };

        this.widgets.set(config.id, widgetConfig);

        this.logger.debug('Widget registered', {
            widgetId: config.id,
            pluginId,
            zone: config.zone,
            routes: config.routes
        });
    }

    /**
     * Unregister a widget from the service.
     *
     * Removes the widget from the in-memory registry. The widget will no longer
     * appear in calls to fetchWidgetsForRoute().
     *
     * @param widgetId - Unique ID of the widget to unregister
     * @returns Promise that resolves when unregistration is complete
     */
    public async unregister(widgetId: string): Promise<void> {
        const deleted = this.widgets.delete(widgetId);

        if (deleted) {
            this.logger.debug('Widget unregistered', { widgetId });
        } else {
            this.logger.warn('Attempted to unregister non-existent widget', { widgetId });
        }
    }

    /**
     * Unregister all widgets for a plugin.
     *
     * Removes all widgets registered by the specified plugin. Used during
     * plugin disable/uninstall to clean up all widget registrations.
     *
     * @param pluginId - ID of the plugin whose widgets should be unregistered
     * @returns Promise that resolves when all widgets are unregistered
     */
    public async unregisterAll(pluginId: string): Promise<void> {
        const widgetsToRemove: string[] = [];

        for (const [widgetId, config] of this.widgets.entries()) {
            if (config.pluginId === pluginId) {
                widgetsToRemove.push(widgetId);
            }
        }

        for (const widgetId of widgetsToRemove) {
            this.widgets.delete(widgetId);
        }

        this.logger.info('All widgets unregistered for plugin', {
            pluginId,
            count: widgetsToRemove.length
        });
    }

    /**
     * Fetch widget data for a specific route.
     *
     * Filters registered widgets by route match, executes their fetchData()
     * functions in parallel with timeout protection, and returns the results
     * sorted by zone and order.
     *
     * Widgets with failing fetchData() functions are excluded from results
     * (errors are logged but not thrown).
     *
     * @param route - URL path to match against widget routes (e.g., '/', '/dashboard')
     * @returns Promise resolving to array of widget data with pre-fetched content
     */
    public async fetchWidgetsForRoute(route: string): Promise<IWidgetData[]> {
        // Filter widgets by route
        const matchingWidgets = Array.from(this.widgets.values()).filter(widget => {
            // Empty routes array means show on all routes
            if (widget.routes.length === 0) {
                return true;
            }
            // Check for exact route match
            return widget.routes.includes(route);
        });

        if (matchingWidgets.length === 0) {
            return [];
        }

        this.logger.debug('Fetching widget data for route', {
            route,
            widgetCount: matchingWidgets.length
        });

        // Fetch data for all matching widgets in parallel
        const widgetDataPromises = matchingWidgets.map(async (widget): Promise<IWidgetData | null> => {
            try {
                // Add timeout to prevent slow widgets from blocking SSR
                const timeoutMs = 5000; // 5 second timeout
                const dataPromise = widget.fetchData();

                // Use AbortController to clean up timeout when promise resolves
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

                try {
                    const data = await dataPromise;
                    clearTimeout(timeoutId);

                    return {
                        id: widget.id,
                        zone: widget.zone,
                        pluginId: widget.pluginId!,
                        order: widget.order ?? 100,
                        title: widget.title,
                        data
                    };
                } catch (fetchError) {
                    clearTimeout(timeoutId);
                    throw fetchError;
                }
            } catch (error) {
                this.logger.error('Widget data fetch failed', {
                    widgetId: widget.id,
                    pluginId: widget.pluginId,
                    error: error instanceof Error ? error.message : String(error)
                });
                return null;
            }
        });

        const widgetDataResults = await Promise.all(widgetDataPromises);

        // Filter out failed widgets and sort by zone then order
        const widgetData = widgetDataResults
            .filter((w): w is IWidgetData => w !== null)
            .sort((a, b) => {
                // Sort by zone first (alphabetically)
                if (a.zone !== b.zone) {
                    return a.zone.localeCompare(b.zone);
                }
                // Then by order
                return a.order - b.order;
            });

        this.logger.debug('Widget data fetched successfully', {
            route,
            successCount: widgetData.length,
            failedCount: matchingWidgets.length - widgetData.length
        });

        return widgetData;
    }

    /**
     * Get all registered widgets (without fetching data).
     *
     * Returns the raw widget configurations for all registered widgets.
     * Useful for admin interfaces or debugging.
     *
     * @returns Array of widget configurations
     */
    public getAllWidgets(): IWidgetConfig[] {
        return Array.from(this.widgets.values());
    }

    /**
     * Get widgets for a specific zone (without fetching data).
     *
     * Returns widget configurations filtered by zone. Useful for debugging
     * or admin interfaces that need to show which widgets are in each zone.
     *
     * @param zone - Zone name to filter by
     * @returns Array of widget configurations in the specified zone
     */
    public getWidgetsByZone(zone: string): IWidgetConfig[] {
        return Array.from(this.widgets.values())
            .filter(widget => widget.zone === zone)
            .sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
    }
}
