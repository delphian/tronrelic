/**
 * @fileoverview The provider seam that decouples ingestion from its data source.
 *
 * The service depends on this interface, never on TronGrid directly, so swapping
 * to an archive node or a paid full-history source later is a provider change,
 * not a service rewrite. TronGrid's fingerprint paging cannot reach the deepest
 * history of million-transaction accounts, so treat the v1 TronGrid provider as
 * a starting point the seam is designed to outgrow.
 */

import type { IBlockTransaction } from '@/types';
import type { AccountTxSource } from '../database/index.js';

/**
 * One page of an account's history plus the cursor to continue.
 *
 * `transactions` are source-independent projections. `nextFingerprint` is the
 * opaque cursor for the following page; its absence means the provider has no
 * more pages to give (end of reachable history).
 */
export interface IAccountHistoryPageResult {
    /** The page's transactions, normalized to the domain contract. */
    transactions: IBlockTransaction[];
    /** Opaque cursor for the next page; undefined when paging is exhausted. */
    nextFingerprint?: string;
}

/**
 * Options for fetching a single page of an account's history.
 */
export interface IAccountHistoryFetchOptions {
    /** Which endpoint to read: `'tx'` (native/TRC10/contract) or `'trc20'` (token transfers). */
    source: AccountTxSource;
    /** Maximum transactions to return in this page (provider clamps to its own ceiling). */
    limit: number;
    /** Opaque cursor from the previous page; omit to start from the newest. */
    fingerprint?: string;
}

/**
 * A source of an account's full transaction history, walked one page at a time.
 */
export interface IAccountHistoryProvider {
    /** Stable identifier for logs and audit (e.g. `'trongrid'`). */
    readonly id: string;

    /**
     * Fetch one page of every transaction type the account participated in.
     *
     * @param address - Base58 account address to read.
     * @param options - Page size and continuation cursor.
     * @returns The page plus the cursor for the next call.
     */
    fetchPage(address: string, options: IAccountHistoryFetchOptions): Promise<IAccountHistoryPageResult>;
}
