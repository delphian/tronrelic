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

/**
 * Open Graph locales for language codes that carry no region of their own.
 *
 * `og:locale` must be `language_TERRITORY`, and consumers such as Facebook
 * recognise only codes in that form, so a bare `zh` would be ignored and the
 * page read as the default `en_US`. Codes listed here are the ones the site
 * can serve without a region; `zh` is Simplified Chinese as used in China.
 */
const OPEN_GRAPH_LOCALES: Record<string, string> = {
  en: 'en_US',
  zh: 'zh_CN',
  'zh-hans': 'zh_CN',
  'zh-hant': 'zh_TW'
};

/**
 * Turn a page language into its `og:locale` value.
 *
 * Link-preview tools read `og:locale` to tell which language a shared page is
 * in. A code that already names a region, such as `pt-BR`, converts directly
 * to `pt_BR`. A code with no region is looked up in the table above. Anything
 * else returns `undefined` so the tag is left out, because a value outside the
 * `language_TERRITORY` form is ignored and would only suggest the page is English.
 *
 * @param language - Language the page is rendered in, as a BCP 47 code.
 * @returns The `og:locale` value, or `undefined` when none can be formed.
 */
export function toOpenGraphLocale(language: string): string | undefined {
  const parts = language.split('-');
  // BCP 47 puts the region straight after the language, or after a four-letter
  // script subtag when one is present, so `zh-Hant-HK` and `de-DE-1996` both
  // carry a usable region even though they hold more than two subtags. Only a
  // region can be two letters here: extlang is three, script is four, and a
  // variant is five or more, so no other subtag can be mistaken for one.
  const hasScript = parts.length > 1 && /^[A-Za-z]{4}$/.test(parts[1]);
  const candidate = parts[hasScript ? 2 : 1];
  const region = candidate && /^[A-Za-z]{2}$/.test(candidate) ? candidate : undefined;
  return region
    ? `${parts[0].toLowerCase()}_${region.toUpperCase()}`
    : OPEN_GRAPH_LOCALES[language.toLowerCase()];
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
  const ogLocale = toOpenGraphLocale(language);

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
      ...(ogLocale ? { locale: ogLocale } : {}),
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
