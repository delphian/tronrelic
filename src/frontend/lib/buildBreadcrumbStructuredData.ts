/**
 * @fileoverview Schema.org `BreadcrumbList` structured data.
 *
 * Breadcrumb markup tells a search engine where a page sits in the site.
 *
 * - Google shows the trail in place of the URL on desktop results; it
 *   stopped showing breadcrumbs on mobile results in January 2025.
 * - Every step except the last needs a URL that is a real page, or Search
 *   Console reports the markup as invalid.
 */

import type { IBreadcrumbItem } from '@/types';

/** Fewest steps worth writing: a trail of one step says nothing the URL does not. */
const MIN_BREADCRUMB_STEPS = 2;

/**
 * Build the `BreadcrumbList` block for a trail.
 *
 * @param items - The trail from the home page to the current page, in order.
 * @returns The JSON-LD object to write into the page, or null when the trail
 *   has fewer than two steps and the block would add nothing.
 */
export function buildBreadcrumbStructuredData(items: IBreadcrumbItem[]) {
    const structuredData = items.length >= MIN_BREADCRUMB_STEPS
        ? {
            '@context': 'https://schema.org',
            '@type': 'BreadcrumbList',
            'itemListElement': items.map((item, index) => ({
                '@type': 'ListItem',
                'position': index + 1,
                'name': item.name,
                'item': item.url
            }))
        }
        : null;

    return structuredData;
}
