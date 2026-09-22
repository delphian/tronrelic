/**
 * @fileoverview The contract the price-history service depends on for prices.
 *
 * Why a separate contract from `IPriceHistoryProvider`: a single vendor answers
 * with points or throws, and that is all the vendor-level seam needs to say.
 * The service sits above every vendor and has to know how the whole routing
 * order ended, because "no points" means something different when a vendor
 * was skipped than when every vendor was asked. This contract returns that
 * verdict; the vendor contract stays as it is.
 */

import type { PriceAsset } from '@/types';
import type { IPriceRangeOutcome } from './IPriceRangeOutcome.js';

/**
 * The one price source the service sees: tries the operator's ordered vendors
 * for an asset's class and reports how the attempt ended.
 */
export interface IPriceHistoryRouter {
    /**
     * Fetch a daily series for one asset over an inclusive day range through
     * the routing order, collapsed to one closing point per UTC day, oldest
     * first. The same call serves the recent-window seed, the chunked deep
     * backfill, and the forward append.
     *
     * Never resolves to a bare empty array; the outcome's `verdict` says whether
     * an empty answer is final, inconclusive, or means no vendor could be
     * asked. Throws only on a transport failure (timeout, rate limit, 5xx)
     * so the ingestion tick retries with the cursor untouched.
     *
     * @param asset - The asset to price.
     * @param fromDay - Inclusive start UTC `YYYY-MM-DD`.
     * @param toDay - Inclusive end UTC `YYYY-MM-DD`.
     * @returns The verdict, the winning vendor's points, and which vendors were asked or skipped.
     */
    fetchRange(asset: PriceAsset, fromDay: string, toDay: string): Promise<IPriceRangeOutcome>;

    /**
     * Forget any per-asset state the vendors remember between calls, such as
     * the liquidity pool a DEX vendor chose. Called on an operator reset so the
     * asset is looked at afresh.
     *
     * @param asset - The asset to forget.
     */
    forgetAsset(asset: PriceAsset): void;
}
