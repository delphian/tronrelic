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
 * Address → human-friendly label map the backend resolves through the
 * optional address-labels service. May be empty (or missing on older
 * backends) — callers always fall back to the truncated raw address.
 */
export type IAddressLabelMap = Record<string, string>;

/**
 * The activity summary plus the labels resolved for its counterparty
 * addresses, so the UI can show entity names instead of raw base58.
 */
export interface IWalletSummaryResult {
    /** The wallet's activity summary. */
    summary: IWalletActivitySummary;
    /** Labels for the summary's counterparty addresses (misses omitted). */
    labels: IAddressLabelMap;
}

/**
 * A transaction page plus labels for the from/to addresses it contains.
 */
export type IWalletTransactionPage = IAccountTransactionPage & {
    /** Labels for addresses appearing in the page (misses omitted). */
    labels?: IAddressLabelMap;
};

/**
 * Fetch the batched activity summary (heatmap, stats, resources, flow,
 * counterparties) for one wallet the caller owns, plus resolved address
 * labels for its counterparties.
 *
 * @param address - The base58 wallet whose summary to load.
 * @returns The wallet's activity summary and counterparty labels.
 */
export async function fetchWalletSummary(address: string): Promise<IWalletSummaryResult> {
    const body = await parseJsonResponse<{ summary: IWalletActivitySummary; labels?: IAddressLabelMap }>(
        await fetch(`/api/account-history/me/wallets/${encodeURIComponent(address)}/summary`, { cache: 'no-store' })
    );
    return { summary: body.summary, labels: body.labels ?? {} };
}

/**
 * Fetch a page of the decoded transaction feed for one wallet the caller owns.
 *
 * @param address - The base58 wallet whose history to read.
 * @param limit - Page size (the backend clamps to a sane maximum).
 * @param offset - Row offset for pagination.
 * @returns A page of transactions, the total row count, and address labels.
 */
export async function fetchWalletTransactions(
    address: string,
    limit: number,
    offset: number
): Promise<IWalletTransactionPage> {
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    const body = await parseJsonResponse<IWalletTransactionPage>(
        await fetch(`/api/account-history/me/wallets/${encodeURIComponent(address)}/transactions?${params.toString()}`, {
            cache: 'no-store'
        })
    );
    return body;
}
