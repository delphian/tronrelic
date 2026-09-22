/**
 * @fileoverview The `price-history` capability: the data-source seam the
 * price-history service depends on, implemented once per vendor.
 *
 * Why a seam rather than calling a vendor inline: each vendor has its own idea
 * of what an asset is (a coin id, a contract path, a liquidity pool) and its own
 * limits on how far back one call may reach. The service knows only "give me the
 * daily closes for this asset over this day range"; how an asset maps to a
 * vendor endpoint lives behind this interface, so adding or swapping a vendor is
 * a provider swap, not a service rewrite.
 *
 * Kept in the providers module (not the types package) because it is a
 * source-coupled internal contract shared by the vendor registry and the
 * price-history consumer, exactly like `IAccountHistoryProvider`.
 */

import type { IPricePoint, PriceAsset } from '@/types';

/**
 * A price point that also records which vendor produced it, so the row written
 * to ClickHouse carries an honest `source` even when several vendors serve one
 * asset over its lifetime.
 */
export interface ISourcedPricePoint extends IPricePoint {
    /** Vendor id that produced the point. */
    source: string;
    /**
     * Vendor-specific handle the point was read through — a pool address for a
     * DEX vendor, a coin id for an aggregator. Surfaced to the operator so a
     * suspicious price can be traced to what it was actually read from.
     */
    sourceRef?: string;
}

/**
 * A pluggable historical-price source for one vendor.
 */
export interface IPriceHistoryProvider {
    /** Stable vendor id recorded on rows and in logs (matches the registry vendor). */
    readonly id: string;

    /**
     * Whether this vendor can price the asset at all — TRX for an explorer
     * vendor, TRC20 contracts for a DEX vendor. Answered without a network call so
     * the router can skip a vendor cheaply instead of paying for a request that
     * would only return empty.
     *
     * @param asset - The asset to price.
     * @returns True when a fetch for this asset is worth making.
     */
    supportsAsset(asset: PriceAsset): boolean;

    /**
     * Fetch a daily series for one asset over an inclusive day range, collapsed
     * to one closing point per UTC day, oldest first. The same call serves the
     * recent-window seed, the chunked deep backfill, and the forward append.
     *
     * Returns an empty array when the vendor has no prices for the asset in that
     * range — because the asset is unknown to it, because the range predates the
     * asset's listing, or because the range lies beyond what the vendor's plan
     * can reach. All three are stable "nothing here" answers the router falls
     * through on.
     *
     * Throws `ProviderDisabledError` when the operator has the vendor switched
     * off, which the router also treats as "skip this vendor". Throws anything
     * else on a transient transport failure (timeout, rate-limit, 5xx) so the
     * ingestion tick retries rather than recording the asset as unpriceable.
     *
     * @param asset - The asset to price.
     * @param fromDay - Inclusive start UTC `YYYY-MM-DD`.
     * @param toDay - Inclusive end UTC `YYYY-MM-DD`.
     * @returns Daily points in the range, oldest first; empty when the vendor has nothing.
     */
    fetchRange(asset: PriceAsset, fromDay: string, toDay: string): Promise<ISourcedPricePoint[]>;

    /**
     * Forget any per-asset state the vendor remembers between calls, such as
     * the liquidity pool it chose for a token. The service calls this when an
     * operator resets an asset, because a reset means "look at this asset
     * afresh", and a remembered choice would defeat that. Optional: a vendor
     * with no per-asset state need not implement it.
     *
     * @param asset - The asset to forget.
     */
    forgetAsset?(asset: PriceAsset): void;
}
