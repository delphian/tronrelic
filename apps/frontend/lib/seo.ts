import type { Metadata } from 'next';
import { config } from './config';

export const SITE_NAME = 'TronRelic';

const DEFAULT_SOCIAL_IMAGE = `${config.siteUrl}/images/favicon/ms-icon-310x310.png`;

export function absoluteUrl(path: string = '/'): string {
  if (/^https?:\/\//i.test(path)) {
    return path;
  }

  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${config.siteUrl}${normalizedPath}`;
}

interface BuildMetadataOptions {
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

export function buildMetadata(options: BuildMetadataOptions): Metadata {
  const {
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

  const url = canonical ?? absoluteUrl(path);
  const ogImage = image ?? DEFAULT_SOCIAL_IMAGE;

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

export function buildArticleListStructuredData(articles: ArticleSummary[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    itemListElement: articles.map((article, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: article.title,
      url: absoluteUrl(article.href),
      dateModified: article.updatedAt,
      ...(article.publishedAt ? { datePublished: article.publishedAt } : {})
    }))
  };
}
