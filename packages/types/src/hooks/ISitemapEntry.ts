/**
 * @fileoverview Types for the `http.sitemapEntries` waterfall hook.
 *
 * The core sitemap is generated from what core owns — static routes, published
 * CMS pages, and one path per enabled plugin. Plugins that own *many* crawlable
 * resources (a blog's posts, a forum's threads) have no way to surface those
 * per-resource URLs without core reaching into the plugin's private storage,
 * which the plugin-coupling rule forbids. This seam inverts that: core invites
 * each plugin to contribute its own sitemap entries at generation time, so the
 * plugin enumerates its own published content and core never learns its schema.
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
 * state. `generatedAt` is provided as a sensible fallback `lastModified` for an
 * entry whose resource carries no timestamp of its own.
 */
export interface ISitemapHookContext {
    /** ISO 8601 timestamp of this sitemap generation pass. */
    generatedAt: string;
}
