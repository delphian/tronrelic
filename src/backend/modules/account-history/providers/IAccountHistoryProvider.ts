/**
 * @fileoverview The provider seam that decouples ingestion from its data source.
 *
 * The service depends on this interface, never on TronGrid directly, so swapping
 * to an archive node or a paid full-history source later is a provider change,
 * not a service rewrite. TronGrid's fingerprint paging cannot reach the deepest
 * history of million-transaction accounts, so treat the v1 TronGrid provider as
 * a starting point the seam is designed to outgrow.
 */

import type { IBlockTransaction, IValueTransfer } from '@/types';
import type { AccountTxSource, IAccountSnapshotSample } from '../database/index.js';

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
 * One page of an account's internal (TVM) value transfers plus the cursor to
 * continue. Separate from {@link IAccountHistoryPageResult} because internal
 * transfers are value legs, not transactions: a contract paying TRX to the account
 * appears here and nowhere in the transaction endpoints.
 */
export interface IInternalTransfersPageResult {
    /** The page's value transfers, normalized to the source-independent contract. */
    transfers: IValueTransfer[];
    /** Opaque cursor for the next page; undefined when paging is exhausted. */
    nextFingerprint?: string;
}

/**
 * Options for fetching a single page of an account's internal value transfers.
 * No `source` — there is exactly one internal-transfer feed per account.
 */
export interface IInternalTransfersFetchOptions {
    /** Maximum transfers to return in this page (provider clamps to its own ceiling). */
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

    /**
     * Fetch one page of the account's internal (TVM) value transfers — the TRX and
     * TRC10 moves a contract performs during execution, which the transaction
     * endpoints omit. Each is a source-independent {@link IValueTransfer} keyed by
     * the protocol internal-transaction hash, so a provider swap reproduces the
     * same leg identities. Separate from {@link fetchPage} because these are value
     * legs, not transactions, and carry their own cursor.
     *
     * @param address - Base58 account address to read.
     * @param options - Page size and continuation cursor.
     * @returns The page of value transfers plus the cursor for the next call.
     */
    fetchInternalTransfersPage(address: string, options: IInternalTransfersFetchOptions): Promise<IInternalTransfersPageResult>;

    /**
     * Fetch the token (`token_event`) value legs of a single transaction — the TRC20
     * `Transfer` logs involving the account, each keyed by its protocol `log_index`.
     * Separate from {@link fetchPage} because the transaction endpoints that surface
     * a token transfer omit its log index, so two distinct same-token transfers in
     * one transaction would share an empty leg key and collapse in the ledger; the
     * per-transaction events endpoint is the only source carrying the discriminator.
     * Driven per token-bearing transaction the `trc20` walk discovers.
     *
     * @param account - Base58 tracked account; only legs it participates in are returned.
     * @param txId - Parent transaction hash whose event logs to read.
     * @returns The transaction's account-involving token legs, keyed by log index.
     */
    fetchTokenTransferLegs(account: string, txId: string): Promise<IValueTransfer[]>;

    /**
     * Probe an account's current on-chain state — liquid and staked TRX, the
     * unstaking queue, energy/bandwidth resources, and TRC20 balances — as one
     * normalized sample. This is the point-in-time counterpart to the historical
     * page walk: the snapshot tick calls it on a schedule to anchor the valuation
     * engine's balance series. Kept on the seam (not a direct TronGrid call in the
     * service) for the same source-independence reason as {@link fetchPage}.
     *
     * @param address - Base58 account address to probe.
     * @returns The account's normalized current state.
     */
    fetchAccountSnapshot(address: string): Promise<IAccountSnapshotSample>;
}
