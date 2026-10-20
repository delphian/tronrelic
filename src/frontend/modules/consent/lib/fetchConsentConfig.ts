/**
 * @fileoverview Server-side read of the consent settings.
 *
 * The root layout needs them on every request, so the read uses the Next.js
 * fetch cache with a 60-second window instead of calling the backend each
 * time. That matches the backend's `Cache-Control` and the middleware's
 * refresh interval, so a change on `/system/consent` reaches every part of
 * the frontend within about a minute.
 *
 * Server-only: exposed through `modules/consent/server`.
 *
 * @module modules/consent/lib/fetchConsentConfig
 */

import type { IConsentPublicConfig } from '@/types';
import { getServerSideApiUrl } from '../../../lib/api-url';

/** Seconds the Next.js fetch cache keeps a response. */
const REVALIDATE_SECONDS = 60;

/** How long the read may take before the page renders with the fallback. */
const FETCH_TIMEOUT_MS = 3000;

/**
 * Settings used when the backend cannot be reached: switched on, with a
 * policy version no saved choice can match. Visitors in a consent region are
 * shown the banner and get nothing they have not agreed to, and the Google
 * Ads tag stays unloaded because no id is known. This is the same
 * fail-closed value the middleware starts from, so the two agree during an
 * outage.
 */
export const FAIL_CLOSED_CONSENT_CONFIG: IConsentPublicConfig = {
    enabled: true,
    policyVersion: 0,
    googleAdsId: null,
    conversionLabel: null
};

/**
 * Read the consent settings.
 *
 * @returns The settings, or the fail-closed settings on any failure.
 */
export async function fetchConsentConfig(): Promise<IConsentPublicConfig> {
    let config = FAIL_CLOSED_CONSENT_CONFIG;
    try {
        const response = await fetch(`${getServerSideApiUrl()}/api/consent/config`, {
            next: { revalidate: REVALIDATE_SECONDS },
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
        });
        if (response.ok) {
            const body = await response.json() as Partial<IConsentPublicConfig>;
            config = {
                enabled: body.enabled === true,
                policyVersion: typeof body.policyVersion === 'number' ? body.policyVersion : 0,
                googleAdsId: typeof body.googleAdsId === 'string' ? body.googleAdsId : null,
                conversionLabel: typeof body.conversionLabel === 'string' ? body.conversionLabel : null
            };
        } else {
            console.error('Failed to fetch consent config:', response.status);
        }
    } catch (error) {
        console.error('Error fetching consent config:', error);
    }
    return config;
}
