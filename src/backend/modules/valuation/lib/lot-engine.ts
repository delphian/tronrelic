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
 * The defining rule is internal-transfer basis migration: a move whose
 * counterparty is another wallet the same user owns is not a disposal or an
 * acquisition — basis travels with the asset — so instead of being skipped, the
 * consumed lots are *moved* from the source wallet's sub-book into the
 * destination wallet's sub-book (matched by `txId`). Lots are kept per wallet
 * (segregated FIFO), so a sale draws on the *selling* wallet's own basis, never a
 * global pool. This is what lets per-wallet and per-user PnL stay coherent and
 * additive: the per-user figures are exactly the sum of the per-wallet figures
 * (an internal transfer nets out because the basis it removes from one sub-book
 * it adds to another). See IValuationService.
 */

/** One normalized value movement of a single asset, from the scope's viewpoint. */
export interface ILedgerMove {
    /** Transaction hash — the key that pairs an internal-out with its internal-in. */
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
    /** The owned wallet this move belongs to — the sub-book its lots are kept under. */
    wallet: string;
    /**
     * True for a burned network fee. A fee consumes lots like a disposal but has
     * no proceeds — the TRX is destroyed, not sold — so the engine realizes the
     * consumed basis as a pure loss instead of booking a phantom market-price
     * sale. This is how fees enter PnL ("fees in cost basis").
     */
    fee?: boolean;
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
    /** Realized gain/loss summed over every wallet's external disposals, in USD. */
    realizedPnlUsd: number;
    /** Remaining lots per asset pooled across all wallets — basis and quantity summed. */
    remainingByAsset: Map<string, IRemainingPosition>;
    /** Realized gain/loss per owning wallet, in USD — the additive per-wallet projection. */
    realizedByWallet: Map<string, number>;
    /** Remaining lots per `wallet → asset`, so a scope can sum only the wallets it covers. */
    remainingByWalletAsset: Map<string, Map<string, IRemainingPosition>>;
    /**
     * External disposals (or fees) whose quantity exceeded available lots — each
     * realized part of its quantity against zero basis, the unreachable-history
     * approximation. Non-zero means realized PnL is approximate.
     */
    zeroBasisDisposals: number;
    /**
     * Internal-transfer migration buckets left undrained after the walk — basis
     * released by a source wallet that no counterpart leg ever received. Non-zero
     * means cost basis silently left the books and the figures are approximate.
     */
    undrainedMigrations: number;
}

/** One open FIFO lot: a quantity acquired at a known per-unit USD cost. */
interface IOpenLot {
    quantity: number;
    unitCostUsd: number;
}

/**
 * Rank moves that share a (block-granular) timestamp so the walk stays causal:
 * acquisitions land before anything consumes them, an internal-out records its
 * migration before the matching internal-in drains it, and a same-block
 * internal-in is available before an external sale that might spend it. Across
 * different timestamps this rank is irrelevant; migration pairs match by `txId`
 * so adjacency is never required.
 *
 * @param move - The move to rank.
 * @returns 0 external-in, 1 internal-out, 2 internal-in, 3 external-out.
 */
function sameTimestampRank(move: ILedgerMove): number {
    if (!move.internal) {
        return move.direction === 'in' ? 0 : 3;
    }
    return move.direction === 'out' ? 1 : 2;
}

/**
 * Consume up to `quantity` from a FIFO lot list in place, returning the lots
 * actually consumed (for basis accounting or migration) and their total basis. A
 * request exceeding available lots consumes what exists — the caller decides what
 * the shortfall means (realized against zero basis for a sale, simply less basis
 * to migrate for an internal transfer).
 *
 * @param lots - The wallet/asset lot list, mutated in place.
 * @param quantity - Units to consume.
 * @returns The consumed lots and their summed USD basis.
 */
function consumeFifo(lots: IOpenLot[], quantity: number): { consumed: IOpenLot[]; consumedBasis: number } {
    let remaining = quantity;
    let consumedBasis = 0;
    const consumed: IOpenLot[] = [];
    while (remaining > 1e-12 && lots.length > 0) {
        const lot = lots[0];
        const take = Math.min(remaining, lot.quantity);
        consumed.push({ quantity: take, unitCostUsd: lot.unitCostUsd });
        consumedBasis += take * lot.unitCostUsd;
        lot.quantity -= take;
        remaining -= take;
        if (lot.quantity <= 1e-12) {
            lots.shift();
        }
    }
    return { consumed, consumedBasis };
}

/**
 * Walk moves chronologically over per-wallet (segregated) FIFO sub-books: open a
 * lot on each external acquisition, consume lots FIFO on each external disposal
 * (accumulating realized PnL for that wallet), and on an internal transfer move
 * the consumed lots from the source wallet's sub-book into the destination's,
 * preserving their basis — matched by `txId` so the in and out sides reunite
 * regardless of order. A disposal (or migration) that exceeds available lots
 * (history older than the provider could reach) consumes what exists and realizes
 * the shortfall against zero basis — the known unreachable-history limitation,
 * surfaced rather than crashed.
 *
 * @param moves - All in-scope moves, internal and external; order-independent on
 *   input (sorted here). Each must carry its owning `wallet`.
 * @param priceOnDay - USD price for an asset on a day, or null when unpriced.
 * @returns Realized PnL and remaining lots, both pooled and per wallet.
 */
export function computeLots(
    moves: ILedgerMove[],
    priceOnDay: (asset: string, day: string) => number | null
): ILotEngineResult {
    // wallet → asset → FIFO lots, and the realized total per wallet.
    const books = new Map<string, Map<string, IOpenLot[]>>();
    const realizedByWallet = new Map<string, number>();
    // `${txId}|${asset}` → lots a source wallet released, awaiting the matching in.
    const pendingMigration = new Map<string, IOpenLot[]>();
    // Incompleteness evidence: disposals that outran available lots, so part of
    // their quantity realized against zero basis (unreachable history).
    let zeroBasisDisposals = 0;

    /**
     * Resolve (creating if absent) the FIFO lot list for one wallet/asset.
     *
     * @param wallet - Owning wallet.
     * @param asset - Asset key.
     * @returns The mutable lot list.
     */
    const lotsFor = (wallet: string, asset: string): IOpenLot[] => {
        let assetBooks = books.get(wallet);
        if (!assetBooks) {
            assetBooks = new Map<string, IOpenLot[]>();
            books.set(wallet, assetBooks);
        }
        let lots = assetBooks.get(asset);
        if (!lots) {
            lots = [];
            assetBooks.set(asset, lots);
        }
        return lots;
    };

    const ordered = [...moves].sort(
        (a, b) => a.timestamp - b.timestamp || sameTimestampRank(a) - sameTimestampRank(b)
    );
    for (const move of ordered) {
        if (move.quantity <= 0) {
            continue;
        }
        const lots = lotsFor(move.wallet, move.asset);

        if (move.internal) {
            const key = `${move.txId}|${move.asset}`;
            if (move.direction === 'out') {
                // Release basis from the source sub-book; hold it for the matching in.
                const { consumed } = consumeFifo(lots, move.quantity);
                pendingMigration.set(key, [...(pendingMigration.get(key) ?? []), ...consumed]);
            } else {
                // Receive only THIS transfer's share of the migrated basis. One tx can
                // emit several internal transfers of the same asset (a multisend, e.g.
                // A→B and A→C), which share this `txId|asset` bucket; draining the whole
                // bucket would hand the first recipient the others' basis. Take exactly
                // the inbound quantity FIFO and leave the remainder for its recipients.
                const bucket = pendingMigration.get(key) ?? [];
                const { consumed } = consumeFifo(bucket, move.quantity);
                for (const lot of consumed) {
                    lots.push({ quantity: lot.quantity, unitCostUsd: lot.unitCostUsd });
                }
                if (bucket.length > 0) {
                    pendingMigration.set(key, bucket);
                } else {
                    pendingMigration.delete(key);
                }
            }
            continue;
        }

        const price = priceOnDay(move.asset, move.day);
        if (move.direction === 'in') {
            lots.push({ quantity: move.quantity, unitCostUsd: price ?? 0 });
            continue;
        }

        // External disposal (or fee): consume FIFO. A shortfall means the ledger
        // does not reach the acquisition — the uncovered quantity realizes
        // against zero basis, and the walk records the approximation.
        const { consumed, consumedBasis } = consumeFifo(lots, move.quantity);
        const consumedQty = consumed.reduce((sum, lot) => sum + lot.quantity, 0);
        if (move.quantity - consumedQty > 1e-9) {
            zeroBasisDisposals += 1;
        }
        if (move.fee) {
            // A fee has no proceeds — the TRX is burned, not sold — so the
            // consumed basis is a pure realized loss. Booked without a price
            // lookup: the loss is the basis itself.
            realizedByWallet.set(move.wallet, (realizedByWallet.get(move.wallet) ?? 0) - consumedBasis);
        } else if (price !== null) {
            const proceeds = move.quantity * price;
            realizedByWallet.set(move.wallet, (realizedByWallet.get(move.wallet) ?? 0) + (proceeds - consumedBasis));
        }
    }

    const remainingByWalletAsset = new Map<string, Map<string, IRemainingPosition>>();
    const remainingByAsset = new Map<string, IRemainingPosition>();
    for (const [wallet, assetBooks] of books) {
        const perAsset = new Map<string, IRemainingPosition>();
        for (const [asset, lots] of assetBooks) {
            let quantity = 0;
            let costBasisUsd = 0;
            for (const lot of lots) {
                quantity += lot.quantity;
                costBasisUsd += lot.quantity * lot.unitCostUsd;
            }
            perAsset.set(asset, { quantity, costBasisUsd });
            const pooled = remainingByAsset.get(asset) ?? { quantity: 0, costBasisUsd: 0 };
            remainingByAsset.set(asset, {
                quantity: pooled.quantity + quantity,
                costBasisUsd: pooled.costBasisUsd + costBasisUsd
            });
        }
        remainingByWalletAsset.set(wallet, perAsset);
    }

    let realizedPnlUsd = 0;
    for (const realized of realizedByWallet.values()) {
        realizedPnlUsd += realized;
    }

    // Migration buckets still holding lots after the walk: a source wallet
    // released basis no counterpart leg ever drained (a half-pair beyond the
    // ledger's reach). Count only buckets with a real remainder — a bucket can
    // linger with empty lots after a partial drain.
    let undrainedMigrations = 0;
    for (const bucket of pendingMigration.values()) {
        if (bucket.some((lot) => lot.quantity > 1e-9)) {
            undrainedMigrations += 1;
        }
    }

    return { realizedPnlUsd, remainingByAsset, realizedByWallet, remainingByWalletAsset, zeroBasisDisposals, undrainedMigrations };
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
 * @param windowDays - Trailing days to emit, bounding the series length, or
 *   `null` for unbounded — the series then starts at the earliest known delta
 *   instead of a fixed floor (an honest "as far back as this ledger reaches",
 *   never a claim of the account's true genesis).
 * @returns Daily USD value points within the window, oldest first.
 */
export function reconstructTrxBalanceSeries(
    anchorDay: string,
    anchorTrxQty: number,
    deltas: IDailyTrxDelta[],
    priceForDay: (day: string) => number | null,
    windowDays: number | null
): IBalanceSeriesPoint[] {
    const deltaByDay = new Map<string, number>();
    for (const delta of deltas) {
        deltaByDay.set(delta.day, (deltaByDay.get(delta.day) ?? 0) + delta.signedQty);
    }

    // Day range: from the earliest activity (or the window floor) to the anchor.
    // Unbounded (windowDays === null) has no floor, so the range starts at the
    // earliest known delta, or the anchor itself when there is no activity at all.
    const earliestActivity = deltas.reduce<string | null>(
        (min, d) => (!min || d.day < min ? d.day : min),
        null
    );
    const windowFloor = windowDays === null ? null : shiftDay(anchorDay, -windowDays);
    const startDay = windowFloor === null
        ? earliestActivity ?? anchorDay
        : (!earliestActivity || earliestActivity > windowFloor ? earliestActivity ?? windowFloor : windowFloor);

    const days = enumerateDays(startDay, anchorDay);
    if (days.length === 0) {
        return [];
    }

    // Back-solve the starting balance so the forward walk lands on the anchor.
    const totalDelta = days.reduce((sum, day) => sum + (deltaByDay.get(day) ?? 0), 0);
    let balance = anchorTrxQty - totalDelta + (deltaByDay.get(days[0]) ?? 0);

    const points: IBalanceSeriesPoint[] = [];
    let lastPrice = 0;
    for (let index = 0; index < days.length; index += 1) {
        const day = days[index];
        if (index > 0) {
            balance += deltaByDay.get(day) ?? 0;
        }
        const price = priceForDay(day);
        if (price !== null) {
            lastPrice = price;
        }
        points.push({ day, valueUsd: Math.max(0, balance) * lastPrice });
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
