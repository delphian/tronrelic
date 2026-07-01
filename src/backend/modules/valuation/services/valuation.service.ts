/**
 * @fileoverview The portfolio valuation service — joins the three local data
 * layers (the transaction ledger, the daily price series, and the balance
 * snapshots) into one summary, entirely from storage and never a live fetch.
 *
 * Division of truth, deliberately: current holdings and net worth come from the
 * balance *snapshot* (the absolute on-chain truth, including staked TRX the
 * ledger cannot reconstruct), while realized/unrealized PnL and cost basis come
 * from the *lot engine* walking the ledger against historical prices. The two can
 * diverge for accounts whose oldest history the provider cannot reach — that is
 * the documented unreachable-history limitation, and the snapshot is what keeps
 * the headline net worth correct regardless.
 *
 * Published on the service registry as `'valuation'`. Authorization is the
 * caller's responsibility; this service trusts the addresses it is handed.
 */

import type {
    IServiceRegistry,
    ISystemLogService,
    IAccountHistoryService,
    IPriceHistoryService,
    IValuationService,
    IPortfolioQuery,
    IPortfolioSummary,
    IPortfolioHolding,
    IValueTransfer,
    IAccountBalanceSnapshot
} from '@/types';
import { PRICE_ASSET_TRX } from '@/types';
import { computeLots, reconstructTrxBalanceSeries, type ILedgerMove, type IDailyTrxDelta } from '../lib/lot-engine.js';

/** Page size for ledger reads; account-history clamps to its own max. */
const LEDGER_PAGE = 500;

/** Cap on ledger rows scanned per address, bounding work for very large wallets. */
const MAX_LEDGER_ROWS = 10_000;

/** Trailing days of the USD balance series shown on the chart. */
const BALANCE_WINDOW_DAYS = 365;

/** How many days back to accept as the "current" price when today is unbackfilled. */
const CURRENT_PRICE_LOOKBACK = 7;

/** Sun per TRX. */
const SUN_PER_TRX = 1_000_000;

/** Default token decimals when the ledger never revealed them (USDT convention). */
const DEFAULT_TOKEN_DECIMALS = 6;

/**
 * Token metadata learned from the value ledger, keyed by contract address. The
 * ledger carries a leg's `assetDecimals` but no symbol, so `decimals` is
 * authoritative and `symbol` is a best-effort short form of the contract address
 * (used only for holding labels; quantities and pricing key on the address).
 */
interface ITokenMeta {
    symbol: string;
    decimals: number;
}

/** Dependencies injected once at bootstrap. */
export interface IValuationServiceDependencies {
    /** Registry to resolve account-history and price-history at call time. */
    serviceRegistry: IServiceRegistry;
    /** Child logger. */
    logger: ISystemLogService;
}

/**
 * Singleton valuation service.
 */
export class ValuationService implements IValuationService {
    private static instance: ValuationService | null = null;

    private readonly serviceRegistry: IServiceRegistry;
    private readonly logger: ISystemLogService;

    /**
     * @param deps - Injected collaborators.
     */
    private constructor(deps: IValuationServiceDependencies) {
        this.serviceRegistry = deps.serviceRegistry;
        this.logger = deps.logger;
    }

    /**
     * Wire dependencies on first call.
     *
     * @param deps - Injected collaborators.
     */
    public static setDependencies(deps: IValuationServiceDependencies): void {
        if (!ValuationService.instance) {
            ValuationService.instance = new ValuationService(deps);
        }
    }

    /**
     * @returns The shared instance.
     * @throws If {@link setDependencies} has not run.
     */
    public static getInstance(): ValuationService {
        if (!ValuationService.instance) {
            throw new Error('ValuationService.setDependencies() must be called before getInstance()');
        }
        return ValuationService.instance;
    }

    /** Today's UTC day. */
    private static today(): string {
        return new Date().toISOString().slice(0, 10);
    }

    /** Shift a day on the UTC boundary. */
    private static shiftDay(day: string, deltaDays: number): string {
        const date = new Date(`${day}T00:00:00.000Z`);
        date.setUTCDate(date.getUTCDate() + deltaDays);
        return date.toISOString().slice(0, 10);
    }

    /** Short display label for an unnamed token. */
    private static shortAsset(asset: string): string {
        return asset.length > 10 ? `${asset.slice(0, 5)}…${asset.slice(-4)}` : asset;
    }

    /**
     * Read an account's full value-transfer ledger (bounded), newest-first from the
     * service, returned as-is for the caller to normalize. Reads the value ledger
     * (`getValueTransfers`) rather than the transaction table: a leg is already the
     * unit of value movement, so a contract's TRX deposit is a first-class
     * `internal` leg here and enters PnL without pattern-matching contract types.
     *
     * Paged by window size alone — the value read returns a bare array (no total),
     * so a page shorter than {@link LEDGER_PAGE} marks the end, and the
     * {@link MAX_LEDGER_ROWS} cap bounds work on very large wallets.
     *
     * @param accountHistory - The account-history service.
     * @param address - Address whose ledger to read.
     * @returns Up to {@link MAX_LEDGER_ROWS} value legs.
     */
    private async readLedger(accountHistory: IAccountHistoryService, address: string): Promise<IValueTransfer[]> {
        const all: IValueTransfer[] = [];
        let offset = 0;
        for (;;) {
            const page = await accountHistory.getValueTransfers({ address, limit: LEDGER_PAGE, offset });
            all.push(...page);
            offset += page.length;
            if (page.length < LEDGER_PAGE || all.length >= MAX_LEDGER_ROWS) {
                break;
            }
        }
        return all;
    }

    /**
     * Repair internal-transfer pairs the bounded per-wallet ledger read split.
     *
     * Why: the engine pairs an internal transfer's two legs (an `out` on the
     * source wallet, an `in` on the destination) by `txId|asset` and migrates
     * basis between sub-books. {@link readLedger} caps each wallet at
     * {@link MAX_LEDGER_ROWS} newest-first *independently*, so a high-volume wallet
     * can push one leg beyond its window while the other leg stays inside another
     * wallet's window. The engine then sees a half-pair and the transfer's basis
     * silently vanishes. Both legs share one on-chain `txId`, so the split is
     * detectable: for an intact internal transfer the `in` and `out` quantities
     * summed across the owned set are equal, so any `txId|asset` whose sums differ
     * has a leg outside a window. Refetch every owned wallet's rows for those
     * hashes (each `txId`'s full row set is then in hand), drop the partial moves,
     * and rebuild them from the authoritative refetch. A transfer whose *both*
     * legs are beyond their windows stays invisible — the pre-existing
     * deep-history approximation, not this split.
     *
     * Mutates `moves` in place. The refetch is bounded by the count of
     * cross-window internal transfers, so the per-wallet read bound is preserved.
     *
     * @param accountHistory - The account-history service for the by-`txId` read.
     * @param moves - The assembled moves, mutated in place when a refetch occurs.
     * @param ownedAddresses - The user's full owned set; every leg lives on one of these.
     * @param ownedSet - The owned set as a set, for internal classification on rebuild.
     * @param tokenMeta - Token-metadata map, populated as refetched rows normalize.
     */
    private async reconcileSplitMigrations(
        accountHistory: IAccountHistoryService,
        moves: ILedgerMove[],
        ownedAddresses: string[],
        ownedSet: Set<string>,
        tokenMeta: Map<string, ITokenMeta>
    ): Promise<void> {
        // Sum in vs out per txId|asset over internal moves; an imbalance means a leg
        // fell outside a window. Keep the txId so we can refetch it.
        const balances = new Map<string, { txId: string; inQty: number; outQty: number }>();
        for (const move of moves) {
            if (!move.internal) {
                continue;
            }
            const key = `${move.txId}|${move.asset}`;
            const entry = balances.get(key) ?? { txId: move.txId, inQty: 0, outQty: 0 };
            if (move.direction === 'in') {
                entry.inQty += move.quantity;
            } else {
                entry.outQty += move.quantity;
            }
            balances.set(key, entry);
        }

        const txIdsToRefetch = new Set<string>();
        for (const { txId, inQty, outQty } of balances.values()) {
            // Intact pairs are bit-identical (both legs decode the same on-chain
            // amount), so a tiny tolerance only absorbs token-decimal float noise.
            const tolerance = 1e-9 * Math.max(1, inQty, outQty);
            if (Math.abs(inQty - outQty) > tolerance) {
                txIdsToRefetch.add(txId);
            }
        }
        if (txIdsToRefetch.size === 0) {
            return;
        }

        const txIds = Array.from(txIdsToRefetch);
        // getValueTransfersByTxIds clamps each read to its own by-hash maximum to
        // bound the SQL IN-list, so a portfolio with more imbalanced hashes than
        // that clamp would have the overflow silently dropped from the refetch —
        // yet the rebuild below removes the partial moves for *every* requested
        // hash, so those overflow transfers would lose their moves entirely,
        // understating basis/PnL. Read the hashes in batches no larger than the
        // clamp and accumulate, so every requested hash is refetched and rebuilt.
        const TXID_READ_CHUNK = 2_000;
        const refetched: IValueTransfer[][] = ownedAddresses.map(() => []);
        for (let start = 0; start < txIds.length; start += TXID_READ_CHUNK) {
            const chunk = txIds.slice(start, start + TXID_READ_CHUNK);
            const chunkRows = await Promise.all(
                ownedAddresses.map((address) => accountHistory.getValueTransfersByTxIds(address, chunk))
            );
            chunkRows.forEach((legs, index) => refetched[index].push(...legs));
        }

        // Drop the partial moves for these hashes, then rebuild from the complete
        // refetch (every owned wallet's legs for each hash are now present).
        const rebuilt = moves.filter((move) => !txIdsToRefetch.has(move.txId));
        ownedAddresses.forEach((address, index) => {
            for (const leg of refetched[index]) {
                const move = ValuationService.toMove(leg, address, ownedSet, tokenMeta);
                if (move) {
                    rebuilt.push(move);
                }
            }
        });
        moves.length = 0;
        moves.push(...rebuilt);
    }

    /**
     * Normalize one value-transfer leg into a value move from a scope address's
     * viewpoint, learning token metadata as a side effect. The ledger already
     * distilled value from contract type at write time, so the mapping is
     * mechanical: `TRX` legs become the priced TRX asset, `TRC20` legs become their
     * contract-addressed asset, and everything else (TRC10, TRC721) is dropped —
     * they have no USD price series and never belonged in the portfolio math. The
     * old per-contract-type guard is gone precisely because that exclusion now
     * happens upstream at leg derivation.
     *
     * @param leg - The stored value leg (native / internal / token).
     * @param scopeAddress - The in-scope address this leg was read for.
     * @param ownedSet - The user's full wallet set, for internal classification.
     * @param tokenMeta - Mutable token-metadata map to populate (decimals authoritative).
     * @returns The move, or null when the leg carries no priceable asset.
     */
    private static toMove(
        leg: IValueTransfer,
        scopeAddress: string,
        ownedSet: Set<string>,
        tokenMeta: Map<string, ITokenMeta>
    ): ILedgerMove | null {
        // Only TRX and TRC20 have a price series; TRC10/TRC721 legs are not portfolio
        // value. Drop a leg with a missing party or a self-transfer (from === to),
        // which nets to zero and would otherwise leave a dangling internal migration.
        if (leg.assetType !== 'TRX' && leg.assetType !== 'TRC20') {
            return null;
        }
        if (!leg.from || !leg.to || leg.from === leg.to) {
            return null;
        }
        const direction: 'in' | 'out' = leg.from === scopeAddress ? 'out' : 'in';
        const counterparty = direction === 'out' ? leg.to : leg.from;
        const day = leg.timestamp.toISOString().slice(0, 10);
        const internal = ownedSet.has(counterparty);

        if (leg.assetType === 'TRX') {
            return {
                txId: leg.txId,
                day,
                timestamp: leg.timestamp.getTime(),
                asset: PRICE_ASSET_TRX,
                quantity: Number(leg.amountRaw) / SUN_PER_TRX,
                direction,
                internal,
                wallet: scopeAddress
            };
        }

        // TRC20: the asset is the token contract; decimals come from the leg (the
        // ledger carries no symbol, so the label falls back to a short address form).
        const asset = leg.assetId;
        const decimals = typeof leg.assetDecimals === 'number' ? leg.assetDecimals : DEFAULT_TOKEN_DECIMALS;
        if (!tokenMeta.has(asset)) {
            tokenMeta.set(asset, { symbol: ValuationService.shortAsset(asset), decimals });
        }
        const quantity = Number(leg.amountRaw) / 10 ** decimals;
        return { txId: leg.txId, day, timestamp: leg.timestamp.getTime(), asset, quantity, direction, internal, wallet: scopeAddress };
    }

    /**
     * Compute the portfolio summary for a scope. See {@link IValuationService.getPortfolio}.
     *
     * @param query - In-scope addresses, owned set, and scope label.
     * @returns The portfolio summary (empty/zeroed when the data layers are absent).
     */
    public async getPortfolio(query: IPortfolioQuery): Promise<IPortfolioSummary> {
        const accountHistory = this.serviceRegistry.get<IAccountHistoryService>('account-history');
        const priceHistory = this.serviceRegistry.get<IPriceHistoryService>('price-history');
        if (!accountHistory || !priceHistory) {
            return ValuationService.emptySummary(query);
        }

        const ownedSet = new Set(query.ownedAddresses);
        const reportSet = new Set(query.addresses);
        const tokenMeta = new Map<string, ITokenMeta>();
        const moves: ILedgerMove[] = [];

        // Read the ledgers of the FULL owned set, not just the reported addresses:
        // an internal transfer's basis can only migrate to the receiving wallet if
        // the *source* wallet's ledger is also walked. Reporting holdings, by
        // contrast, draws only on the report-scope snapshots below. (For the
        // aggregate scope the two sets are identical, so this is a no-op there.)
        const readSet = Array.from(new Set([...query.ownedAddresses, ...query.addresses]));
        const ledgers = await Promise.all(readSet.map((address) => this.readLedger(accountHistory, address)));
        // Read in parallel above; normalize sequentially so tokenMeta learns symbols
        // in a deterministic order and `moves` is order-stable for the engine sort.
        readSet.forEach((address, index) => {
            for (const leg of ledgers[index]) {
                const move = ValuationService.toMove(leg, address, ownedSet, tokenMeta);
                if (move) {
                    moves.push(move);
                }
            }
        });

        // Repair internal-transfer pairs the per-wallet read window split in half.
        // readLedger caps each wallet at MAX_LEDGER_ROWS newest-first independently,
        // so a high-volume wallet can push one leg of a migration beyond its window
        // while the other leg stays inside another wallet's — silently dropping the
        // transfer's basis. Refetch the missing legs by txId and rebuild them.
        await this.reconcileSplitMigrations(accountHistory, moves, query.ownedAddresses, ownedSet, tokenMeta);

        // Current holdings come only from the report-scope snapshots (read in parallel).
        const snapshots = (
            await Promise.all(query.addresses.map((address) => accountHistory.getLatestSnapshot(address)))
        ).filter((snapshot): snapshot is IAccountBalanceSnapshot => snapshot !== null);

        // Make sure every held/seen token gets priced on future backfill ticks.
        // Union snapshot-held assets with ledger-move assets: a token acquired
        // outside the scan window appears in the snapshot but never in `moves`, and
        // would otherwise never get a price-history cursor and stay unpriced.
        const snapshotAssets = snapshots.flatMap((s) => s.tokenBalances.map((t) => t.asset));
        const tokenAssets = Array.from(
            new Set([...moves.map((m) => m.asset), ...snapshotAssets].filter((a) => a !== PRICE_ASSET_TRX))
        );
        await priceHistory.ensureAssetsTracked(tokenAssets);

        // Batch historical prices per asset for the external moves (internal
        // transfers carry migrated basis and need no price lookup).
        const externalMoves = moves.filter((m) => !m.internal);
        const priceMap = new Map<string, number>();
        const assetsToPrice = Array.from(new Set(externalMoves.map((m) => m.asset)));
        await Promise.all(
            assetsToPrice.map(async (asset) => {
                const days = Array.from(new Set(externalMoves.filter((m) => m.asset === asset).map((m) => m.day)));
                if (days.length === 0) {
                    return;
                }
                const points = await priceHistory.getPricesForDays(asset, days);
                for (const point of points) {
                    priceMap.set(`${asset}|${point.day}`, point.priceUsd);
                }
            })
        );
        const priceOnDay = (asset: string, day: string): number | null => priceMap.get(`${asset}|${day}`) ?? null;

        // The engine sees all moves (it migrates internal-transfer basis between
        // wallet sub-books); the realized PnL and remaining basis are then summed
        // over only the report-scope wallets, so per-wallet and per-user stay
        // additive.
        const lots = computeLots(moves, priceOnDay);
        const realizedPnlUsd = query.addresses.reduce((sum, wallet) => sum + (lots.realizedByWallet.get(wallet) ?? 0), 0);
        const remainingForScope = new Map<string, { quantity: number; costBasisUsd: number }>();
        for (const wallet of query.addresses) {
            const perAsset = lots.remainingByWalletAsset.get(wallet);
            if (!perAsset) {
                continue;
            }
            for (const [asset, position] of perAsset) {
                const acc = remainingForScope.get(asset) ?? { quantity: 0, costBasisUsd: 0 };
                remainingForScope.set(asset, {
                    quantity: acc.quantity + position.quantity,
                    costBasisUsd: acc.costBasisUsd + position.costBasisUsd
                });
            }
        }

        // Aggregate current holdings from the authoritative snapshots.
        const today = ValuationService.today();
        let trxQty = 0;
        let stakedSun = 0;
        let unstakingSun = 0;
        const tokenQty = new Map<string, number>();
        let capturedAt: Date | null = null;
        for (const snapshot of snapshots) {
            trxQty += (snapshot.trxBalanceSun + snapshot.stakedEnergySun + snapshot.stakedBandwidthSun + snapshot.unstakingSun) / SUN_PER_TRX;
            stakedSun += snapshot.stakedEnergySun + snapshot.stakedBandwidthSun;
            unstakingSun += snapshot.unstakingSun;
            if (!capturedAt || snapshot.capturedAt > capturedAt) {
                capturedAt = snapshot.capturedAt;
            }
            for (const token of snapshot.tokenBalances) {
                const meta = tokenMeta.get(token.asset);
                const decimals = meta?.decimals ?? DEFAULT_TOKEN_DECIMALS;
                tokenQty.set(token.asset, (tokenQty.get(token.asset) ?? 0) + Number(token.rawBalance) / 10 ** decimals);
            }
        }

        // Current price per held asset (today, walking back if today is unbackfilled).
        const heldAssets = [PRICE_ASSET_TRX, ...tokenQty.keys()];
        const currentPrice = new Map<string, number | null>();
        await Promise.all(
            heldAssets.map(async (asset) => {
                const series = await priceHistory.getSeries(asset, ValuationService.shiftDay(today, -CURRENT_PRICE_LOOKBACK), today);
                currentPrice.set(asset, series.length > 0 ? series[series.length - 1].priceUsd : null);
            })
        );

        const holdings = ValuationService.buildHoldings(trxQty, tokenQty, tokenMeta, currentPrice, remainingForScope);
        const pricedHoldings = holdings.filter((h) => h.priceUsd !== null);
        const netWorthUsd = pricedHoldings.reduce((sum, h) => sum + h.valueUsd, 0);
        const unrealizedPnlUsd = pricedHoldings.reduce((sum, h) => sum + h.unrealizedPnlUsd, 0);
        const allocation = pricedHoldings
            .map((h) => ({ asset: h.asset, symbol: h.symbol, valueUsd: h.valueUsd, fraction: netWorthUsd > 0 ? h.valueUsd / netWorthUsd : 0 }))
            .sort((a, b) => b.valueUsd - a.valueUsd);
        const unpricedAssets = holdings.filter((h) => h.priceUsd === null && h.quantity > 0).map((h) => h.asset);
        const pricedCount = holdings.length - unpricedAssets.length;
        const pricedValueFraction = holdings.length > 0 ? pricedCount / holdings.length : 1;

        // USD balance-over-time, TRX-anchored (see lot-engine notes). Scoped to the
        // reported wallets only — `moves` now spans the whole owned set, but a
        // wallet's balance curve must reflect just its own TRX deltas (internal
        // included, since an internal transfer still moves one wallet's balance).
        const trxDeltas: IDailyTrxDelta[] = moves
            .filter((m) => m.asset === PRICE_ASSET_TRX && reportSet.has(m.wallet))
            .map((m) => ({ day: m.day, signedQty: m.direction === 'in' ? m.quantity : -m.quantity }));
        const anchorDay = capturedAt ? capturedAt.toISOString().slice(0, 10) : today;
        const trxSeries = await priceHistory.getSeries(PRICE_ASSET_TRX, ValuationService.shiftDay(anchorDay, -BALANCE_WINDOW_DAYS), anchorDay);
        const trxPriceByDay = new Map(trxSeries.map((p) => [p.day, p.priceUsd]));
        const balanceSeriesUsd = reconstructTrxBalanceSeries(
            anchorDay,
            trxQty,
            trxDeltas,
            (day) => trxPriceByDay.get(day) ?? null,
            BALANCE_WINDOW_DAYS
        );

        return {
            scope: query.scope,
            addresses: query.addresses,
            capturedAt,
            netWorthUsd,
            stakedTrxSun: stakedSun,
            unstakingTrxSun: unstakingSun,
            holdings,
            allocation,
            realizedPnlUsd,
            unrealizedPnlUsd,
            totalPnlUsd: realizedPnlUsd + unrealizedPnlUsd,
            balanceSeriesUsd,
            unpricedAssets,
            pricedValueFraction: Math.max(0, Math.min(1, pricedValueFraction))
        };
    }

    /**
     * Assemble holding rows from current quantities, prices, and lot bases.
     *
     * @param trxQty - Total TRX quantity (liquid + staked + unstaking).
     * @param tokenQty - Per-token current quantities.
     * @param tokenMeta - Symbols/decimals learned from the ledger.
     * @param currentPrice - Current price per asset (null when unpriced).
     * @param remaining - Remaining lot positions from the engine.
     * @returns Holdings sorted by USD value, largest first.
     */
    private static buildHoldings(
        trxQty: number,
        tokenQty: Map<string, number>,
        tokenMeta: Map<string, ITokenMeta>,
        currentPrice: Map<string, number | null>,
        remaining: Map<string, { quantity: number; costBasisUsd: number }>
    ): IPortfolioHolding[] {
        const holdings: IPortfolioHolding[] = [];
        const rows: Array<{ asset: string; symbol: string; quantity: number }> = [
            { asset: PRICE_ASSET_TRX, symbol: 'TRX', quantity: trxQty }
        ];
        for (const [asset, quantity] of tokenQty) {
            rows.push({ asset, symbol: tokenMeta.get(asset)?.symbol ?? ValuationService.shortAsset(asset), quantity });
        }

        for (const row of rows) {
            if (row.quantity <= 0) {
                continue;
            }
            const price = currentPrice.get(row.asset) ?? null;
            const valueUsd = price !== null ? row.quantity * price : 0;
            const costBasisUsd = remaining.get(row.asset)?.costBasisUsd ?? 0;
            holdings.push({
                asset: row.asset,
                symbol: row.symbol,
                quantity: row.quantity,
                priceUsd: price,
                valueUsd,
                costBasisUsd,
                unrealizedPnlUsd: price !== null ? valueUsd - costBasisUsd : 0
            });
        }
        return holdings.sort((a, b) => b.valueUsd - a.valueUsd);
    }

    /**
     * The zeroed summary returned when the underlying data layers are unavailable
     * (no ClickHouse / services not yet published), so callers get a stable shape.
     *
     * @param query - The originating query, echoed back.
     * @returns An empty summary.
     */
    private static emptySummary(query: IPortfolioQuery): IPortfolioSummary {
        return {
            scope: query.scope,
            addresses: query.addresses,
            capturedAt: null,
            netWorthUsd: 0,
            stakedTrxSun: 0,
            unstakingTrxSun: 0,
            holdings: [],
            allocation: [],
            realizedPnlUsd: 0,
            unrealizedPnlUsd: 0,
            totalPnlUsd: 0,
            balanceSeriesUsd: [],
            unpricedAssets: [],
            pricedValueFraction: 1
        };
    }
}
