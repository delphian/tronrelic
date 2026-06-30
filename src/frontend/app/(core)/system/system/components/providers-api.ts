/**
 * @fileoverview Typed fetch helpers for the external-providers admin API.
 *
 * Same-origin admin calls (cookie-authenticated via the /system layout gate), so
 * these are thin wrappers over `fetch` mirroring SystemConfigSection's pattern —
 * no client library, no token handling. The TronScan API key is never received in
 * the clear: GET returns it masked, and saves send the real key only when the
 * operator types a new one.
 */

/** Price source the TronScan endpoint reports from. */
export type TronScanPriceSource = 'coinmarketcap' | 'coingecko';

/** Masked TronScan config as returned by GET — the key is never sent in the clear. */
export interface ITronScanConfigView {
    /** Masked key (`****abcd`) or empty when none is set. */
    apiKey: string;
    /** Whether a key is stored, for the "configured" UI state. */
    apiKeyConfigured: boolean;
    baseUrl: string;
    priceSource: TronScanPriceSource;
    enabled: boolean;
}

/** Fields an operator can change. `apiKey` omitted = leave as-is. */
export interface ITronScanConfigUpdate {
    apiKey?: string;
    baseUrl?: string;
    priceSource?: TronScanPriceSource;
    enabled?: boolean;
}

/** Structured result of a connectivity/credential test. */
export interface ITronScanTestResult {
    ok: boolean;
    message: string;
    sampleClose?: number;
    latencyMs?: number;
    usingKey?: boolean;
}

/** Sentinel a save sends to explicitly clear a stored key. */
export const CLEAR_SENTINEL = '__clear__';

const BASE = '/api/admin/system/providers/tronscan';

/**
 * Read the masked TronScan provider config.
 *
 * @returns The masked config for the admin form.
 * @throws Error if the request fails.
 */
export async function getTronScanConfig(): Promise<ITronScanConfigView> {
    const response = await fetch(BASE);
    if (!response.ok) {
        throw new Error(`Failed to load provider config: ${response.status}`);
    }
    const data = await response.json();
    return data.config as ITronScanConfigView;
}

/**
 * Persist a partial config change and return the new masked config.
 *
 * @param updates - Fields to change.
 * @returns The updated masked config.
 * @throws Error if the request fails.
 */
export async function updateTronScanConfig(updates: ITronScanConfigUpdate): Promise<ITronScanConfigView> {
    const response = await fetch(BASE, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
    });
    if (!response.ok) {
        const err = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(err.error || `Server returned ${response.status}`);
    }
    const data = await response.json();
    return data.config as ITronScanConfigView;
}

/**
 * Run a live connectivity/credential test against TronScan with the saved config.
 *
 * @returns The structured test result (a failed test resolves, it does not throw).
 * @throws Error only on an unexpected transport/server error.
 */
export async function testTronScan(): Promise<ITronScanTestResult> {
    const response = await fetch(`${BASE}/test`, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
    const data = await response.json().catch(() => null);
    if (!data || !data.result) {
        throw new Error(`Provider test failed: ${response.status}`);
    }
    return data.result as ITronScanTestResult;
}
