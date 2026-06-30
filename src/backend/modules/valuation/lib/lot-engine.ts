/**
 * @fileoverview Pure cost-basis and balance-reconstruction math.
 *
 * Why pure: this is the only place the platform makes value judgements about
 * money (what a disposal realized, what basis a holding carries, what a wallet
 * was worth on a past day), so it is isolated from all I/O and exhaustively
 * testable. The service feeds it normalized moves and a price lookup; it returns
 * realized PnL and remaining lots with no awareness of ClickHouse, TronGrid, or
 * the registry.
 *
 * The defining rule is internal-transfer neutrality: a move whose counterparty is
 * another wallet the same user owns is not a disposal or an acquisition — basis
 * travels with the asset — so it is skipped for PnL. This is what lets per-wallet
 * and per-user PnL stay coherent and additive (see IValuationService).
 */

/** One normalized value movement of a single asset, from the scope's viewpoint. */
export interface ILedgerMove {
    /** Transaction hash (diagnostic; not used for math). */
    txId: string;
    /** UTC `YYYY-MM-DD` the move settled on — the price-lookup key. */
    day: string;
    /** Epoch ms for chronological ordering. */
    timestamp: number;
    /** Asset moved — `'TRX'` or a TRC20 contract address. */
    asset: string;
    /** Quantity moved in human units, always positive. */
    quantity: number;
    /** `'in'` when the scope received, `'out'` when it sent. */
    direction: 'in' | 'out';
    /** True when the counterparty is another wallet the same user owns. */
    internal: boolean;
}

/** Remaining position for one asset after the FIFO walk. */
export interface IRemainingPosition {
    /** Lot-derived quantity still held, in human units. */
    quantity: number;
    /** USD cost basis of that remaining quantity. */
    costBasisUsd: number;
}

/** Result of the cost-basis walk. */
export interface ILotEngineResult {
    /** Realized gain/loss summed over all external disposals, in USD. */
    realizedPnlUsd: number;
    /** Remaining lots per asset, for unrealized PnL and holding cost basis. */
    remainingByAsset: Map<string, IRemainingPosition>;
}

/** One open FIFO lot: a quantity acquired at a known per-unit USD cost. */
interface IOpenLot {
    quantity: number;
    unitCostUsd: number;
}

/**
 * Walk moves chronologically, opening a lot on each external acquisition and
 * consuming lots FIFO on each external disposal, accumulating realized PnL.
 * Internal transfers are skipped (neutral). A disposal that exceeds available
 * lots (history older than the provider could reach) consumes what exists and
 * realizes the shortfall against zero basis — the known unreachable-history
 * limitation, surfaced rather than crashed.
 *
 * @param moves - All in-scope moves; order-independent on input (sorted here).
 * @param priceOnDay - USD price for an asset on a day, or null when unpriced.
 * @returns Realized PnL and the remaining lots per asset.
 */
export function computeLots(
    moves: ILedgerMove[],
    priceOnDay: (asset: string, day: string) => number | null
): ILotEngineResult {
    const lots = new Map<string, IOpenLot[]>();
    let realizedPnlUsd = 0;

    const ordered = [...moves].sort((a, b) => a.timestamp - b.timestamp);
    for (const move of ordered) {
        if (move.internal || move.quantity <= 0) {
            continue;
        }
        const price = priceOnDay(move.asset, move.day);
        const assetLots = lots.get(move.asset) ?? [];

        if (move.direction === 'in') {
            assetLots.push({ quantity: move.quantity, unitCostUsd: price ?? 0 });
            lots.set(move.asset, assetLots);
            continue;
        }

        // Disposal: consume FIFO, realize proceeds minus consumed basis.
        let remaining = move.quantity;
        let consumedBasis = 0;
        while (remaining > 0 && assetLots.length > 0) {
            const lot = assetLots[0];
            const take = Math.min(remaining, lot.quantity);
            consumedBasis += take * lot.unitCostUsd;
            lot.quantity -= take;
            remaining -= take;
            if (lot.quantity <= 1e-12) {
                assetLots.shift();
            }
        }
        lots.set(move.asset, assetLots);
        if (price !== null) {
            const proceeds = move.quantity * price;
            realizedPnlUsd += proceeds - consumedBasis;
        }
    }

    const remainingByAsset = new Map<string, IRemainingPosition>();
    for (const [asset, assetLots] of lots) {
        let quantity = 0;
        let costBasisUsd = 0;
        for (const lot of assetLots) {
            quantity += lot.quantity;
            costBasisUsd += lot.quantity * lot.unitCostUsd;
        }
        remainingByAsset.set(asset, { quantity, costBasisUsd });
    }
    return { realizedPnlUsd, remainingByAsset };
}

/** A signed TRX delta on a UTC day (positive in, negative out). */
export interface IDailyTrxDelta {
    /** UTC `YYYY-MM-DD`. */
    day: string;
    /** Net TRX change that day, in human units (signed). */
    signedQty: number;
}

/** One reconstructed USD net-worth point. */
export interface IBalanceSeriesPoint {
    /** UTC `YYYY-MM-DD`. */
    day: string;
    /** Portfolio USD value on that day. */
    valueUsd: number;
}

/**
 * Reconstruct a daily TRX balance series anchored to a known absolute balance,
 * then value it in USD per day.
 *
 * Why anchored rather than summed forward from zero: the ledger may not reach an
 * account's genesis, so a forward cumulative sum starts from an unknown offset.
 * Instead we pin the *end* of the series to the snapshot's absolute TRX balance
 * and walk the deltas backward, so the curve is correct at the anchor and only
 * its unreachable tail can drift — the snapshot makes the visible window right.
 *
 * @param anchorDay - The day the absolute balance is known for (snapshot day).
 * @param anchorTrxQty - Absolute TRX balance (liquid + staked + unstaking) at the anchor.
 * @param deltas - Signed daily TRX deltas (all transfers, including internal, since
 *   internal moves still change a single wallet's balance).
 * @param priceForDay - TRX USD price for a day, or null (gap → carry forward).
 * @param windowDays - Trailing days to emit, bounding the series length.
 * @returns Daily USD value points within the window, oldest first.
 */
export function reconstructTrxBalanceSeries(
    anchorDay: string,
    anchorTrxQty: number,
    deltas: IDailyTrxDelta[],
    priceForDay: (day: string) => number | null,
    windowDays: number
): IBalanceSeriesPoint[] {
    const deltaByDay = new Map<string, number>();
    for (const delta of deltas) {
        deltaByDay.set(delta.day, (deltaByDay.get(delta.day) ?? 0) + delta.signedQty);
    }

    // Day range: from the earliest activity (or the window floor) to the anchor.
    const earliestActivity = deltas.reduce<string | null>(
        (min, d) => (!min || d.day < min ? d.day : min),
        null
    );
    const windowFloor = shiftDay(anchorDay, -windowDays);
    const startDay = !earliestActivity || earliestActivity > windowFloor ? earliestActivity ?? windowFloor : windowFloor;

    const days = enumerateDays(startDay, anchorDay);
    if (days.length === 0) {
        return [];
    }

    // Back-solve the starting balance so the forward walk lands on the anchor.
    const totalDelta = days.reduce((sum, day) => sum + (deltaByDay.get(day) ?? 0), 0);
    let balance = anchorTrxQty - totalDelta + (deltaByDay.get(days[0]) ?? 0);

    const points: IBalanceSeriesPoint[] = [];
    let lastPrice = 0;
    const visibleFloor = shiftDay(anchorDay, -windowDays);
    for (let index = 0; index < days.length; index += 1) {
        const day = days[index];
        if (index > 0) {
            balance += deltaByDay.get(day) ?? 0;
        }
        const price = priceForDay(day);
        if (price !== null) {
            lastPrice = price;
        }
        if (day >= visibleFloor) {
            points.push({ day, valueUsd: Math.max(0, balance) * lastPrice });
        }
    }
    return points;
}

/**
 * Shift a `YYYY-MM-DD` day by a signed day count on the UTC boundary.
 *
 * @param day - UTC `YYYY-MM-DD`.
 * @param deltaDays - Days to add (negative to go back).
 * @returns The shifted day.
 */
function shiftDay(day: string, deltaDays: number): string {
    const date = new Date(`${day}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + deltaDays);
    return date.toISOString().slice(0, 10);
}

/**
 * Enumerate inclusive UTC days from `fromDay` to `toDay`. Bounded by the caller's
 * window so the loop cannot run unbounded.
 *
 * @param fromDay - Inclusive start UTC `YYYY-MM-DD`.
 * @param toDay - Inclusive end UTC `YYYY-MM-DD`.
 * @returns The day strings, oldest first (empty when `fromDay > toDay`).
 */
function enumerateDays(fromDay: string, toDay: string): string[] {
    const days: string[] = [];
    let cursor = fromDay;
    let guard = 0;
    while (cursor <= toDay && guard < 4000) {
        days.push(cursor);
        cursor = shiftDay(cursor, 1);
        guard += 1;
    }
    return days;
}
