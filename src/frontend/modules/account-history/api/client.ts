/**
 * @fileoverview Admin API client for the account-history module.
 *
 * Thin fetch wrappers over `/api/admin/system/account-history/*`. Same-origin
 * calls carry the Better Auth session cookie automatically, which the backend's
 * `requireAdmin` middleware consults — no token plumbing here. Every function
 * throws on a non-2xx response so callers surface the failure in the UI.
 *
 * The view types redeclare the published DTOs' `Date` fields as ISO strings,
 * because both the REST responses and the `account-history:stats` WebSocket
 * payload arrive as JSON (dates serialized to strings). This mirrors the
 * curation client's view-type convention.
 */

import type { IAccountHistorySettings, AccountIngestionStatus } from '@/types';

/** Base path for every account-history admin endpoint. */
const BASE = '/api/admin/system/account-history';

export type { IAccountHistorySettings, AccountIngestionStatus } from '@/types';

/**
 * A tracked account as serialized over the wire (dates as ISO strings).
 */
export interface ITrackedAccountView {
    address: string;
    label?: string;
    paused: boolean;
    addedAt: string;
    updatedAt: string;
}

/**
 * Per-account ingestion progress as serialized over the wire.
 */
export interface IAccountIngestionProgressView {
    address: string;
    status: AccountIngestionStatus;
    cursorFingerprint?: string;
    oldestTimestampReached?: string;
    newestTimestampSeen?: string;
    rowsIngested: number;
    lastRunAt?: string;
    lastError?: string;
}

/**
 * One stats row: a tracked account paired with its progress.
 */
export interface IAccountHistoryAccountStatsView {
    account: ITrackedAccountView;
    progress: IAccountIngestionProgressView;
}

/**
 * The full stats snapshot powering the admin page and the live WebSocket payload.
 */
export interface IAccountHistoryStatsView {
    settings: IAccountHistorySettings;
    accounts: IAccountHistoryAccountStatsView[];
    totals: {
        trackedAccounts: number;
        rowsIngested: number;
        completeAccounts: number;
        failedAccounts: number;
    };
}

/**
 * One stored transaction as serialized over the wire (timestamp as ISO string).
 */
export interface IAccountTransactionView {
    txId: string;
    blockNumber: number;
    timestamp: string;
    type: string;
    status: string;
    from: { address: string };
    to: { address: string };
    amountSun?: number;
    feeSun?: number;
    contract?: { address: string; method?: string };
    memo?: string | null;
}

/**
 * A page of an account's stored history.
 */
export interface IAccountTransactionPageView {
    transactions: IAccountTransactionView[];
    total: number;
}

/**
 * Parse a fetch response, throwing a descriptive error on a non-2xx status.
 *
 * @param response - The fetch response.
 * @param what - A short verb phrase naming the action, for the error message.
 * @returns The parsed JSON body.
 */
async function parse<T>(response: Response, what: string): Promise<T> {
    if (!response.ok) {
        const body = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
        throw new Error(body.error || `Failed to ${what} (HTTP ${response.status})`);
    }
    return response.json() as Promise<T>;
}

/**
 * Fetch the full stats snapshot (settings, per-account progress, totals).
 *
 * @returns The stats snapshot.
 */
export async function getStats(): Promise<IAccountHistoryStatsView> {
    return parse<IAccountHistoryStatsView>(await fetch(`${BASE}/stats`), 'load account-history stats');
}

/**
 * Add an account to the tracked set.
 *
 * @param address - Base58 TRON address to track.
 * @param label - Optional human label.
 * @returns Resolves when tracked.
 */
export async function addTrackedAccount(address: string, label?: string): Promise<void> {
    await parse(await fetch(`${BASE}/accounts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address, label })
    }), 'add tracked account');
}

/**
 * Stop tracking an account (retains stored history).
 *
 * @param address - Base58 address to remove.
 * @returns Resolves when removed.
 */
export async function removeTrackedAccount(address: string): Promise<void> {
    await parse(await fetch(`${BASE}/accounts/${encodeURIComponent(address)}`, { method: 'DELETE' }), 'remove tracked account');
}

/**
 * Pause or resume one account's backfill.
 *
 * @param address - Base58 address.
 * @param paused - True to pause, false to resume.
 * @returns Resolves when updated.
 */
export async function setAccountPaused(address: string, paused: boolean): Promise<void> {
    await parse(await fetch(`${BASE}/accounts/${encodeURIComponent(address)}/paused`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paused })
    }), 'update account pause state');
}

/**
 * Read current pacing settings.
 *
 * @returns The settings.
 */
export async function getSettings(): Promise<IAccountHistorySettings> {
    return parse<IAccountHistorySettings>(await fetch(`${BASE}/settings`), 'load settings');
}

/**
 * Merge a partial settings update.
 *
 * @param patch - Fields to change.
 * @returns The settings after the merge.
 */
export async function updateSettings(patch: Partial<IAccountHistorySettings>): Promise<IAccountHistorySettings> {
    return parse<IAccountHistorySettings>(await fetch(`${BASE}/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch)
    }), 'update settings');
}

/**
 * Trigger one manual ingestion tick.
 *
 * @returns Resolves when the tick has been requested.
 */
export async function runIngestion(): Promise<void> {
    await parse(await fetch(`${BASE}/ingest/run`, { method: 'POST' }), 'run ingestion');
}

/**
 * Read a page of an account's stored history.
 *
 * @param address - Base58 address.
 * @param limit - Page size.
 * @param offset - Row offset.
 * @returns The page of transactions and the total count.
 */
export async function getTransactions(address: string, limit = 50, offset = 0): Promise<IAccountTransactionPageView> {
    const query = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    return parse<IAccountTransactionPageView>(
        await fetch(`${BASE}/accounts/${encodeURIComponent(address)}/transactions?${query.toString()}`),
        'load account transactions'
    );
}
