/**
 * @fileoverview Builds the sitemap entries the tools module declares through
 * the `http.sitemapEntries` hook.
 *
 * The tools module owns `/tools` and the tool pages served by routes in code,
 * so it declares them itself rather than core listing them in `sitemap.ts`. A
 * tool whose address belongs to a CMS page is left out: the pages module lists
 * that page once it is published, under whatever address it has, and an
 * address with no page yet answers 404.
 */

import type { ISitemapEntry } from '@/types';

/**
 * Turn the module's tool pages into sitemap entries, with the Tools landing
 * page first.
 *
 * The pages carry no modification time of their own, so the entries omit
 * `lastModified` rather than stamp a made-up date.
 *
 * @param categoryPath - Address of the Tools landing page, which lists every tool.
 * @param pages - The tool pages; `url` is the address and `cmsPage` marks one
 *   a CMS page owns, which is skipped.
 * @returns One entry for the landing page and one per tool page a route serves.
 */
export function buildToolsSitemapEntries(
    categoryPath: string,
    pages: ReadonlyArray<{ url: string; cmsPage?: boolean }>
): ISitemapEntry[] {
    const entries: ISitemapEntry[] = [
        { path: categoryPath, changeFrequency: 'weekly', priority: 0.8 },
        ...pages
            .filter((page) => !page.cmsPage)
            .map((page): ISitemapEntry => ({ path: page.url, changeFrequency: 'weekly', priority: 0.7 }))
    ];
    return entries;
}
