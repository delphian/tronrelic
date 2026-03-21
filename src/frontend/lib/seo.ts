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

interface BuildArticleStructuredDataOptions {
  /** Public site URL from runtime config */
  siteUrl: string;
  /** Article title */
  title: string;
  /** Article description */
  description?: string;
  /** URL path to the article */
  path: string;
  /** ISO date string when article was first published */
  datePublished: string;
  /** ISO date string when article was last modified */
  dateModified: string;
  /** Open Graph image URL */
  image?: string;
  /** Keywords/tags for the article */
  keywords?: string[];
}

/**
 * Builds Schema.org Article structured data for a single CMS page.
 *
 * Improves search engine understanding of article content, enabling rich
 * results (article cards, knowledge panels) in search listings. Uses
 * the organization defined in the site-wide structured data as publisher.
 *
 * @param options - Article metadata for structured data generation
 * @returns JSON-LD object for injection into page head
 */
export function buildArticleStructuredData(options: BuildArticleStructuredDataOptions) {
  const {
    siteUrl,
    title,
    description,
    path,
    datePublished,
    dateModified,
    image,
    keywords
  } = options;

  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    'headline': title,
    ...(description ? { description } : {}),
    'url': absoluteUrl(siteUrl, path),
    'datePublished': datePublished,
    'dateModified': dateModified,
    ...(image ? { image: absoluteUrl(siteUrl, image) } : {}),
    ...(keywords?.length ? { keywords: keywords.join(', ') } : {}),
    'publisher': {
      '@type': 'Organization',
      '@id': `${siteUrl}/#organization`,
      'name': 'TronRelic',
      'url': siteUrl
    },
    'mainEntityOfPage': {
      '@type': 'WebPage',
      '@id': absoluteUrl(siteUrl, path)
    }
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
