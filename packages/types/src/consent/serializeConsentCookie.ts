/**
 * @fileoverview Write a consent choice as the `tronrelic_consent` cookie value.
 */

import type { IConsentChoice } from './IConsentChoice.js';

/**
 * Encode a choice as `<version>.<analytics><ads>.<decidedAt>`, for example
 * `3.10.1760000000` for version 3, analytics allowed, ads refused.
 *
 * The format uses only digits and dots, which need no escaping in a cookie
 * value, and it stays short because the browser sends it on every request.
 * `parseConsentCookie` reads the same format back.
 *
 * @param choice - The visitor's answer.
 * @returns The cookie value.
 */
export function serializeConsentCookie(choice: IConsentChoice): string {
    const flags = `${choice.analytics ? 1 : 0}${choice.ads ? 1 : 0}`;
    return `${Math.floor(choice.version)}.${flags}.${Math.floor(choice.decidedAt)}`;
}
