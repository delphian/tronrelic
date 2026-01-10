import type { Metadata } from 'next';

export const SITE_NAME = 'TronRelic';

/**
 * Constructs an absolute URL from a path using the provided site URL.
 *
 * Why siteUrl parameter:
 * Previously used deprecated build-time config which leaked Docker internal hostnames
 * (e.g., "http://backend:3000") into canonical URLs. Now requires explicit siteUrl
 * from runtime config to ensure correct public URLs.
 *
 * @param siteUrl - Public site URL from runtime config (e.g., "https://tronrelic.com")
 * @param path - Relative path or absolute URL
 * @returns Absolute URL
 */
export function absoluteUrl(siteUrl: string, path: string = '/'): string {
  if (/^https?:\/\//i.test(path)) {
    return path;
  }

  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${siteUrl}${normalizedPath}`;
}

interface BuildMetadataOptions {
  /** Public site URL from runtime config (e.g., "https://tronrelic.com") */
  siteUrl: string;
  title: string;
  description: string;
  path?: string;
  image?: string;
  type?: 'website' | 'article';
  publishedTime?: string;
  modifiedTime?: string;
  keywords?: string[];
  canonical?: string;
}

/**
 * Builds Next.js Metadata object with proper canonical URLs and Open Graph tags.
 *
 * Requires siteUrl from runtime config to construct absolute URLs correctly.
 * This prevents Docker internal hostnames from leaking into SEO metadata.
 */
export function buildMetadata(options: BuildMetadataOptions): Metadata {
  const {
    siteUrl,
    title,
    description,
    path = '/',
    image,
    type = 'website',
    publishedTime,
    modifiedTime,
    keywords,
    canonical
  } = options;

  const url = canonical ?? absoluteUrl(siteUrl, path);
  const ogImage = image ?? `${siteUrl}/images/og-image.jpg`;

  return {
    title,
    description,
    alternates: {
      canonical: url
    },
    openGraph: {
      title,
      description,
      type,
      url,
      siteName: SITE_NAME,
      images: [
        {
          url: ogImage,
          width: 1200,
          height: 630,
          alt: title
        }
      ],
      ...(publishedTime ? { publishedTime } : {}),
      ...(modifiedTime ? { modifiedTime } : {})
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [ogImage]
    },
    keywords
  };
}

export interface ArticleSummary {
  title: string;
  href: string;
  updatedAt: string;
  publishedAt?: string;
}

/**
 * Builds structured data for article lists (Schema.org ItemList).
 *
 * @param siteUrl - Public site URL from runtime config
 * @param articles - Array of article summaries
 */
export function buildArticleListStructuredData(siteUrl: string, articles: ArticleSummary[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    itemListElement: articles.map((article, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: article.title,
      url: absoluteUrl(siteUrl, article.href),
      dateModified: article.updatedAt,
      ...(article.publishedAt ? { datePublished: article.publishedAt } : {})
    }))
  };
}
