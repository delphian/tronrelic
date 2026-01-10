/**
 * Standard widget zone names.
 *
 * Defines the available zones where widgets can be injected. These zones
 * are predefined injection points in the application layout.
 */
export const WIDGET_ZONES = {
    MAIN_BEFORE: 'main-before',
    MAIN_AFTER: 'main-after',
    PLUGIN_CONTENT_BEFORE: 'plugin-content:before',
    PLUGIN_CONTENT_AFTER: 'plugin-content:after',
    SIDEBAR_TOP: 'sidebar-top',
    SIDEBAR_BOTTOM: 'sidebar-bottom'
} as const;

/**
 * Widget zone name type derived from WIDGET_ZONES constant.
 */
export type WidgetZone = typeof WIDGET_ZONES[keyof typeof WIDGET_ZONES];

/**
 * Widget configuration for plugin-registered UI components.
 *
 * Defines widgets that plugins can inject into designated zones on existing pages.
 * Each widget specifies its target zone, which routes it should appear on, display
 * order, and an async data fetcher that runs during SSR to provide initial data.
 *
 * This enables plugins to extend core pages (e.g., displaying a Reddit feed widget
 * on the homepage) without modifying core page code or breaking plugin isolation.
 *
 * @example
 * ```typescript
 * // In plugin backend init() hook
 * await context.widgetService.register({
 *     id: 'reddit-feed',
 *     zone: 'main-after',
 *     routes: ['/'],
 *     order: 10,
 *     title: 'Community Buzz',
 *     fetchData: async () => {
 *         return await redditService.getLatestPosts(5);
 *     }
 * });
 * ```
 */
export interface IWidgetConfig {
    /**
     * Unique identifier for the widget.
     *
     * Should be namespaced to the plugin (e.g., 'reddit-sentiment:feed').
     * Used for deduplication and widget management.
     */
    id: string;

    /**
     * Target zone where the widget should render.
     *
     * Standard zones:
     * - 'main-before' - Above core page content (dashboard layout)
     * - 'main-after' - Below core page content (dashboard layout)
     * - 'plugin-content:before' - Above plugin page content (cross-plugin injection)
     * - 'plugin-content:after' - Below plugin page content (cross-plugin injection)
     * - 'sidebar-top' - Top of sidebar (if present)
     * - 'sidebar-bottom' - Bottom of sidebar
     *
     * Use WIDGET_ZONES constant for type-safe zone names.
     */
    zone: WidgetZone;

    /**
     * Array of URL paths where this widget should appear.
     *
     * Supports exact matches:
     * - ['/'] - Only homepage
     * - ['/dashboard'] - Only dashboard page
     * - ['/markets', '/markets/detail'] - Multiple specific routes
     *
     * Use empty array to show on all routes: []
     */
    routes: string[];

    /**
     * Sort order within the zone (lower values render first).
     *
     * Multiple widgets in the same zone are sorted by this value.
     * Default: 100
     */
    order?: number;

    /**
     * Optional display title for the widget.
     *
     * If provided, rendered as a heading above the widget content.
     */
    title?: string;

    /**
     * Optional description for admin interfaces and documentation.
     *
     * Not displayed to end users - used for widget management UIs.
     */
    description?: string;

    /**
     * Async function that fetches data for SSR rendering.
     *
     * Called during server-side rendering to provide initial widget data.
     * The returned data is serialized and passed to the frontend component.
     *
     * Receives route context to enable widgets to fetch data based on the
     * current page. For example, a widget on `/u/[address]` can access
     * the address parameter to fetch profile-specific data.
     *
     * This function should:
     * - Return cached or precomputed data (avoid heavy computation)
     * - Handle errors gracefully (return empty data rather than throwing)
     * - Complete quickly (< 100ms recommended)
     *
     * The data can be any JSON-serializable structure.
     *
     * @param route - Current URL path (e.g., '/u/TXyz123...')
     * @param params - Route parameters extracted from the path (e.g., { address: 'TXyz123...' })
     * @returns Promise resolving to widget data (JSON-serializable)
     *
     * @example
     * ```typescript
     * // Context-aware widget that uses route params
     * fetchData: async (route, params) => {
     *     const address = params.address;
     *     if (address) {
     *         return await getProfileData(address);
     *     }
     *     return { items: [] };
     * }
     *
     * // Simple widget that ignores context
     * fetchData: async () => {
     *     const posts = await database.findOne('reddit_cache', {});
     *     return { posts: posts?.items || [] };
     * }
     * ```
     */
    fetchData: (route: string, params: Record<string, string>) => Promise<unknown>;

    /**
     * Plugin ID (set automatically by widget service).
     *
     * Injected during registration to track widget ownership.
     */
    pluginId?: string;
}
