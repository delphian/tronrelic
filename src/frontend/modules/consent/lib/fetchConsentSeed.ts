/**
 * @fileoverview Resolve the consent seed for the request being rendered.
 *
 * Server-only: exposed through `modules/consent/server`.
 *
 * @module modules/consent/lib/fetchConsentSeed
 */

import { resolveConsentState } from '@/types';
import type { IConsentSeed } from '../types';
import { fetchConsentConfig } from './fetchConsentConfig';

/**
 * Read the settings and resolve what this visitor allows.
 *
 * The country and cookie are passed in rather than read here, because the
 * root layout already holds the request's headers and cookies and reading
 * them twice would cost nothing but clarity.
 *
 * @param country - The request's `cf-ipcountry` header, or null when absent.
 * @param cookieValue - The `tronrelic_consent` cookie, or undefined when absent.
 * @returns The settings and the resolved state, for `ConsentProvider`.
 */
export async function fetchConsentSeed(country: string | null, cookieValue: string | undefined): Promise<IConsentSeed> {
    const config = await fetchConsentConfig();
    return { config, state: resolveConsentState(config, country, cookieValue) };
}
