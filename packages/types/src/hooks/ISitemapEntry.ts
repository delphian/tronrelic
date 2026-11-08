/**
 * @fileoverview Types for the `http.sitemapEntries` waterfall hook.
 *
 * Core lists only what core owns in the sitemap: its own static routes and
 * published CMS pages. A plugin's URLs are under the plugin's authority, so
 * core never names or guesses them. Instead core invites each plugin to declare
 * its own entries at generation time through this seam: its landing page, plus
 * any per-resource pages it publishes (a blog's posts). A plugin that declares
 * nothing does not appear in the sitemap, and core never learns the plugin's
 * routes or storage schema.
 *
 * @module types/hooks/ISitemapEntry
 */

/**
 * Crawl-frequency hint for a sitemap URL. Mirrors the Next.js
 * `MetadataRoute.Sitemap` `changeFrequency` union so a contributed entry maps
 * straight onto a rendered `<changefreq>` with no translation.
 */
export type SitemapChangeFrequency =
    | 'always'
    | 'hourly'
    | 'daily'
    | 'weekly'
    | 'monthly'
    | 'yearly'
    | 'never';

/**
 * One URL a plugin contributes to the sitemap.
 *
 * `path` is root-relative (e.g. `/blog/my-post`); core absolutizes it against
 * the runtime site origin when rendering `sitemap.xml`, exactly as it does for
 * the CMS-page and plugin-page paths it already emits. A contributor therefore
 * never needs the site URL and never hard-codes a host.
 */
export interface ISitemapEntry {
    /** Root-relative URL path, beginning with `/`. Core absolutizes it. */
    path: string;

    /** ISO 8601 last-modified timestamp for `<lastmod>`; omit when unknown. */
    lastModified?: string;

    /** Crawl-frequency hint for `<changefreq>`; omit to leave it unset. */
    changeFrequency?: SitemapChangeFrequency;

    /** Relative priority 0.0–1.0 for `<priority>`; omit to leave it unset. */
    priority?: number;
}

/**
 * Context handed to handlers of the `http.sitemapEntries` hook.
 *
 * Deliberately minimal — a contributor reads its own storage, not request
 * state. Do not use `generatedAt` as a fallback `lastModified`: an entry whose
 * resource carries no timestamp of its own should omit the field. Google uses
 * `<lastmod>` only while it is consistently accurate, so a generation-time
 * stamp on undated entries undermines the real dates elsewhere in the sitemap.
 */
export interface ISitemapHookContext {
    /** ISO 8601 timestamp of this sitemap generation pass. */
    generatedAt: string;
}
