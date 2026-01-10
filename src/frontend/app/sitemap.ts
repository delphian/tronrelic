import type { MetadataRoute } from 'next';
import { getServerConfig } from '../lib/serverConfig';

const staticRoutes: Array<{ path: string; priority: number; changeFrequency: MetadataRoute.Sitemap[number]['changeFrequency'] }> = [
  { path: '/', priority: 1, changeFrequency: 'hourly' },
  { path: '/resource-markets', priority: 0.9, changeFrequency: 'hourly' },
  { path: '/forum', priority: 0.8, changeFrequency: 'daily' },
  { path: '/articles', priority: 0.8, changeFrequency: 'daily' },
  { path: '/tools', priority: 0.8, changeFrequency: 'weekly' },
  { path: '/about', priority: 0.6, changeFrequency: 'monthly' }
];

/**
 * Generates sitemap using runtime configuration.
 *
 * Why async:
 * Next.js sitemaps can be generated dynamically at request time. This allows us to use
 * runtime configuration (fetched from backend) instead of build-time environment variables.
 * The siteUrl is cached after the first fetch, so this has zero overhead after initial call.
 *
 * @returns Sitemap array with runtime siteUrl
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const { siteUrl } = await getServerConfig();

  return staticRoutes.map(route => ({
    url: route.path === '/' ? siteUrl : `${siteUrl}${route.path}`,
    lastModified: now,
    changeFrequency: route.changeFrequency,
    priority: route.priority
  }));
}
