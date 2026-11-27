/**
 * @fileoverview The Schema.org publisher every structured data block names.
 *
 * The root layout declares the site's `Organization` once, with the id
 * `<siteUrl>/#organization`. Each page-level block points at that id rather
 * than describing the organization again, so search engines join them into
 * one entity. Every builder takes the reference from here so the id cannot
 * drift between them.
 */

/**
 * Build the publisher reference for a page-level structured data block.
 *
 * @param siteUrl - Public site URL from runtime config, which the organization's id is built from.
 * @returns The `Organization` reference to set as `publisher`.
 */
export function buildPublisherReference(siteUrl: string) {
    return {
        '@type': 'Organization',
        '@id': `${siteUrl}/#organization`,
        'name': 'TronRelic',
        'url': siteUrl
    };
}
