import type { MetadataRoute } from 'next';
import type { ISitemapEntry } from '@/types';
import { getServerConfig } from '../lib/serverConfig';
import { getServerSideApiUrlWithPath } from '../lib/api-url';
import { absoluteUrl } from '../lib/seo';
import { fetchLocalizationConfig } from '../modules/localization/server';
// Imported from the file rather than the module barrel, which also exports
// components with stylesheets.
import { withLanguageVersions } from '../modules/localization/lib/withLanguageVersions';

/** Response shape from GET /api/sitemap-data. */
interface SitemapData {
  pages: Array<{ slug: string; updatedAt: string }>;
  // Reuse the shared core contract the backend producer serializes into this
  // field (sitemap.router.ts types it `ISitemapEntry[]` from `@/types`), so the
  // response model cannot silently drift from the hook contract.
  pluginEntries?: ISitemapEntry[];
}

/**
 * Core-owned routes that always appear in the sitemap.
 *
 * Only routes core itself serves belong here. A plugin's page, such as
 * `/resource-markets` or `/forum`, is under that plugin's authority, and the
 * plugin declares it through the `http.sitemapEntries` hook. Listing a plugin
 * path here would keep it in the sitemap after the plugin is disabled or
 * moves the page, which is how the sitemap came to list 404s.
 */
const staticRoutes: Array<{ path: string; priority: number; changeFrequency: MetadataRoute.Sitemap[number]['changeFrequency'] }> = [
  { path: '/', priority: 1, changeFrequency: 'hourly' },
  { path: '/articles', priority: 0.8, changeFrequency: 'daily' },
  { path: '/tools', priority: 0.8, changeFrequency: 'weekly' }
];

/**
 * Set of static route paths for deduplication.
 * Prevents dynamic pages from duplicating hardcoded entries.
 */
const staticPathSet = new Set(staticRoutes.map(r => r.path));

/**
 * Fetch dynamic sitemap data from the backend.
 *
 * Calls the public /api/sitemap-data endpoint which returns published CMS pages
 * and the URLs plugins declare through the http.sitemapEntries hook in a
 * single request.
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
      return { pages: [], pluginEntries: [] };
    }

    return await response.json() as SitemapData;
  } catch (error) {
    console.warn('Failed to fetch sitemap data:', error);
    return { pages: [], pluginEntries: [] };
  }
}

/**
 * Generates sitemap with both static and dynamic entries.
 *
 * Combines hardcoded core routes with dynamically discovered content:
 * - Published CMS pages (articles, documentation, announcements)
 * - URLs plugins declare through the http.sitemapEntries hook (landing pages,
 *   blog posts, per-market pages). Core never guesses a plugin URL.
 *
 * Dynamic entries are fetched from the backend's /api/sitemap-data endpoint
 * which caches results for 10 minutes. Static entries that overlap with
 * dynamic data are automatically deduplicated.
 *
 * An entry carries `lastModified` only when its source records a real
 * modification time. Google uses `<lastmod>` only while it is consistently
 * accurate, so stamping undated routes with the generation time would teach
 * it to ignore the real dates on CMS pages and blog posts as well. Undated
 * entries omit the field instead.
 *
 * @returns Sitemap array with runtime siteUrl and all discoverable pages
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [{ siteUrl }, dynamicData, localizationConfig] = await Promise.all([
    getServerConfig(),
    fetchDynamicData(),
    fetchLocalizationConfig()
  ]);

  // Track all paths to prevent duplicates across static, CMS, and plugin sources
  const seenPaths = new Set<string>(staticPathSet);

  // Static routes (always present). Each translated route also gets one entry
  // per published language; see withLanguageVersions.
  const entries: MetadataRoute.Sitemap = staticRoutes.flatMap(route => withLanguageVersions(
    localizationConfig,
    siteUrl,
    route.path,
    {
      url: absoluteUrl(siteUrl, route.path),
      changeFrequency: route.changeFrequency,
      priority: route.priority
    },
    seenPaths
  ));

  // CMS pages (published articles, documentation, etc.)
  for (const page of dynamicData.pages) {
    if (!seenPaths.has(page.slug)) {
      seenPaths.add(page.slug);
      entries.push(...withLanguageVersions(localizationConfig, siteUrl, page.slug, {
        url: absoluteUrl(siteUrl, page.slug),
        lastModified: page.updatedAt,
        changeFrequency: 'weekly',
        priority: 0.7
      }, seenPaths));
    }
  }

  // Plugin-declared URLs — each plugin's landing page and any per-resource
  // pages such as blog posts — gathered by core via the http.sitemapEntries
  // hook. This is the only source of plugin URLs. Each carries its own
  // lastModified/changeFrequency/priority; core absolutizes the root-relative
  // path here, the same way it does for CMS and plugin-landing paths above.
  // Entries cross an HTTP trust boundary from arbitrary plugin code with no
  // runtime validation, so harden here: skip a null/undefined array element
  // (its `entry.path` access would throw inside this un-try/caught loop and
  // blank the whole sitemap), and clamp `priority` to [0.0, 1.0] since Next.js
  // renders an out-of-range value verbatim into invalid sitemap XML.
  for (const entry of dynamicData.pluginEntries ?? []) {
    if (!entry || !entry.path || seenPaths.has(entry.path)) {
      continue;
    }
    seenPaths.add(entry.path);
    entries.push(...withLanguageVersions(localizationConfig, siteUrl, entry.path, {
      url: absoluteUrl(siteUrl, entry.path),
      lastModified: entry.lastModified,
      changeFrequency: entry.changeFrequency ?? 'weekly',
      priority: entry.priority !== undefined ? Math.max(0, Math.min(1, entry.priority)) : 0.7
    }, seenPaths));
  }

  return entries;
}
