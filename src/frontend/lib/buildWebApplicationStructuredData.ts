/**
 * @fileoverview Schema.org `WebApplication` structured data for a tool page.
 *
 * A CMS page built around a required widget, such as the whale tracker or a
 * calculator, is a tool a visitor uses rather than an article they read.
 * Describing it as an `Article` with a publication date misleads search
 * engines about what the page is.
 *
 * - Google shows a software-app rich result only with `aggregateRating` or
 *   `review`, which the site does not have, so this block is for accurate
 *   classification, not for a rich result.
 * - `offers` is left out, because a page's price is not something this code
 *   can know.
 */

import { absoluteUrl } from './seo';
import { buildPublisherReference } from './buildPublisherReference';

/** What a tool page supplies to describe itself. */
export interface IWebApplicationStructuredDataOptions {
    /** Public site URL from runtime config. */
    siteUrl: string;
    /** The page title, used as the application's name. */
    title: string;
    /** The page's search summary; left out of the block when empty. */
    description?: string;
    /** The address this version of the page is served at, language prefix included. */
    path: string;
    /** ISO date of the page's last change. */
    dateModified: string;
    /** The page's social image, as a path or absolute URL. */
    image?: string;
    /** The page's keywords. */
    keywords?: string[];
}

/**
 * Build the `WebApplication` block for a tool page.
 *
 * @param options - The page's title, address, dates, and optional description, image, and keywords.
 * @returns The JSON-LD object to write into the page with `serializeInlineJson`.
 */
export function buildWebApplicationStructuredData(options: IWebApplicationStructuredDataOptions) {
    const { siteUrl, title, description, path, dateModified, image, keywords } = options;

    return {
        '@context': 'https://schema.org',
        '@type': 'WebApplication',
        'name': title,
        ...(description ? { description } : {}),
        'url': absoluteUrl(siteUrl, path),
        'dateModified': dateModified,
        ...(image ? { image: absoluteUrl(siteUrl, image) } : {}),
        ...(keywords?.length ? { keywords: keywords.join(', ') } : {}),
        'publisher': buildPublisherReference(siteUrl)
    };
}
