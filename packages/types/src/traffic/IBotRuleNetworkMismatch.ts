/**
 * @fileoverview The "page load and JavaScript report came from different
 * networks" condition.
 *
 * Why it exists: some crawlers load each page through a residential proxy but
 * send the page's JavaScript analytics report from their own cloud servers. A
 * real visitor's two requests come from the same network seconds apart, so a
 * report whose network or country differs from the same cookie's page load,
 * shortly after it, is a strong sign of automation that does not depend on
 * which networks the crawler happens to use.
 */

/**
 * Compare a `page` event against the same cookie's most recent `bootstrap`
 * event (the server-recorded page load).
 */
export interface IBotRuleNetworkMismatch {
    /**
     * Which value must differ: the network number (`asn`) or the country.
     */
    compare: 'asn' | 'country';

    /**
     * How soon after the page load the report must arrive to be compared, in
     * seconds. A real visitor who moves from Wi-Fi to mobile data minutes later
     * changes networks legitimately, so only a short gap counts.
     */
    withinSeconds: number;
}
