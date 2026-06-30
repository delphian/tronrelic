/**
 * @fileoverview Client for the price-history admin REST endpoints.
 *
 * Same-origin calls carry the Better Auth session cookie automatically, which
 * `requireAdmin` on the backend consults — no token header needed. Mirrors the
 * account-history admin client.
 */

import type { IPriceHistoryStats, IPriceHistorySettings, IPriceCoverageDiagnostics } from '@/types';

/** Base path for every price-history admin endpoint. */
const BASE = '/api/admin/system/price-history';

/**
 * Parse a fetch response, throwing a descriptive error on failure.
 *
 * @param response - The fetch response.
 * @param what - Verb phrase for the error message.
 * @returns The parsed JSON body.
 */
async function parse<T>(response: Response, what: string): Promise<T> {
    if (!response.ok) {
        const body = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
        throw new Error(body.error || `Failed to ${what} (HTTP ${response.status})`);
    }
    if (response.status === 204) {
        return undefined as T;
    }
    return response.json() as Promise<T>;
}

/**
 * Load the coverage snapshot (settings + per-asset coverage + totals).
 *
 * @returns The stats snapshot.
 */
export async function getStats(): Promise<IPriceHistoryStats> {
    return parse<IPriceHistoryStats>(await fetch(`${BASE}/stats`), 'load price-history stats');
}

/**
 * Load coverage diagnostics — held tokens joined against the price series.
 *
 * @returns The diagnostics (held/priced counts + unpriced token list).
 */
export async function getDiagnostics(): Promise<IPriceCoverageDiagnostics> {
    return parse<IPriceCoverageDiagnostics>(await fetch(`${BASE}/diagnostics`), 'load coverage diagnostics');
}

/**
 * Load current pacing settings.
 *
 * @returns The settings.
 */
export async function getSettings(): Promise<IPriceHistorySettings> {
    return parse<IPriceHistorySettings>(await fetch(`${BASE}/settings`), 'load settings');
}

/**
 * Merge pacing settings.
 *
 * @param patch - Partial settings.
 * @returns The merged settings.
 */
export async function updateSettings(patch: Partial<IPriceHistorySettings>): Promise<IPriceHistorySettings> {
    return parse<IPriceHistorySettings>(
        await fetch(`${BASE}/settings`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(patch)
        }),
        'update settings'
    );
}

/**
 * Trigger one backward-backfill tick now.
 */
export async function runBackfill(): Promise<void> {
    await parse(await fetch(`${BASE}/backfill/run`, { method: 'POST' }), 'run backfill');
}

/**
 * Trigger one forward-append tick now.
 */
export async function runForward(): Promise<void> {
    await parse(await fetch(`${BASE}/forward/run`, { method: 'POST' }), 'run forward sync');
}
