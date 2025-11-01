/**
 * Server-side rendering navigation component for database-driven menus.
 *
 * This component fetches menu items from the backend IMenuService during server-side
 * rendering and passes them to the client component for interactive behavior. This
 * ensures menu items are always fresh and managed through the centralized menu system
 * rather than hardcoded in the frontend.
 *
 * The component fetches from the public /api/menu endpoint with namespace filtering
 * to retrieve menu items for a specific namespace (e.g., 'main', 'system', 'footer').
 * No authentication required since menu navigation is public information.
 *
 * When running in Docker, uses the internal Docker network (http://backend:4000)
 * for SSR fetches to avoid SSL certificate validation issues and improve performance.
 *
 * @example
 * ```tsx
 * // Main site navigation
 * <MenuNavSSR namespace="main" />
 *
 * // System monitoring navigation
 * <MenuNavSSR namespace="system" />
 * ```
 */

import { MenuNavClient } from './MenuNavClient';
import { getServerSideApiUrl } from '../../../lib/api-url';

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
 * Props for MenuNavSSR component.
 */
interface IMenuNavSSRProps {
    /**
     * Menu namespace to fetch (e.g., 'main', 'system', 'footer').
     * Determines which menu items are loaded from the database.
     */
    namespace: string;

    /**
     * Optional aria-label for the nav element.
     * Defaults to "{namespace} navigation".
     */
    ariaLabel?: string;
}

/**
 * Server-side navigation component.
 *
 * Fetches menu items from the backend MenuService during SSR and renders them
 * through the client component for interactive behavior. Uses the provided namespace
 * to retrieve only relevant navigation items.
 *
 * The component includes error handling and will render an empty navigation if the
 * API request fails (graceful degradation). No authentication required since the
 * menu endpoint is public.
 *
 * Menu items are fetched fresh on every request (no caching) to ensure navigation
 * always reflects the current menu structure from the database.
 *
 * @param props - Component props
 * @param props.namespace - Menu namespace to load
 * @param props.ariaLabel - Optional accessible label for navigation
 */
export async function MenuNavSSR({ namespace, ariaLabel }: IMenuNavSSRProps) {
    try {
        // Fetch menu items from backend API (public endpoint, no auth required)
        // Use internal Docker network when available (avoids SSL cert issues)
        const apiUrl = getServerSideApiUrl();
        const response = await fetch(`${apiUrl}/api/menu?namespace=${namespace}`, {
            cache: 'no-store' // Always get fresh data
        });

        if (!response.ok) {
            console.error('Failed to fetch menu items:', response.status, response.statusText);
            // Return empty navigation on error (graceful degradation)
            return <MenuNavClient namespace={namespace} items={[]} ariaLabel={ariaLabel} />;
        }

        const data: IMenuApiResponse = await response.json();

        // Convert hierarchical menu nodes to client-side menu items
        // Recursively processes the tree structure to preserve parent-child relationships
        const convertNode = (node: IMenuNode) => ({
            _id: node._id,
            label: node.label,
            url: node.url,
            order: node.order,
            enabled: node.enabled,
            children: node.children ? node.children.map(convertNode) : undefined
        });

        // Use roots to preserve hierarchy (not flat 'all' array)
        const items = data.tree.roots.map(convertNode);

        // Pass hierarchical structure to client component
        return <MenuNavClient namespace={namespace} items={items} ariaLabel={ariaLabel} />;
    } catch (error) {
        console.error('Error fetching menu items:', error);
        // Return empty navigation on error (graceful degradation)
        return <MenuNavClient namespace={namespace} items={[]} ariaLabel={ariaLabel} />;
    }
}
