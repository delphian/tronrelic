/**
 * @fileoverview What the routing provider reports for one ranged price fetch.
 *
 * Why a verdict and not a bare array: an empty array cannot say whether every
 * vendor that could serve the asset was asked and had nothing (a stable answer
 * the deep walk may read as the asset's listing date) or whether a vendor was
 * skipped because the operator has it switched off (an answer that may change
 * the moment the vendor is switched back on). Treating the second like the
 * first marked assets complete for good and stalled their history until an
 * operator noticed. The verdict lets the service tell the two apart, and the
 * vendor lists let a log entry say exactly who was asked and who was skipped.
 */

import type { ISourcedPricePoint } from '../../providers/index.js';

/**
 * How a ranged fetch ended once every vendor in the routing order had been
 * considered.
 *
 * - `priced` — a vendor returned at least one point; `points` holds them.
 * - `empty` — every vendor that could serve the asset was asked and none had
 *   a price in the range. A stable answer: nothing the operator can switch on
 *   would change it.
 * - `inconclusive` — at least one vendor was skipped because it is disabled,
 *   and every vendor that was asked had nothing. The skipped vendor may hold
 *   the range, so the answer must not be recorded as final.
 * - `unavailable` — no vendor could be asked at all: every candidate is
 *   disabled, or the routing list for the asset's class is empty. Nothing
 *   was learned about the asset.
 */
export type PriceRangeVerdict = 'priced' | 'empty' | 'inconclusive' | 'unavailable';

/**
 * The result of one routed `fetchRange` call.
 */
export interface IPriceRangeOutcome {
    /** How the fetch ended; see {@link PriceRangeVerdict}. */
    verdict: PriceRangeVerdict;
    /** Daily points from the winning vendor, oldest first; empty unless `verdict` is `priced`. */
    points: ISourcedPricePoint[];
    /** Vendor ids that were asked and answered, in the order they were tried. */
    asked: string[];
    /** Vendor ids that were skipped because the operator has them disabled. */
    skipped: string[];
}
