/**
 * @fileoverview The `utm_medium` value for links posted to social networks and
 * messaging apps.
 *
 * The traffic module's channel classifier files a visit under the Social
 * channel when its `utm_medium` is `social`. Keeping the value in one place
 * lets every plugin that tags an outbound link use the spelling the classifier
 * recognises.
 */

/** `utm_medium` for a link posted to a social network or messaging app. */
export const CAMPAIGN_MEDIUM_SOCIAL = 'social';
