/**
 * @fileoverview The explanation shown when a site-wide zone refuses a route filter.
 */

/**
 * The message an administrator sees when they try to limit a widget in a
 * site-wide zone (see `zoneAcceptsRouteFilter`) to some pages.
 *
 * One string serves both the admin editor, which shows it as soon as the
 * operator chooses "Only some pages", and the widgets service, which returns
 * it with the 400 response when a request arrives anyway, so the two can
 * never explain the rule differently.
 */
export const SITE_ZONE_ROUTE_FILTER_REASON =
    'Site-wide zones show the same widgets on every page, because this part of the layout stays in place while visitors move between pages. Choose Every page, or use a page zone such as Above main content.';
