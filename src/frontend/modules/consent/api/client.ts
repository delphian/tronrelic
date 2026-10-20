/**
 * @fileoverview Admin API client for the consent module, used by
 * `/system/consent`.
 *
 * Calls the backend's `/api/admin/system/consent` routes, which sit behind
 * `requireAdmin`. Requests are same-origin and carry the Better Auth session
 * cookie, so no token is handled here.
 *
 * @module modules/consent/api/client
 */

import type { IConsentPageviewStats, IConsentSettings } from '@/types';

const BASE = '/api/admin/system/consent';

/**
 * Unwrap a response or raise its error message.
 *
 * @param response - The fetch response to check.
 * @param what - Verb phrase naming the failed action for the fallback message.
 * @returns The parsed JSON body.
 * @throws Error carrying the backend's message, so the toast shows why a save was refused.
 */
async function parse<T>(response: Response, what: string): Promise<T> {
    if (!response.ok) {
        const body = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
        throw new Error(body.error || `Failed to ${what} (HTTP ${response.status})`);
    }
    return await response.json() as T;
}

/**
 * Send a JSON request to the admin API.
 *
 * @param method - HTTP method.
 * @param path - Path below the module's admin base.
 * @param what - Verb phrase for the error message.
 * @param body - JSON body, if any.
 * @returns The parsed response.
 */
async function send<T>(method: string, path: string, what: string, body?: unknown): Promise<T> {
    const response = await fetch(`${BASE}${path}`, {
        method,
        credentials: 'include',
        headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body)
    });
    return parse<T>(response, what);
}

/**
 * Read the consent settings.
 *
 * @returns The current settings, with defaults for anything never saved.
 */
export async function getConsentSettings(): Promise<IConsentSettings> {
    const body = await send<{ settings: IConsentSettings }>('GET', '/settings', 'load settings');
    return body.settings;
}

/**
 * Change the main switch, the Google Ads id, or the conversion label.
 *
 * @param patch - Fields to change; an empty string clears an id or label.
 * @returns The settings after the change.
 */
export async function updateConsentSettings(
    patch: Partial<{ enabled: boolean; googleAdsId: string | null; conversionLabel: string | null }>
): Promise<IConsentSettings> {
    const body = await send<{ settings: IConsentSettings }>('PATCH', '/settings', 'save settings', patch);
    return body.settings;
}

/**
 * Raise the policy version so visitors in consent regions are asked again.
 *
 * @returns The settings after the change.
 */
export async function renewConsent(): Promise<IConsentSettings> {
    const body = await send<{ settings: IConsentSettings }>('POST', '/settings/renew', 'ask visitors again');
    return body.settings;
}

/**
 * Read the anonymous page view counts.
 *
 * @param days - Window length in whole UTC days.
 * @returns The total and per-day counts.
 */
export async function getConsentPageviewStats(days: number): Promise<IConsentPageviewStats> {
    return send<IConsentPageviewStats>('GET', `/pageviews?days=${encodeURIComponent(String(days))}`, 'load page views');
}
