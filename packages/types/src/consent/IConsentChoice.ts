/**
 * @fileoverview A visitor's saved answer to the consent banner.
 */

/**
 * What the `tronrelic_consent` cookie holds. The banner writes it in the
 * browser, and the middleware, the layout, and the backend read it on each
 * request, so the choice applies everywhere without a database lookup.
 */
export interface IConsentChoice {
    /** The `policyVersion` the visitor answered. An older version no longer counts. */
    version: number;

    /** Whether the visitor allowed the first-party analytics cookie. */
    analytics: boolean;

    /** Whether the visitor allowed Google Ads conversion measurement and its cookies. */
    ads: boolean;

    /** When the visitor answered, in whole seconds since the Unix epoch. */
    decidedAt: number;
}
