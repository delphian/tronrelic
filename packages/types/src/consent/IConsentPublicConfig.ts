/**
 * @fileoverview The consent settings every page render and request needs.
 */

/**
 * What `GET /api/consent/config` serves. The Next.js middleware polls it to
 * decide whether to set the analytics cookie, and the root layout reads it to
 * decide whether to show the consent banner and load the Google Ads tag. It
 * holds nothing secret: a Google Ads id and conversion label are visible in
 * the page source of any site that runs the tag.
 */
export interface IConsentPublicConfig {
    /**
     * Main switch. When false the site behaves as it did before the consent
     * module existed: no banner, the analytics cookie is set for every
     * visitor, and the Google Ads tag is never loaded.
     */
    enabled: boolean;

    /**
     * Version of the consent request. A visitor's saved choice counts only
     * when it was made under this version, so raising it asks everyone in a
     * consent region again, for example after the Privacy Policy changes.
     */
    policyVersion: number;

    /**
     * Google Ads tag id, such as `AW-123456789`. Null keeps the tag unloaded
     * even for visitors who accepted advertising cookies.
     */
    googleAdsId: string | null;

    /**
     * Label of the Google Ads conversion action fired when a visitor follows
     * an affiliate link. Null loads the tag without recording conversions.
     */
    conversionLabel: string | null;
}
