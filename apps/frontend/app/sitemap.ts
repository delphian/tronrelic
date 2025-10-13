import type { MetadataRoute } from 'next';
import { config } from '../lib/config';

const staticRoutes: Array<{ path: string; priority: number; changeFrequency: MetadataRoute.Sitemap[number]['changeFrequency'] }> = [
  { path: '/', priority: 1, changeFrequency: 'hourly' },
  { path: '/resource-markets', priority: 0.9, changeFrequency: 'hourly' },
  { path: '/forum', priority: 0.8, changeFrequency: 'daily' },
  { path: '/articles', priority: 0.8, changeFrequency: 'daily' },
  { path: '/tools', priority: 0.8, changeFrequency: 'weekly' },
  { path: '/about', priority: 0.6, changeFrequency: 'monthly' }
];

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const baseUrl = config.siteUrl;

  return staticRoutes.map(route => ({
    url: route.path === '/' ? baseUrl : `${baseUrl}${route.path}`,
    lastModified: now,
    changeFrequency: route.changeFrequency,
    priority: route.priority
  }));
}
