/**
 * Server-side rendering navigation component for database-driven menus.
 *
 * This component fetches menu items from the backend IMenuService during server-side
 * rendering and passes them to the client component for interactive behavior. This
 * ensures menu items are always fresh and managed through the centralized menu system
 * rather than hardcoded in the frontend.
 *
 * The component fetches from the /api/menu endpoint with namespace filtering
 * to retrieve menu items for a specific namespace (e.g., 'main', 'system', 'footer').
 * The visitor's tronrelic_uid cookie is forwarded to the backend so that
 * MenuService.getTreeForUser can apply per-user visibility gating
 * (allowedIdentityStates / requiresGroups / requiresAdmin); without this the
 * SSR pass would always render the anonymous-visible subset and admins would
 * see admin items only after a post-hydration refetch.
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

import { cookies } from 'next/headers';
import type { MenuNodeSerialized, MenuTreeSerialized } from '@/shared';
import { MenuNavClient } from './MenuNavClient';
import { getServerSideApiUrl } from '../../../lib/api-url';

/**
 * API response structure from GET /api/menu.
 *
 * The tree shape mirrors what MenuService emits — the same MenuNodeSerialized
 * the Redux slice stores after WebSocket-driven refetches. Passing this shape
 * straight through to the client keeps SSR and live-update data in one type
 * so seeding Redux from SSR is a no-op cast.
 */
interface IMenuApiResponse {
    success: boolean;
    tree: MenuTreeSerialized;
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
 * API request fails (graceful degradation). The visitor's identity cookie is
 * forwarded so the backend's per-user gating filter resolves req.user; missing
 * or invalid cookies degrade to the anonymous-visible subset.
 *
 * Menu items are fetched fresh on every request (no caching) to ensure navigation
 * always reflects the current menu structure from the database, and because the
 * response is per-user — caching it would cross-contaminate visitors.
 *
 * @param props - Component props
 * @param props.namespace - Menu namespace to load
 * @param props.ariaLabel - Optional accessible label for navigation
 */
export async function MenuNavSSR({ namespace, ariaLabel }: IMenuNavSSRProps) {
    try {
        // Forward all incoming cookies so backend gating sees the real
        // visitor. The identity cookie (tronrelic_uid) is the load-bearing
        // one today, but forwarding the whole header future-proofs the
        // SSR fetch against any new server-side cookie (session affinity,
        // CSRF, signed-identity upgrade) without revisiting this site.
        const cookieStore = await cookies();
        const cookieHeader = cookieStore.toString();

        // Fetch menu items from backend API. Use internal Docker network when
        // available (avoids SSL cert issues). cache: 'no-store' is required
        // because the response is per-user — caching would leak one visitor's
        // tree to another.
        const apiUrl = getServerSideApiUrl();
        const response = await fetch(`${apiUrl}/api/menu?namespace=${encodeURIComponent(namespace)}`, {
            cache: 'no-store',
            headers: cookieHeader ? { Cookie: cookieHeader } : undefined
        });

        if (!response.ok) {
            console.error('Failed to fetch menu items:', response.status, response.statusText);
            return (
                <MenuNavClient
                    namespace={namespace}
                    items={[]}
                    generatedAt={new Date().toISOString()}
                    ariaLabel={ariaLabel}
                />
            );
        }

        const data: IMenuApiResponse = await response.json();
        const roots: MenuNodeSerialized[] = data.tree.roots ?? [];
        const generatedAt = data.tree.generatedAt ?? new Date().toISOString();

        // Pass the raw serialized tree straight through. The client seeds it
        // into Redux on mount so subsequent menu:update refetches replace a
        // known baseline, and Redux becomes the single source of truth for
        // every render after the first paint.
        return (
            <MenuNavClient
                namespace={namespace}
                items={roots}
                generatedAt={generatedAt}
                ariaLabel={ariaLabel}
            />
        );
    } catch (error) {
        console.error('Error fetching menu items:', error);
        return (
            <MenuNavClient
                namespace={namespace}
                items={[]}
                generatedAt={new Date().toISOString()}
                ariaLabel={ariaLabel}
            />
        );
    }
}
