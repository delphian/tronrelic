/**
 * @fileoverview The data-source seam the price-history service depends on.
 *
 * Why a seam rather than calling CoinGecko inline: the free-tier two-phase
 * strategy (one ranged call seeds the dense recent window, per-day calls walk the
 * deep past) is a CoinGecko accommodation. A paid key, CoinMarketCap, or an
 * exchange OHLCV dump collapses that into one bulk range call — and that must be
 * a provider swap, not a service rewrite. The service knows only `fetchRange` and
 * `fetchDay`; how an asset maps to a vendor id or contract endpoint lives behind
 * this interface. Kept in the module (not the types package) because it is a
 * source-coupled internal contract, exactly like `IAccountHistoryProvider`.
 */

import type { IPricePoint, PriceAsset } from '@/types';

/**
 * A pluggable historical-price source.
 */
export interface IPriceHistoryProvider {
    /** Stable identifier recorded on rows and in logs (e.g. `'coingecko'`). */
    readonly id: string;

    /**
     * Fetch a contiguous daily series for one asset over an inclusive day range —
     * the cheap bulk path used to seed the dense recent window. Implementations
     * collapse intraday samples to one closing point per UTC day. Returns an empty
     * array (never throws) when the asset is unknown to the source or the range is
     * unavailable, so an unpriced token degrades gracefully rather than failing
     * the tick.
     *
     * @param asset - The asset to price.
     * @param fromDay - Inclusive start UTC `YYYY-MM-DD`.
     * @param toDay - Inclusive end UTC `YYYY-MM-DD`.
     * @returns Daily points in the range, oldest first; empty when unavailable.
     */
    fetchRange(asset: PriceAsset, fromDay: string, toDay: string): Promise<IPricePoint[]>;

    /**
     * Fetch a single UTC day's closing price — the deep-backfill workhorse for
     * dates older than the bulk endpoint can reach. Returns null when the source
     * has no price for that day, which the service reads as "listing reached"
     * (stop walking backward) rather than a transient error. Implementations
     * still throw on genuine transport failures so the service can retry.
     *
     * @param asset - The asset to price.
     * @param day - UTC `YYYY-MM-DD`.
     * @returns The day's point, or null when the source has no price for it.
     */
    fetchDay(asset: PriceAsset, day: string): Promise<IPricePoint | null>;
}
