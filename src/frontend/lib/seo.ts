import type { Metadata } from 'next';
import { DEFAULT_LANGUAGE, localizePath } from '@/types';

export const SITE_NAME = 'TronRelic';

/** Path of the platform-default social image, served from `public/images/`. */
export const DEFAULT_OG_IMAGE_PATH = '/images/og-image.jpg';

/**
 * True pixel dimensions of {@link DEFAULT_OG_IMAGE_PATH}.
 *
 * Declared as constants rather than inlined so the numbers stay pinned to the
 * asset they describe: crawlers lay a card out from `og:image:width`/`height`
 * before the bytes arrive, so a value that disagrees with the file is worse
 * than no value at all. If the asset is ever re-exported, update these in the
 * same commit.
 */
export const DEFAULT_OG_IMAGE_WIDTH = 1200;
export const DEFAULT_OG_IMAGE_HEIGHT = 630;

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

/**
 * Constructs an absolute URL for a page in a given language.
 *
 * A translated page must name its own address as canonical. If the Chinese
 * version of `/markets` declared `https://site/markets` as canonical, search
 * engines would treat it as a duplicate of the English page and drop it. This
 * inserts the language prefix into same-site URLs and leaves English, and URLs
 * on other hosts, exactly as `absoluteUrl` returns them.
 *
 * @param siteUrl - Public site URL from runtime config
 * @param path - Relative path or absolute URL
 * @param language - Language the page is rendered in; English adds no prefix
 * @returns Absolute URL of that language's version
 */
export function localizedAbsoluteUrl(siteUrl: string, path: string = '/', language: string = DEFAULT_LANGUAGE): string {
  let url = absoluteUrl(siteUrl, path);
  const rest = url.slice(siteUrl.length);
  const isSameSite = url.startsWith(siteUrl) && (rest === '' || rest.startsWith('/') || rest.startsWith('?'));
  if (language !== DEFAULT_LANGUAGE && isSameSite) {
    const queryIndex = rest.indexOf('?');
    const pathname = queryIndex === -1 ? rest : rest.slice(0, queryIndex);
    const query = queryIndex === -1 ? '' : rest.slice(queryIndex);
    url = `${siteUrl}${localizePath(pathname || '/', language)}${query}`;
  }
  return url;
}

interface BuildMetadataOptions {
  /** Public site URL from runtime config (e.g., "https://tronrelic.com") */
  siteUrl: string;
  title: string;
  description: string;
  path?: string;
  image?: string;
  /**
   * True pixel dimensions of {@link image}, when the caller knows them.
   *
   * Supplied together or not at all. Omitting them makes the card carry a bare
   * `og:image` URL, which crawlers resolve by measuring the file — slower to
   * lay out, but always correct. Declaring dimensions the file does not have
   * is the failure this pair exists to prevent, so pass them only for an asset
   * whose size is actually known (a fixed asset, or a resized derivative whose
   * output dimensions were returned by the resizer).
   */
  imageWidth?: number;
  imageHeight?: number;
  type?: 'website' | 'article';
  publishedTime?: string;
  modifiedTime?: string;
  keywords?: string[];
  canonical?: string;
  /**
   * Language the page is rendered in. Non-English pages get their language
   * prefix in the canonical and Open Graph URLs; omitted means English, which
   * keeps every existing call's output unchanged.
   */
  language?: string;
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
    imageWidth,
    imageHeight,
    type = 'website',
    publishedTime,
    modifiedTime,
    keywords,
    canonical,
    language = DEFAULT_LANGUAGE
  } = options;

  // Resolve relative canonical paths (e.g. '/resource-markets') against
  // siteUrl so the rendered <link rel="canonical"> is always absolute, with
  // the language prefix for a translated page. Values that are already
  // absolute pass through, gaining a prefix only when they are on this site.
  const url = localizedAbsoluteUrl(siteUrl, canonical ?? path, language);
  const ogImage = image ?? `${siteUrl}${DEFAULT_OG_IMAGE_PATH}`;

  // Dimensions are emitted only when they are known to match the bytes: the
  // platform default is a fixed asset we measure at build time, and a caller
  // supplying a custom image must supply its size too. Anything else ships the
  // URL alone rather than guessing — a card laid out to advertised dimensions
  // that the image does not have renders wrong or is dropped outright, which
  // is exactly how portrait blog art ended up claiming to be 1200x630.
  const dimensions = image
    ? (imageWidth && imageHeight ? { width: imageWidth, height: imageHeight } : {})
    : { width: DEFAULT_OG_IMAGE_WIDTH, height: DEFAULT_OG_IMAGE_HEIGHT };

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
          ...dimensions,
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
