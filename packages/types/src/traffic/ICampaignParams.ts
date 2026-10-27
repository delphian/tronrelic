/**
 * @fileoverview The UTM tags a link to the site carries so the traffic module
 * can attribute the visit.
 *
 * Why it exists: apps such as Telegram open links without sending a referrer,
 * so a visit from a channel post records as `direct` and the traffic dashboard
 * cannot tell which channel brought it. A link tagged with these values tells
 * the traffic module where the visitor came from even when the browser does
 * not. Each field becomes the matching `utm_*` query parameter.
 */

/** The UTM values to add to an outbound link to the site. */
export interface ICampaignParams {
    /**
     * Where the link was posted, such as `x`, `telegram`, or `reddit`. Becomes
     * `utm_source`, which the traffic dashboard groups campaign visitors by.
     */
    source: string;

    /**
     * The kind of channel, such as `social`. Becomes `utm_medium`. The traffic
     * module's channel classifier reads it, so `social` is what files a tagged
     * visit under the Social channel rather than Direct.
     */
    medium: string;

    /**
     * Which effort the link belongs to, such as `syndication` for posts the
     * platform publishes itself. Becomes `utm_campaign`.
     */
    campaign: string;
}
