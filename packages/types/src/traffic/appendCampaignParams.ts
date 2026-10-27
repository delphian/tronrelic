/**
 * @fileoverview Add UTM tags to a link that points at the site.
 */

import type { ICampaignParams } from './ICampaignParams.js';

/**
 * Add `utm_source`, `utm_medium`, and `utm_campaign` to an absolute URL, so a
 * visit through that link is attributed to the channel it was posted in.
 *
 * Use it only on links that leave the site, such as a link inside a tweet or a
 * share-button target. Never use it on a page's canonical URL, `og:url`, the
 * sitemap, or the feed: search engines would then see the tagged address as a
 * separate page.
 *
 * Existing query parameters and the fragment are kept. A `utm_*` value the URL
 * already carries is replaced, so tagging an already-tagged link cannot produce
 * two conflicting sources. A value that is not an absolute URL, such as a
 * root-relative path or an empty string, is returned unchanged, because there
 * is no address to tag.
 *
 * @param url - The absolute link to tag, such as a post's public address.
 * @param params - Where the link is being posted, which becomes its UTM tags.
 * @returns The tagged link, or the input unchanged when it is not an absolute URL.
 */
export function appendCampaignParams(url: string, params: ICampaignParams): string {
    let tagged = url;
    // `new URL` with no base throws on anything that is not absolute. A try is
    // used rather than `URL.canParse` because this also runs in visitors'
    // browsers, and `canParse` is missing from ones older than 2023.
    try {
        const parsed = new URL(url);
        parsed.searchParams.set('utm_source', params.source);
        parsed.searchParams.set('utm_medium', params.medium);
        parsed.searchParams.set('utm_campaign', params.campaign);
        tagged = parsed.toString();
    } catch {
        tagged = url;
    }
    return tagged;
}
