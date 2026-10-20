/**
 * @fileoverview Store a visitor's consent choice in the browser.
 *
 * The cookie is written here rather than by a backend call so the choice
 * takes effect at once, without waiting on the network. The middleware and
 * the backend read it on the visitor's next request.
 *
 * @module modules/consent/lib/writeConsentCookie
 */

import type { IConsentChoice } from '@/types';
import { CONSENT_COOKIE_MAX_AGE_SECONDS, CONSENT_COOKIE_NAME, serializeConsentCookie } from '@/types';

/**
 * Write the `tronrelic_consent` cookie for the whole site.
 *
 * It lasts twelve months, after which `resolveConsentState` ignores it and the
 * visitor is asked again. `Secure` is added on HTTPS so the cookie is never
 * sent in clear text, and left off on plain-HTTP local development, where a
 * `Secure` cookie would not be stored.
 *
 * @param choice - The visitor's answer.
 */
export function writeConsentCookie(choice: IConsentChoice): void {
    const secure = window.location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `${CONSENT_COOKIE_NAME}=${serializeConsentCookie(choice)}; Path=/; Max-Age=${CONSENT_COOKIE_MAX_AGE_SECONDS}; SameSite=Lax${secure}`;
}
