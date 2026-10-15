/**
 * Server wrapper component for plugin pages with widget zone support.
 *
 * This component wraps the client-side PluginPageHandler with server-rendered
 * widget zones, enabling plugins to inject UI components into other plugin pages
 * without any custom plugin code.
 *
 * Widget zones provided:
 * - plugin-content:before - Above the plugin page content
 * - plugin-content:after - Below the plugin page content
 *
 * Plugins target these zones by calling registerWidget on the unified
 * widgets service (`IWidgetsService`, published on the service registry
 * as `'widgets'`). The default placement points the widget at a zone
 * and a route filter; operators can later override either from
 * /system/widgets.
 *
 * Context-aware widgets can access route information through the `route` and
 * `params` props passed to widget components. For plugin pages, the route is
 * the slug and params is an empty object (plugin-internal routing is handled
 * by the plugin itself).
 *
 * @example
 * // In plugin backend init()
 * const widgets = context.services.get<IWidgetsService>('widgets');
 * if (widgets) {
 *     await widgets.registerWidget({
 *         id: 'my-plugin:promo-banner',
 *         label: 'Promo Banner',
 *         description: 'Cross-plugin promo strip.',
 *         defaultZoneId: 'plugin-content:before',
 *         defaultRoutes: ['/other-plugin'],
 *         defaultOrder: 10,
 *         defaultTitle: 'Promo Banner',
 *         defaultDataFetcher: async (route, params) => ({
 *             message: 'Check out my plugin!'
 *         })
 *     }, manifest.id);
 * }
 */

import { WidgetZone, fetchWidgetsForRoute } from './widgets';
import { PluginPageHandler } from './PluginPageHandler';

interface PluginPageWithZonesProps {
    slug: string;
    /**
     * Server-fetched initial data from the plugin's IPageConfig.serverDataFetcher,
     * forwarded to the plugin component via PluginPageHandler. Plugins use this
     * for SSR-rendered body content (e.g., bazi-fortune's day pillar) so the
     * initial HTML contains real data instead of placeholders.
     */
    initialData?: unknown;
}

/**
 * Render a plugin page with widget zones for cross-plugin content injection.
 *
 * Holds no content about any particular plugin. A plugin's page text, its
 * structured data (IPageConfig.structuredData, injected by the catch-all route
 * at src/frontend/app/[lang]/(site)/[...slug]/page.tsx), and any explanatory copy all belong
 * to the plugin itself, so core never has to know what one plugin's page says.
 *
 * @param slug - The URL path for the plugin page (e.g., '/whales', '/memo-tracker')
 * @param initialData - Optional SSR-fetched data forwarded to the plugin component
 */
export async function PluginPageWithZones({ slug, initialData }: PluginPageWithZonesProps) {
    // For plugin pages, the slug is the route and params are empty
    // (plugin-internal param parsing is handled by the plugin's page component)
    const route = slug;
    const params: Record<string, string> = {};

    const { widgets, zones } = await fetchWidgetsForRoute(route, params);

    return (
        <>
            <WidgetZone name="plugin-content:before" widgets={widgets} layout={zones['plugin-content:before']} route={route} params={params} />
            <PluginPageHandler slug={slug} initialData={initialData} />
            <WidgetZone name="plugin-content:after" widgets={widgets} layout={zones['plugin-content:after']} route={route} params={params} />
        </>
    );
}
