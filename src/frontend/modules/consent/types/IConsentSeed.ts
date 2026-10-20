/**
 * @fileoverview What the root layout resolves about consent for one request.
 *
 * @module modules/consent/types/IConsentSeed
 */

import type { IConsentPublicConfig, IConsentState } from '@/types';

/**
 * The consent settings and this visitor's resolved state, computed on the
 * server from the `cf-ipcountry` header and the `tronrelic_consent` cookie.
 * Passing it into `ConsentProvider` means the banner, the page-view tracker,
 * and the Google Ads tag make the same decision in the server render and the
 * first browser render, so the banner never flashes in or out on hydration.
 */
export interface IConsentSeed {
    /** The consent settings in force. */
    config: IConsentPublicConfig;
    /** What this visitor allows. */
    state: IConsentState;
}
