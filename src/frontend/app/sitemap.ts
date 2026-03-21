import type { MetadataRoute } from 'next';
import { getServerConfig } from '../lib/serverConfig';
import { getServerSideApiUrlWithPath } from '../lib/api-url';
import { absoluteUrl } from '../lib/seo';

/** Response shape from GET /api/sitemap-data. */
interface SitemapData {
  pages: Array<{ slug: string; updatedAt: string }>;
  pluginPages: string[];
  profiles: string[];
}

/** Static routes that always appear in the sitemap. */
const staticRoutes: Array<{ path: string; priority: number; changeFrequency: MetadataRoute.Sitemap[number]['changeFrequency'] }> = [
  { path: '/', priority: 1, changeFrequency: 'hourly' },
  { path: '/resource-markets', priority: 0.9, changeFrequency: 'hourly' },
  { path: '/forum', priority: 0.8, changeFrequency: 'daily' },
  { path: '/articles', priority: 0.8, changeFrequency: 'daily' },
  { path: '/tools', priority: 0.8, changeFrequency: 'weekly' },
  { path: '/about', priority: 0.6, changeFrequency: 'monthly' }
];

/**
 * Set of static route paths for deduplication.
 * Prevents dynamic pages from duplicating hardcoded entries.
 */
const staticPathSet = new Set(staticRoutes.map(r => r.path));

/**
 * Fetch dynamic sitemap data from the backend.
 *
 * Calls the public /api/sitemap-data endpoint which returns published CMS pages,
 * active plugin pages, and verified user profiles in a single request.
 * Fails gracefully — returns empty data if the backend is unavailable.
 *
 * @returns Dynamic sitemap entries or empty defaults
 */
async function fetchDynamicData(): Promise<SitemapData> {
  try {
    const apiUrl = getServerSideApiUrlWithPath();
    const response = await fetch(`${apiUrl}/sitemap-data`, {
      next: { revalidate: 600 }, // Cache for 10 minutes
      signal: AbortSignal.timeout(5000) // Fall back to static routes if backend stalls
    });

    if (!response.ok) {
      console.warn(`Sitemap data fetch failed: ${response.status}`);
      return { pages: [], pluginPages: [], profiles: [] };
    }

    return await response.json() as SitemapData;
  } catch (error) {
    console.warn('Failed to fetch sitemap data:', error);
    return { pages: [], pluginPages: [], profiles: [] };
  }
}

/**
 * Generates sitemap with both static and dynamic entries.
 *
 * Combines hardcoded core routes with dynamically discovered content:
 * - Published CMS pages (articles, documentation, announcements)
 * - Active plugin pages (resource-markets, whale tracking, etc.)
 * - Verified user profile pages (/u/{address})
 *
 * Dynamic entries are fetched from the backend's /api/sitemap-data endpoint
 * which caches results for 10 minutes. Static entries that overlap with
 * dynamic data are automatically deduplicated.
 *
 * @returns Sitemap array with runtime siteUrl and all discoverable pages
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const [{ siteUrl }, dynamicData] = await Promise.all([
    getServerConfig(),
    fetchDynamicData()
  ]);

  // Track all paths to prevent duplicates across static, CMS, and plugin sources
  const seenPaths = new Set<string>(staticPathSet);

  // Static routes (always present)
  const entries: MetadataRoute.Sitemap = staticRoutes.map(route => ({
    url: absoluteUrl(siteUrl, route.path),
    lastModified: now,
    changeFrequency: route.changeFrequency,
    priority: route.priority
  }));

  // CMS pages (published articles, documentation, etc.)
  for (const page of dynamicData.pages) {
    if (!seenPaths.has(page.slug)) {
      entries.push({
        url: absoluteUrl(siteUrl, page.slug),
        lastModified: page.updatedAt,
        changeFrequency: 'weekly',
        priority: 0.7
      });
      seenPaths.add(page.slug);
    }
  }

  // Plugin pages (active frontend plugins)
  for (const path of dynamicData.pluginPages) {
    if (!seenPaths.has(path)) {
      entries.push({
        url: absoluteUrl(siteUrl, path),
        lastModified: now,
        changeFrequency: 'daily',
        priority: 0.7
      });
      seenPaths.add(path);
    }
  }

  // User profile pages (verified wallet addresses)
  for (const address of dynamicData.profiles) {
    const profilePath = `/u/${address}`;
    if (!seenPaths.has(profilePath)) {
      entries.push({
        url: absoluteUrl(siteUrl, profilePath),
        lastModified: now,
        changeFrequency: 'weekly',
        priority: 0.4
      });
      seenPaths.add(profilePath);
    }
  }

  return entries;
}
