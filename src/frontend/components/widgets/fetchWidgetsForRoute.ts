import type { IZoneLayoutConfig } from '@/types';
import type { WidgetData } from './types';
import { getServerSideApiUrl } from '../../lib/api-url';

/**
 * SSR widget bundle: the resolved widgets for a route plus the effective
 * flexbox layout for every zone, keyed by zone id. The layout map lets a
 * `<WidgetZone>` arrange its widgets as flex items without a second
 * request. Empty objects on fetch failure so callers render an empty,
 * default-laid-out page rather than crashing.
 */
export interface IWidgetBundle {
    widgets: WidgetData[];
    zones: Record<string, IZoneLayoutConfig>;
}

/**
 * Fetch widgets for a specific route during SSR.
 *
 * This function is called from Next.js server components to fetch widget data
 * before rendering the page. It follows the same pattern as fetchActiveThemes()
 * used in the root layout.
 *
 * Uses internal Docker URL (SITE_BACKEND) for container-to-container communication
 * during SSR. The external apiUrl doesn't resolve from inside containers.
 *
 * @param route - URL path to fetch widgets for (e.g., '/', '/tools/energy-estimator')
 * @param params - Optional route parameters (e.g., { slug: 'about-us' })
 * @returns The widget bundle: pre-fetched widgets plus each zone's layout
 *
 * @example
 * ```tsx
 * // In layout.tsx or page.tsx
 * export default async function CoreLayout({ children }) {
 *     const widgets = await fetchWidgetsForRoute('/');
 *
 *     return (
 *         <div>
 *             <WidgetZone name="main-before" widgets={widgets} route="/" params={{}} />
 *             {children}
 *             <WidgetZone name="main-after" widgets={widgets} route="/" params={{}} />
 *         </div>
 *     );
 * }
 *
 * // For dynamic routes with params
 * export default async function PageLayout({ params }) {
 *     // A [...slug] catch-all resolves slug to string[]; params is a Promise in Next.js 15
 *     const { slug } = await params;
 *     const path = slug.join('/');
 *     const route = `/${path}`;
 *     const routeParams = { slug: path };
 *     const widgets = await fetchWidgetsForRoute(route, routeParams);
 *
 *     return (
 *         <div>
 *             <WidgetZone name="main-before" widgets={widgets} route={route} params={routeParams} />
 *             {children}
 *         </div>
 *     );
 * }
 * ```
 */
export async function fetchWidgetsForRoute(
    route: string,
    params: Record<string, string> = {}
): Promise<IWidgetBundle> {
    try {
        const backendUrl = getServerSideApiUrl();
        let url = `${backendUrl}/api/widgets?route=${encodeURIComponent(route)}`;

        // Add params if provided
        if (Object.keys(params).length > 0) {
            url += `&params=${encodeURIComponent(JSON.stringify(params))}`;
        }

        const response = await fetch(url, {
            // Disable Next.js caching - widgets can have dynamic data
            cache: 'no-store',
            signal: AbortSignal.timeout(6000) // 6 second timeout (backend has 5s, add 1s for network)
        });

        if (!response.ok) {
            console.error('Failed to fetch widgets:', response.status);
            return { widgets: [], zones: {} };
        }

        const data = await response.json();
        return {
            widgets: data.widgets || [],
            zones: data.zones || {}
        };
    } catch (error) {
        console.error('Error fetching widgets:', error);
        return { widgets: [], zones: {} };
    }
}
