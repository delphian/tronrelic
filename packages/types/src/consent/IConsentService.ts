/**
 * @fileoverview The consent contract other backend modules depend on.
 */

import type { IConsentPublicConfig } from './IConsentPublicConfig.js';
import type { IConsentState } from './IConsentState.js';

/**
 * What a backend module may ask of the consent module. The traffic module
 * receives it at bootstrap so its page-view endpoint can refuse to set the
 * analytics cookie for a visitor who has not allowed it, even when a stale
 * browser bundle still sends the old beacon.
 */
export interface IConsentService {
    /**
     * Read the consent settings currently in force.
     *
     * @returns The same document `GET /api/consent/config` serves.
     */
    getPublicConfig(): Promise<IConsentPublicConfig>;

    /**
     * Resolve what one request may do, from its country and consent cookie.
     *
     * @param country - The request's `cf-ipcountry` header, or nothing when absent.
     * @param cookieValue - The raw `tronrelic_consent` cookie, or nothing when absent.
     * @returns The resolved consent state.
     */
    resolveRequest(country: string | null | undefined, cookieValue: string | null | undefined): Promise<IConsentState>;
}
