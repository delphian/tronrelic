/**
 * Sitemap data endpoint for Next.js dynamic sitemap generation.
 *
 * Provides a lightweight, public, unauthenticated endpoint that returns
 * all URLs that should appear in the sitemap. This avoids the frontend
 * needing admin authentication for sitemap generation during SSR.
 *
 * Returns:
 * - Published CMS page slugs with updatedAt timestamps
 * - Active plugin page paths
 *
 * Cached for 10 minutes to avoid repeated database queries from
 * sitemap.xml requests.
 */

import { Router } from 'express';
import type { IDatabaseService, IHookRegistry, ISitemapEntry } from '@/types';
import { HOOKS } from '../../hooks/registry.js';

/** Cached sitemap data with expiry timestamp. */
interface SitemapCache {
    data: SitemapData;
    expiresAt: number;
}

/** Shape of the sitemap data response. */
interface SitemapData {
    pages: Array<{ slug: string; updatedAt: string }>;
    pluginPages: string[];
    /**
     * Per-resource URLs contributed by plugins through the
     * `http.sitemapEntries` hook (e.g. every published blog post). Distinct
     * from `pluginPages`, which carries only the one landing path per plugin.
     */
    pluginEntries: ISitemapEntry[];
}

/** Cache TTL in milliseconds (10 minutes). */
const CACHE_TTL_MS = 10 * 60 * 1000;

/**
 * Create sitemap data router.
 *
 * Provides a single GET endpoint returning all dynamic URLs for sitemap
 * generation. Response is cached in memory for 10 minutes.
 *
 * @param database - Database service for MongoDB access
 * @param hookRegistry - Hook registry used to invoke `http.sitemapEntries` so
 *   plugins can contribute their own per-resource URLs (blog posts, etc.).
 * @returns Express router with sitemap data endpoint
 */
export function sitemapRouter(database: IDatabaseService, hookRegistry: IHookRegistry): Router {
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

            // Fetch both core data sources in parallel, then let plugins
            // contribute their own per-resource URLs via the hook. The hook
            // seed is an empty array; each handler concatenates its entries,
            // and a throwing handler is isolated by the waterfall invoker so a
            // single misbehaving plugin never blanks the whole sitemap.
            const [pages, pluginPages] = await Promise.all([
                fetchPublishedPages(database),
                fetchPluginPages(database)
            ]);

            const pluginEntries = await hookRegistry.invoke(
                HOOKS.http.sitemapEntries,
                { generatedAt: new Date().toISOString() },
                [] as ReadonlyArray<ISitemapEntry>
            );

            const data: SitemapData = { pages, pluginPages, pluginEntries: [...pluginEntries] };

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
 * Fetch all published CMS page slugs with updatedAt timestamps.
 *
 * @param database - Database service
 * @returns Array of page entries for sitemap
 */
async function fetchPublishedPages(
    database: IDatabaseService
): Promise<Array<{ slug: string; updatedAt: string }>> {
    try {
        const collection = database.getCollection('pages');
        const pages = await collection
            .find(
                { published: true },
                { projection: { slug: 1, updatedAt: 1 } }
            )
            .toArray();

        return pages.map(p => ({
            slug: p.slug as string,
            updatedAt: (p.updatedAt as Date)?.toISOString() ?? new Date().toISOString()
        }));
    } catch (error) {
        console.error('Failed to fetch sitemap data:', error);
        return [];
    }
}

/**
 * Fetch active plugin page paths from plugin metadata.
 *
 * Queries the plugin_metadata collection for installed+enabled plugins
 * and returns their conventional page paths (/{plugin-id}).
 *
 * @param database - Database service
 * @returns Array of plugin page URL paths
 */
async function fetchPluginPages(
    database: IDatabaseService
): Promise<string[]> {
    try {
        const collection = database.getCollection('plugin_metadata');
        const plugins = await collection
            .find(
                { installed: true, enabled: true },
                { projection: { id: 1 } }
            )
            .toArray();

        return plugins
            .map(p => `/${p.id as string}`)
            .filter(path => path.length > 1);
    } catch (error) {
        console.error('Failed to fetch sitemap data:', error);
        return [];
    }
}
