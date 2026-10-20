/**
 * @fileoverview Decide from a request's country whether the visitor must give
 * consent first.
 */

import { CONSENT_REGION_COUNTRIES } from './CONSENT_REGION_COUNTRIES.js';

/**
 * Whether a visitor from this country falls under the consent rules.
 *
 * An unknown country counts as requiring consent. That covers a missing
 * header (local development, or a request that bypassed Cloudflare) and
 * Cloudflare's own sentinels, `XX` for an address it could not place and `T1`
 * for Tor. Treating those visitors as being in a consent region costs one
 * banner; treating them as being outside it could set cookies on someone in
 * the EU without asking.
 *
 * @param country - The `cf-ipcountry` header value, in any case, or nothing.
 * @returns True when the visitor must be asked before non-essential cookies are set.
 */
export function isConsentRequiredCountry(country: string | null | undefined): boolean {
    const code = typeof country === 'string' ? country.trim().toUpperCase() : '';
    const known = /^[A-Z]{2}$/.test(code) && code !== 'XX' && code !== 'T1';
    return known ? CONSENT_REGION_COUNTRIES.has(code) : true;
}
