/**
 * @fileoverview Published contract for the portfolio valuation service.
 *
 * Why it exists: the activity surface (account-history) is derived from the
 * transaction ledger alone, but a true portfolio surface — net worth, holdings,
 * allocation, realized/unrealized PnL, and USD balance-over-time — needs three
 * local data layers joined: the ledger (account-history), the daily price series
 * (price-history), and the on-chain balance snapshots (account-history). This
 * service joins them entirely from local storage, never a live fetch.
 *
 * The defining design choice is scope. Cost-basis PnL is inherently *per user*,
 * not per wallet: moving a token between two wallets the same user owns is not a
 * disposal and not an acquisition. So every query carries both the in-scope
 * addresses (the one wallet being zoomed, or the user's whole set) AND the full
 * owned set, used purely to classify a transfer's counterparty as internal
 * (neutral, basis-preserving) or external (a real acquisition/disposal). The
 * same metric set is produced at either scope; only the address filter differs.
 */

import type { PriceAsset } from '../price-history/IPriceHistoryService.js';

/** Whether a summary covers one wallet (zoom) or a user's whole verified set. */
export type PortfolioScope = 'wallet' | 'user';

/**
 * Inputs for a portfolio computation. `addresses` is what to value; `ownedAddresses`
 * is the full set the caller verified, used only to net out transfers between the
 * user's own wallets so they never book a phantom gain.
 */
export interface IPortfolioQuery {
    /**
     * Better Auth id the query is computed for. Used to resolve any per-wallet
     * admin override of the balance-over-time chart window (stored in
     * `'user-settings'` under the `'valuation'` namespace) — never for
     * authorization, which remains the caller's responsibility.
     */
    userId: string;
    /** Addresses in scope for this view (one for a zoom, all for the aggregate). */
    addresses: string[];
    /** The caller's full verified wallet set, for internal-transfer classification. */
    ownedAddresses: string[];
    /** Label describing the scope, surfaced back on the summary. */
    scope: PortfolioScope;
}

/**
 * One asset position in the portfolio. Quantities are human units (decimals
 * applied); `priceUsd` is null when the asset has no local price coverage, in
 * which case it is shown by quantity but excluded from USD totals.
 */
export interface IPortfolioHolding {
    /** The asset — {@link PriceAsset} (`'TRX'` or a TRC20 contract address). */
    asset: PriceAsset;
    /** Display symbol (`TRX` or the token symbol when known, else a short address). */
    symbol: string;
    /** Current quantity held, in human units. */
    quantity: number;
    /** Current USD price, or null when unpriced. */
    priceUsd: number | null;
    /** Current USD value (`quantity * priceUsd`); 0 when unpriced. */
    valueUsd: number;
    /** Remaining FIFO cost basis of the held quantity, in USD. */
    costBasisUsd: number;
    /** Unrealized gain/loss on the held quantity (`valueUsd - costBasisUsd`). */
    unrealizedPnlUsd: number;
}

/** One slice of the allocation breakdown — an asset's share of priced net worth. */
export interface IPortfolioAllocationSlice {
    /** The asset. */
    asset: PriceAsset;
    /** Display symbol. */
    symbol: string;
    /** USD value of the slice. */
    valueUsd: number;
    /** Fraction of total priced value in [0,1]. */
    fraction: number;
}

/** One point of the USD net-worth-over-time series. */
export interface IPortfolioBalancePoint {
    /** UTC `YYYY-MM-DD`. */
    day: string;
    /** Portfolio USD value on that day. */
    valueUsd: number;
}

/**
 * The complete portfolio summary for one scope — the payload the Wallets-tab
 * valuation hero renders. Identical shape whether scoped to one wallet or the
 * whole user, so the frontend reuses one component for both.
 */
export interface IPortfolioSummary {
    /** Scope this summary was computed at. */
    scope: PortfolioScope;
    /** Addresses included in the scope. */
    addresses: string[];
    /** Freshness of the underlying balance snapshot, or null if none captured. */
    capturedAt: Date | null;
    /** Total USD net worth (liquid + staked TRX + priced tokens). */
    netWorthUsd: number;
    /** TRX locked in staking, in sun (informational; included in net worth). */
    stakedTrxSun: number;
    /** TRX in the unstaking queue, in sun (informational; included in net worth). */
    unstakingTrxSun: number;
    /** Per-asset positions, largest USD value first. */
    holdings: IPortfolioHolding[];
    /** Allocation breakdown over priced value, largest first. */
    allocation: IPortfolioAllocationSlice[];
    /** Realized PnL over all history in scope, in USD. */
    realizedPnlUsd: number;
    /** Unrealized PnL on current holdings, in USD. */
    unrealizedPnlUsd: number;
    /** Sum of realized and unrealized PnL, in USD. */
    totalPnlUsd: number;
    /** Daily USD net-worth series (TRX-anchored; see service notes), oldest first. */
    balanceSeriesUsd: IPortfolioBalancePoint[];
    /** Assets held but unpriced locally — shown by quantity, excluded from USD. */
    unpricedAssets: PriceAsset[];
    /**
     * Fraction of holdings (by count) that are priced, in [0,1]; a confidence
     * signal. Value-weighting is impossible because unpriced assets have no
     * known USD value, so the count proxy is the honest available measure.
     */
    pricedValueFraction: number;
    /**
     * False when account-history's ledger backfill has not finished for at least
     * one address in scope (or has not started at all). The balance-over-time
     * series back-solves from today's snapshot, so a delta missing purely
     * because ingestion hasn't reached it yet — not because it didn't happen —
     * still shifts the whole reconstructed curve; callers should caveat the
     * chart rather than presenting it as settled. True when the underlying
     * account-history service is unavailable (nothing to caveat against).
     */
    historyBackfillComplete: boolean;
    /**
     * True when the cost-basis walk hit evidence of missing history: an external
     * disposal (or fee) consumed more quantity than open lots could supply
     * (realized against zero basis), or an internal transfer's migrated basis was
     * never drained by its counterpart leg. Either means PnL and cost basis are
     * approximate — the ledger does not reach far enough back — so callers should
     * label the figures rather than present them as exact. Net worth is
     * unaffected (it comes from the balance snapshot).
     */
    basisApproximate: boolean;
}

/**
 * The portfolio valuation service. Published on the service registry as
 * `'valuation'`; joins account-history, price-history, and identity wallets
 * entirely from local storage.
 */
export interface IValuationService {
    /**
     * Compute the full portfolio summary for a scope. Authorization is the
     * caller's responsibility — the service trusts the addresses it is given, so a
     * user-facing caller must confirm ownership first (the same contract as
     * `IAccountHistoryService.getWalletSummary`).
     *
     * @param query - In-scope addresses, the owned set, and the scope label.
     * @returns The portfolio summary.
     */
    getPortfolio(query: IPortfolioQuery): Promise<IPortfolioSummary>;
}
