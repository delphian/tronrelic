/**
 * @fileoverview Remove the cookies the Google Ads tag set, after a visitor
 * withdraws advertising consent.
 *
 * @module modules/consent/lib/clearGoogleAdsCookies
 */

/** Name prefixes of the first-party cookies the Google tag sets for Google Ads. */
const GOOGLE_ADS_COOKIE_PREFIXES = ['_gcl_', '_gac_'];

/**
 * Expire every Google Ads cookie the page can see.
 *
 * The Google tag sets its cookies on the widest domain it can, such as
 * `.tronrelic.com`, and a cookie can only be removed with the same domain it
 * was set with. The page does not know which one was used, so each cookie is
 * expired on the host and on every parent domain. The middleware cannot do
 * this, because the tag sets the cookies in the browser after the response.
 */
export function clearGoogleAdsCookies(): void {
    const names = document.cookie
        .split(';')
        .map(entry => entry.split('=')[0].trim())
        .filter(name => GOOGLE_ADS_COOKIE_PREFIXES.some(prefix => name.startsWith(prefix)));
    const labels = window.location.hostname.split('.');
    const domains = [''];
    for (let index = 0; index < labels.length - 1; index += 1) {
        domains.push(`; Domain=.${labels.slice(index).join('.')}`);
    }
    for (const name of names) {
        for (const domain of domains) {
            document.cookie = `${name}=; Path=/; Max-Age=0${domain}`;
        }
    }
}
