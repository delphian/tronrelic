/**
 * @fileoverview Read the `tronrelic_consent` cookie value back into a choice.
 */

import type { IConsentChoice } from './IConsentChoice.js';

/** The format `serializeConsentCookie` writes: version, two flags, and a Unix time in seconds. */
const CONSENT_COOKIE_PATTERN = /^(\d{1,6})\.([01])([01])\.(\d{9,11})$/;

/**
 * Parse a consent cookie value.
 *
 * The cookie arrives from the browser, so anything that does not match the
 * expected format exactly is treated as no choice at all. The visitor is then
 * asked again, which is the safe outcome for a damaged or hand-edited cookie.
 *
 * @param value - The raw cookie value, or nothing when the cookie is absent.
 * @returns The choice, or null when there is no usable choice.
 */
export function parseConsentCookie(value: string | null | undefined): IConsentChoice | null {
    const match = typeof value === 'string' ? CONSENT_COOKIE_PATTERN.exec(value.trim()) : null;
    let choice: IConsentChoice | null = null;
    if (match) {
        choice = {
            version: Number(match[1]),
            analytics: match[2] === '1',
            ads: match[3] === '1',
            decidedAt: Number(match[4])
        };
    }
    return choice;
}
