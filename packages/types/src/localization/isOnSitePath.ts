/**
 * @fileoverview Decide whether a link points at a page on this site.
 */

/**
 * Test whether a link is a root-relative path on this site.
 *
 * Localizing a link and navigating to it without a full page load are only
 * safe for this site's own pages, so both need the same answer to "does this
 * link stay here?". A plain leading slash is not enough to say yes:
 * `//host/x` is a protocol-relative link to another site, and browsers read
 * `/\host` the same way. Absolute URLs, fragments such as `#top`, and schemes
 * such as `mailto:` do not start with a slash at all.
 *
 * @param href - The link as written, such as `/markets` or `https://example.com`.
 * @returns True only for a root-relative path that stays on this site.
 */
export function isOnSitePath(href: string): boolean {
    const result = href.startsWith('/') && !href.startsWith('//') && !href.startsWith('/\\');
    return result;
}
