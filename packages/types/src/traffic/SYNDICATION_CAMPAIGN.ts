/**
 * @fileoverview The `utm_campaign` value for links the platform posts itself
 * through a content-router publish sink.
 *
 * Every publish sink that links back to the site, such as the X and Telegram
 * sinks, tags the link with this campaign. Sharing one value lets the traffic
 * dashboard's campaigns view total the visitors the platform's own posts bring
 * in, separately from links readers share themselves.
 */

/** `utm_campaign` for a link a publish sink posts on the platform's behalf. */
export const SYNDICATION_CAMPAIGN = 'syndication';
