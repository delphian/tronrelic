/**
 * @fileoverview Server-side read of one menu namespace's tree for the current visitor.
 *
 * The backend filters a menu tree per visitor (`requiresAdmin`,
 * `requiresGroups`), so the request carries the visitor's cookies and the
 * response must never be cached across visitors. Both the root layout, which
 * seeds the main menu widget, and `MenuNavSSR` read menus this way, so the
 * fetch lives here once.
 *
 * Server-only: callers pass the serialised request cookies they read with
 * `next/headers`. Exposed through `modules/menu/server`, not the client barrel.
 *
 * @module modules/menu/lib/fetchMenuNamespace
 */

import type { MenuNodeSerialized } from '@/shared';
import { getServerSideApiUrl } from '../../../lib/api-url';
import type { IMenuSeed } from '../types';

/** Response body of `GET /api/menu`. */
interface IMenuApiResponse {
    tree?: {
        roots?: MenuNodeSerialized[];
        generatedAt?: string;
    };
}

/**
 * Fetch one namespace's tree as the given visitor may see it.
 *
 * Any failure yields an empty tree rather than an error, because a menu
 * outage must never stop a page from rendering. The navigation refills on
 * the next `menu:update` event.
 *
 * @param namespace - The menu namespace to read, such as `main`.
 * @param cookieHeader - The request's serialised cookies, so the backend
 *   filters the tree for this visitor. Empty for an anonymous request.
 * @returns The namespace's root nodes and when the backend produced them.
 */
export async function fetchMenuNamespace(namespace: string, cookieHeader: string): Promise<IMenuSeed> {
    let seed: IMenuSeed = { roots: [], generatedAt: new Date().toISOString() };
    try {
        const response = await fetch(`${getServerSideApiUrl()}/api/menu?namespace=${encodeURIComponent(namespace)}`, {
            // Per-visitor response: caching would show one visitor's menu to another.
            cache: 'no-store',
            headers: cookieHeader ? { Cookie: cookieHeader } : undefined
        });
        if (response.ok) {
            const data = await response.json() as IMenuApiResponse;
            seed = {
                roots: data.tree?.roots ?? [],
                generatedAt: data.tree?.generatedAt ?? seed.generatedAt
            };
        } else {
            console.error('Failed to fetch menu items:', namespace, response.status, response.statusText);
        }
    } catch (error) {
        console.error('Error fetching menu items:', namespace, error);
    }
    return seed;
}
