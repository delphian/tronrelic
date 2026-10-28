/**
 * @fileoverview The UTM tags read from a landing URL.
 */

/**
 * The five UTM tags a link to the site can carry, as read from the URL a
 * visitor landed on.
 *
 * Every field is optional because a link may carry any subset. AI assistants,
 * for example, tag cited links with `utm_source` alone.
 */
export interface IUtmParams {
    /** `utm_source`, the site or app that sent the visit, such as `chatgpt.com`. */
    source?: string;
    /** `utm_medium`, the kind of channel, such as `social` or `cpc`. */
    medium?: string;
    /** `utm_campaign`, the named campaign the link belongs to. */
    campaign?: string;
    /** `utm_term`, the paid search keyword, when an ad network sets it. */
    term?: string;
    /** `utm_content`, which variant of a link or ad was clicked. */
    content?: string;
}
