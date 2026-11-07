/**
 * @fileoverview Build the request path for the public widgets endpoint.
 *
 * Widget data is fetched from two places: by the server while rendering a
 * page (`fetchWidgetsForRoute`), and by the browser when the core page zones
 * refresh after an in-page navigation (`useRouteWidgets`). The two reach the
 * backend through different base URLs, but must ask for the same thing, so
 * the query is built here once.
 *
 * @module frontend/components/widgets/widgetsRequestPath
 */

import { DEFAULT_LANGUAGE } from '@/types';

/**
 * Build the path and query for `GET /api/widgets`, without the base URL.
 *
 * @param route - The page path to resolve widgets for, with any language prefix removed.
 * @param params - Matched route parameters; omitted from the query when empty.
 * @param language - The page's language, so translated widget content is served in it. English adds nothing.
 * @returns The path to append to a base URL ending in `/api`, such as `/widgets?route=%2Ftools`.
 */
export function widgetsRequestPath(route: string, params: Record<string, string>, language: string | null): string {
    let path = `/widgets?route=${encodeURIComponent(route)}`;
    if (Object.keys(params).length > 0) {
        path += `&params=${encodeURIComponent(JSON.stringify(params))}`;
    }
    if (language && language !== DEFAULT_LANGUAGE) {
        path += `&language=${encodeURIComponent(language)}`;
    }
    return path;
}
