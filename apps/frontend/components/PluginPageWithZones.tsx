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
 * Plugins can target these zones by registering widgets with:
 * - zone: 'plugin-content:before' or 'plugin-content:after'
 * - routes: ['/plugin-path'] to target specific plugin pages
 *
 * Context-aware widgets can access route information through the `route` and
 * `params` props passed to widget components. For plugin pages, the route is
 * the slug and params is an empty object (plugin-internal routing is handled
 * by the plugin itself).
 *
 * @example
 * // In plugin backend init()
 * await context.widgetService.register({
 *     id: 'my-plugin:promo-banner',
 *     zone: 'plugin-content:before',
 *     routes: ['/other-plugin'],
 *     order: 10,
 *     title: 'Promo Banner',
 *     fetchData: async (route, params) => ({ message: 'Check out my plugin!' })
 * }, manifest.id);
 */

import { WidgetZone, fetchWidgetsForRoute } from './widgets';
import { PluginPageHandler } from './PluginPageHandler';

interface PluginPageWithZonesProps {
    slug: string;
}

/**
 * Render a plugin page with widget zones for cross-plugin content injection.
 *
 * @param slug - The URL path for the plugin page (e.g., '/whales', '/memo-tracker')
 */
export async function PluginPageWithZones({ slug }: PluginPageWithZonesProps) {
    // For plugin pages, the slug is the route and params are empty
    // (plugin-internal param parsing is handled by the plugin's page component)
    const route = slug;
    const params: Record<string, string> = {};

    const widgets = await fetchWidgetsForRoute(route, params);

    return (
        <>
            <WidgetZone name="plugin-content:before" widgets={widgets} route={route} params={params} />
            <PluginPageHandler slug={slug} />
            <WidgetZone name="plugin-content:after" widgets={widgets} route={route} params={params} />
        </>
    );
}
