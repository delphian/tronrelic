import type { WidgetData } from './types';
import { getServerSideApiUrl } from '../../lib/api-url';

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
 * @param route - URL path to fetch widgets for (e.g., '/', '/dashboard')
 * @returns Array of widget data with pre-fetched content
 *
 * @example
 * ```tsx
 * // In layout.tsx or page.tsx
 * export default async function DashboardLayout({ children }) {
 *     const widgets = await fetchWidgetsForRoute('/');
 *
 *     return (
 *         <div>
 *             <WidgetZone name="main-before" widgets={widgets} />
 *             {children}
 *             <WidgetZone name="main-after" widgets={widgets} />
 *         </div>
 *     );
 * }
 * ```
 */
export async function fetchWidgetsForRoute(route: string): Promise<WidgetData[]> {
    try {
        const backendUrl = getServerSideApiUrl();
        const url = `${backendUrl}/api/widgets?route=${encodeURIComponent(route)}`;

        const response = await fetch(url, {
            // Disable Next.js caching - widgets can have dynamic data
            cache: 'no-store',
            signal: AbortSignal.timeout(6000) // 6 second timeout (backend has 5s, add 1s for network)
        });

        if (!response.ok) {
            console.error('Failed to fetch widgets:', response.status);
            return [];
        }

        const data = await response.json();
        return data.widgets || [];
    } catch (error) {
        console.error('Error fetching widgets:', error);
        return [];
    }
}
