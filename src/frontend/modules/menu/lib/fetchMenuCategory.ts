/**
 * @fileoverview Server-side lookup of the menu category served at a URL.
 *
 * The catch-all route asks this to decide whether a URL is a category landing
 * page, and the CMS page breadcrumbs ask it whether a parent address such as
 * `/tools` is a real page worth linking. Keeping one lookup means both agree
 * on which addresses are categories.
 *
 * - `GET /api/menu/resolve?url=...` answers 404 when no container node owns
 *   the URL or the node has no enabled children.
 * - The request carries no cookies, so a category gated by `requiresAdmin` or
 *   `requiresGroups` never resolves here, and the response is safe to cache
 *   across visitors.
 *
 * Server-only: exposed through `modules/menu/server`.
 *
 * @module modules/menu/lib/fetchMenuCategory
 */

import { getServerSideApiUrlWithPath } from '../../../lib/api-url';
import type { IMenuCategory } from '../types/IMenuCategory';

/**
 * Resolve a URL to the menu category served there.
 *
 * A failure of any kind yields null, because callers treat "not a category"
 * and "could not tell" the same way: the catch-all moves on to its 404, and a
 * breadcrumb trail leaves the crumb out rather than link an address that may
 * not exist.
 *
 * @param url - The unprefixed path to resolve, such as `/tools`.
 * @returns The category and its children, or null when the URL is not a category.
 */
export async function fetchMenuCategory(url: string): Promise<IMenuCategory | null> {
    let category: IMenuCategory | null = null;
    try {
        const response = await fetch(
            `${getServerSideApiUrlWithPath()}/menu/resolve?url=${encodeURIComponent(url)}`,
            { next: { revalidate: 60 } }
        );
        if (response.ok) {
            const data = await response.json() as IMenuCategory;
            if (data.success) {
                category = data;
            }
        }
    } catch {
        // Not a category, or the backend could not be reached.
    }

    return category;
}
