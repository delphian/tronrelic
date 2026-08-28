/**
 * @fileoverview Typed fetch helpers for the external-providers admin API.
 *
 * Same-origin admin calls (cookie-authenticated via the /system layout gate), so
 * these are thin wrappers over `fetch` mirroring SystemConfigSection's pattern —
 * no client library, no token handling. No API key is ever received in the clear:
 * GET returns keys masked, TronScan saves send a real key only when the operator
 * types a new one, and TronGrid keys are added and removed one at a time so a
 * masked value never travels back as a write.
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

/**
 * Accepted ranges for the numeric TronGrid fields, mirroring `TRONGRID_LIMITS`
 * on the backend. Duplicated rather than imported because the frontend cannot
 * reach backend modules; the form uses them for input bounds and the backend
 * still enforces them, so a drift between the two costs a rejected save, not a
 * bad write.
 */
export const TRONGRID_FIELD_LIMITS = {
    requestThrottleMs: { min: 0, max: 10_000 },
    maxQueueSize: { min: 1, max: 10_000 },
    requestTimeoutMs: { min: 1_000, max: 120_000 }
} as const;

/**
 * Masked TronGrid config as returned by GET. Keys arrive masked and positional —
 * the index in this array is the handle a removal request sends back.
 */
export interface ITronGridConfigView {
    enabled: boolean;
    /**
     * Whether block sync fetches per-block transaction receipts. The one field on
     * this card that changes runtime behaviour today; the rest are staged for the
     * client switchover.
     */
    fetchBlockReceipts: boolean;
    baseUrl: string;
    /** Masked keys (`****abcd`) in rotation order. */
    apiKeys: string[];
    /** How many keys are stored, for the "keyless" vs "N keys" UI state. */
    apiKeyCount: number;
    requestThrottleMs: number;
    maxQueueSize: number;
    requestTimeoutMs: number;
}

/**
 * Non-secret TronGrid fields an operator can change. Keys are deliberately absent:
 * they are added and removed through their own endpoints so a masked value can
 * never be written back over a real key.
 */
export interface ITronGridConfigUpdate {
    enabled?: boolean;
    fetchBlockReceipts?: boolean;
    baseUrl?: string;
    requestThrottleMs?: number;
    maxQueueSize?: number;
    requestTimeoutMs?: number;
}

/** Result of probing TronGrid with one key from the pool (or keyless). */
export interface ITronGridKeyTestResult {
    /** Rotation position probed, or null when the probe ran keyless. */
    index: number | null;
    maskedKey: string;
    ok: boolean;
    message: string;
    latencyMs?: number;
    blockNumber?: number;
}

/** Aggregate result of a TronGrid connectivity test across the whole key pool. */
export interface ITronGridTestResult {
    ok: boolean;
    message: string;
    blockNumber?: number;
    keyResults: ITronGridKeyTestResult[];
}

const BASE = '/api/admin/system/providers/tronscan';

const TRONGRID_BASE = '/api/admin/system/providers/trongrid';

/**
 * Read a JSON response, raising the server's own error message when it sent one.
 *
 * The TronGrid endpoints answer 400 with a specific reason — duplicate key, pool
 * full, value out of range — and those reasons are what the operator needs to
 * see; a bare status code would strand them.
 *
 * @param response - The fetch response to interpret.
 * @returns The parsed body.
 * @throws Error carrying the server's message, or the status when it sent none.
 */
async function readJsonOrThrow(response: Response): Promise<{ config?: unknown; result?: unknown }> {
    const data = await response.json().catch(() => null);
    if (!response.ok) {
        const message = data && typeof data === 'object' && 'error' in data
            ? String((data as { error: unknown }).error)
            : `Server returned ${response.status}`;
        throw new Error(message);
    }
    if (!data) {
        throw new Error('Server returned an unreadable response.');
    }
    return data as { config?: unknown; result?: unknown };
}

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

/**
 * Read the masked TronGrid provider config.
 *
 * @returns The masked config for the admin form.
 * @throws Error if the request fails.
 */
export async function getTronGridConfig(): Promise<ITronGridConfigView> {
    const data = await readJsonOrThrow(await fetch(TRONGRID_BASE));
    return data.config as ITronGridConfigView;
}

/**
 * Persist a partial change to the non-secret TronGrid fields.
 *
 * @param updates - Fields to change.
 * @returns The updated masked config.
 * @throws Error carrying the server's reason when a value is refused.
 */
export async function updateTronGridConfig(updates: ITronGridConfigUpdate): Promise<ITronGridConfigView> {
    const data = await readJsonOrThrow(
        await fetch(TRONGRID_BASE, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updates)
        })
    );
    return data.config as ITronGridConfigView;
}

/**
 * Append a key to the TronGrid rotation pool.
 *
 * @param apiKey - The raw key the operator pasted.
 * @returns The updated masked config.
 * @throws Error carrying the server's reason (duplicate, pool full, blank).
 */
export async function addTronGridApiKey(apiKey: string): Promise<ITronGridConfigView> {
    const data = await readJsonOrThrow(
        await fetch(`${TRONGRID_BASE}/keys`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ apiKey })
        })
    );
    return data.config as ITronGridConfigView;
}

/**
 * Remove the TronGrid key at a rotation position. Position is the handle because
 * the browser only ever holds masked values.
 *
 * @param index - Zero-based rotation position.
 * @returns The updated masked config.
 * @throws Error if the position no longer exists.
 */
export async function removeTronGridApiKey(index: number): Promise<ITronGridConfigView> {
    const data = await readJsonOrThrow(
        await fetch(`${TRONGRID_BASE}/keys/${index}`, { method: 'DELETE' })
    );
    return data.config as ITronGridConfigView;
}

/**
 * Probe the saved TronGrid config, one call per stored key.
 *
 * @returns The aggregate outcome plus per-key detail (a failed probe resolves, it does not throw).
 * @throws Error only on an unexpected transport/server error.
 */
export async function testTronGrid(): Promise<ITronGridTestResult> {
    const response = await fetch(`${TRONGRID_BASE}/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
    });
    const data = await response.json().catch(() => null);
    if (!data || !data.result) {
        throw new Error(`Provider test failed: ${response.status}`);
    }
    return data.result as ITronGridTestResult;
}
