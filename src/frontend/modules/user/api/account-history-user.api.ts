/**
 * @fileoverview Client-side API helpers for the per-wallet account-history
 * detail endpoints.
 *
 * These back the wallet-detail view on the profile Wallets tab. Both are
 * same-origin fetches, so the browser attaches the Better Auth session cookie
 * automatically and the backend enforces ownership of the `:address` before
 * answering — an address the caller has not verified returns 404. Centralising
 * the request shapes here gives the UI one typed surface and keeps components
 * from hand-rolling fetches.
 */

import type { IAccountTransactionPage, IWalletActivitySummary } from '@/types';
import { parseJsonResponse } from './http';

/**
 * Fetch the batched activity summary (heatmap, stats, resources, flow,
 * counterparties) for one wallet the caller owns.
 *
 * @param address - The base58 wallet whose summary to load.
 * @returns The wallet's activity summary.
 */
export async function fetchWalletSummary(address: string): Promise<IWalletActivitySummary> {
    const body = await parseJsonResponse<{ summary: IWalletActivitySummary }>(
        await fetch(`/api/account-history/me/wallets/${encodeURIComponent(address)}/summary`, { cache: 'no-store' })
    );
    return body.summary;
}

/**
 * Fetch a page of the decoded transaction feed for one wallet the caller owns.
 *
 * @param address - The base58 wallet whose history to read.
 * @param limit - Page size (the backend clamps to a sane maximum).
 * @param offset - Row offset for pagination.
 * @returns A page of transactions and the total row count.
 */
export async function fetchWalletTransactions(
    address: string,
    limit: number,
    offset: number
): Promise<IAccountTransactionPage> {
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    const body = await parseJsonResponse<IAccountTransactionPage>(
        await fetch(`/api/account-history/me/wallets/${encodeURIComponent(address)}/transactions?${params.toString()}`, {
            cache: 'no-store'
        })
    );
    return body;
}
