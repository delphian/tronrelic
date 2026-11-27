/**
 * @fileoverview Builds the sitemap entries the tools module declares through
 * the `http.sitemapEntries` hook.
 *
 * The tools module owns `/tools` and every tool page, so it declares them
 * itself rather than core listing them in `sitemap.ts`. When a tool page is
 * also served as a CMS page, the sitemap lists that address once, from the CMS
 * entry, which carries a real modification date. When that CMS page has been
 * moved, the tool address only redirects, so it is left out.
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
 * @param pages - The tool pages to declare; only their `url` is read.
 * @param redirectingPaths - Tool addresses a CMS page now holds only in its
 *   redirect history, so the route sends a visitor elsewhere. They are left
 *   out because a sitemap must name the address that serves the page, and the
 *   CMS page is already listed under its current address.
 * @returns One entry for the landing page and one per tool page still served here.
 */
export function buildToolsSitemapEntries(
    categoryPath: string,
    pages: ReadonlyArray<{ url: string }>,
    redirectingPaths: ReadonlySet<string> = new Set()
): ISitemapEntry[] {
    const entries: ISitemapEntry[] = [
        { path: categoryPath, changeFrequency: 'weekly', priority: 0.8 },
        ...pages
            .filter((page) => !redirectingPaths.has(page.url))
            .map((page): ISitemapEntry => ({ path: page.url, changeFrequency: 'weekly', priority: 0.7 }))
    ];
    return entries;
}
