/**
 * Server-side rendering navigation component for system monitoring pages.
 *
 * This component fetches menu items from the backend IMenuService during server-side
 * rendering and passes them to the client component for interactive behavior. This
 * ensures menu items are always fresh and managed through the centralized menu system
 * rather than hardcoded in the frontend.
 *
 * The component fetches from the public /api/menu endpoint with namespace filtering
 * to retrieve only system-related menu items. No authentication required since menu
 * navigation is public information.
 *
 * When running in Docker, uses the internal Docker network (http://backend:4000)
 * for SSR fetches to avoid SSL certificate validation issues and improve performance.
 *
 * @example
 * ```tsx
 * // In a server component layout
 * import { SystemNavSSR } from '@/features/system';
 *
 * export default function SystemPagesLayout({ children }) {
 *     return (
 *         <div>
 *             <SystemNavSSR />
 *             {children}
 *         </div>
 *     );
 * }
 * ```
 */

import { SystemNavClient } from './SystemNavClient';
import { getServerSideApiUrl } from '../../../../lib/api-url';

/**
 * Menu item structure from backend API response.
 *
 * Matches the IMenuNode structure returned by MenuService.getTree().
 */
interface IMenuNode {
    _id: string;
    namespace: string;
    label: string;
    url: string;
    icon?: string;
    order: number;
    parent: string | null;
    enabled: boolean;
    requiredRole?: string;
    children?: IMenuNode[];
}

/**
 * API response structure from GET /api/menu.
 */
interface IMenuApiResponse {
    success: boolean;
    tree: {
        roots: IMenuNode[];
        all: IMenuNode[];
        generatedAt: string;
    };
}

/**
 * Server-side system navigation component.
 *
 * Fetches menu items from the backend MenuService during SSR and renders them
 * through the client component for interactive behavior. Uses the 'system' namespace
 * to retrieve only system monitoring navigation items.
 *
 * The component includes error handling and will render an empty navigation if the
 * API request fails (graceful degradation). No authentication required since the
 * menu endpoint is public.
 *
 * Menu items are fetched fresh on every request (no caching) to ensure navigation
 * always reflects the current menu structure from the database.
 */
export async function SystemNavSSR() {
    try {
        // Fetch menu items from backend API (public endpoint, no auth required)
        // Use internal Docker network when available (avoids SSL cert issues)
        const apiUrl = getServerSideApiUrl();
        const response = await fetch(`${apiUrl}/api/menu?namespace=system`, {
            cache: 'no-store' // Always get fresh data
        });

        if (!response.ok) {
            console.error('Failed to fetch menu items:', response.status, response.statusText);
            // Return empty navigation on error (graceful degradation)
            return <SystemNavClient items={[]} />;
        }

        const data: IMenuApiResponse = await response.json();

        // Extract flat list of menu items from tree structure
        // The 'all' array contains every node regardless of hierarchy
        const items = data.tree.all.map(node => ({
            _id: node._id,
            label: node.label,
            url: node.url,
            order: node.order,
            enabled: node.enabled
        }));

        // Pass to client component for interactive rendering
        return <SystemNavClient items={items} />;
    } catch (error) {
        console.error('Error fetching menu items:', error);
        // Return empty navigation on error (graceful degradation)
        return <SystemNavClient items={[]} />;
    }
}
