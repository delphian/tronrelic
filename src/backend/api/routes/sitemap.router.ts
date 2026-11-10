/**
 * Sitemap data endpoint for Next.js dynamic sitemap generation.
 *
 * Provides a lightweight, public, unauthenticated endpoint that returns
 * all URLs that should appear in the sitemap. This avoids the frontend
 * needing admin authentication for sitemap generation during SSR.
 *
 * Returns:
 * - Published CMS page slugs with updatedAt timestamps
 * - URLs plugins declare through the `http.sitemapEntries` hook
 *
 * Core never names a plugin URL itself. A plugin's pages are under the
 * plugin's authority, so a plugin that wants a page listed declares it
 * through the hook, and a plugin that declares nothing is left out. Guessing
 * `/{plugin-id}` would put 404s and redirects into the sitemap, because most
 * plugins serve their pages elsewhere.
 *
 * Cached for 10 minutes to avoid repeated database queries from
 * sitemap.xml requests.
 */

import { Router } from 'express';
import type { IHookRegistry, ISitemapEntry } from '@/types';
import { HOOKS } from '../../hooks/registry.js';

/** Cached sitemap data with expiry timestamp. */
interface SitemapCache {
    data: SitemapData;
    expiresAt: number;
}

/** Shape of the sitemap data response. */
interface SitemapData {
    pages: Array<{ slug: string; updatedAt: string }>;
    /**
     * URLs contributed by plugins through the `http.sitemapEntries` hook:
     * each plugin's landing page and any per-resource pages it publishes,
     * such as every blog post.
     */
    pluginEntries: ISitemapEntry[];
}

/** Cache TTL in milliseconds (10 minutes). */
const CACHE_TTL_MS = 10 * 60 * 1000;

/**
 * Lists the CMS pages a visitor can reach, as `{ slug, updatedAt }`. Supplied
 * by the page service, which resolves managed pages through the core content
 * service so a page with only a pending edit, or a deleted page, is left out.
 */
export type SitemapPageLister = () => Promise<Array<{ slug: string; updatedAt: string }>>;

/**
 * Create sitemap data router.
 *
 * Provides a single GET endpoint returning all dynamic URLs for sitemap
 * generation. Response is cached in memory for 10 minutes.
 *
 * @param hookRegistry - Hook registry used to invoke `http.sitemapEntries`,
 *   which is the only way plugin URLs reach the sitemap.
 * @param listPages - Lists the reachable CMS pages; the router does not
 *   query the `pages` collection itself, because page visibility depends on
 *   review state held by the core content service.
 * @returns Express router with sitemap data endpoint
 */
export function sitemapRouter(
    hookRegistry: IHookRegistry,
    listPages: SitemapPageLister
): Router {
    const router = Router();
    let cache: SitemapCache | null = null;

    /**
     * GET /api/sitemap-data
     *
     * Returns all dynamic URLs for sitemap generation.
     * Public endpoint — no authentication required.
     * Response cached for 10 minutes.
     */
    router.get('/', async (_req, res) => {
        try {
            // Return cached data if still fresh
            if (cache && cache.expiresAt > Date.now()) {
                res.json(cache.data);
                return;
            }

            // List core's own pages, then let plugins declare theirs via the
            // hook. The hook seed is an empty array; each handler concatenates
            // its entries, and a throwing handler is isolated by the waterfall
            // invoker so a single misbehaving plugin never blanks the sitemap.
            const pages = await fetchPublishedPages(listPages);

            const pluginEntries = await hookRegistry.invoke(
                HOOKS.http.sitemapEntries,
                { generatedAt: new Date().toISOString() },
                [] as ReadonlyArray<ISitemapEntry>
            );

            // Guard the spread: the waterfall invoker threads a handler's raw
            // return value unchecked (only throws are isolated), so an untyped
            // plugin returning null/undefined/non-array would make `[...]` throw
            // and blank the whole sitemap — the exact failure the isolation above
            // exists to prevent. Coalesce a bad return to an empty list.
            const data: SitemapData = {
                pages,
                pluginEntries: Array.isArray(pluginEntries) ? [...pluginEntries] : []
            };

            // Cache the result
            cache = { data, expiresAt: Date.now() + CACHE_TTL_MS };

            res.json(data);
        } catch (error) {
            console.error('Failed to generate sitemap data:', error);
            res.status(500).json({ error: 'Failed to generate sitemap data' });
        }
    });

    return router;
}

/**
 * Fetch all reachable CMS page slugs with updatedAt timestamps. A failure
 * returns an empty list so one broken source never blanks the whole sitemap.
 *
 * @param listPages - The page service's reachable-page lister.
 * @returns Array of page entries for sitemap
 */
async function fetchPublishedPages(
    listPages: SitemapPageLister
): Promise<Array<{ slug: string; updatedAt: string }>> {
    try {
        return await listPages();
    } catch (error) {
        console.error('Failed to fetch sitemap data:', error);
        return [];
    }
}
