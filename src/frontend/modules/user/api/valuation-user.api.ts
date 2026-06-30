/**
 * @fileoverview Client fetchers for the login-gated portfolio valuation API.
 *
 * Mirrors the account-history user fetchers: relative `/api/...` paths so the
 * browser attaches the session cookie automatically, `cache: 'no-store'` so a
 * portfolio is never stale-cached, and `parseJsonResponse` for uniform error
 * surfacing. These power the Wallets-tab valuation hero (per-wallet zoom and the
 * all-wallets aggregate); they run client-side only, as a secondary surface.
 */

import type { IPortfolioSummary } from '@/types';
import { parseJsonResponse } from './http.js';

/**
 * Fetch the aggregate portfolio across every wallet the caller verified.
 *
 * @returns The aggregate portfolio summary.
 */
export async function fetchAggregatePortfolio(): Promise<IPortfolioSummary> {
    const body = await parseJsonResponse<{ summary: IPortfolioSummary }>(
        await fetch('/api/valuation/me/portfolio', { cache: 'no-store' })
    );
    return body.summary;
}

/**
 * Fetch the portfolio scoped to one wallet the caller owns.
 *
 * @param address - The base58 wallet to value.
 * @returns The single-wallet portfolio summary.
 */
export async function fetchWalletPortfolio(address: string): Promise<IPortfolioSummary> {
    const body = await parseJsonResponse<{ summary: IPortfolioSummary }>(
        await fetch(`/api/valuation/me/wallets/${encodeURIComponent(address)}/portfolio`, { cache: 'no-store' })
    );
    return body.summary;
}
