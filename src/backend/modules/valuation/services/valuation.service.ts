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
    IUserSettingsService,
    IValuationService,
    IPortfolioQuery,
    IPortfolioSummary,
    IPortfolioHolding,
    IValueTransfer,
    IValueTransferCursor,
    IAccountBalanceSnapshot
} from '@/types';
import { PRICE_ASSET_TRX, USDT_CONTRACT_ADDRESS } from '@/types';
import { computeLots, reconstructTrxBalanceSeries, type ILedgerMove, type IDailyTrxDelta } from '../lib/lot-engine.js';

/** Page size for ledger reads. Pagination has no row cap — a high-volume wallet's
 *  full ledger is always read, so an internal transfer's counterpart leg is never
 *  split across a window (see the removed split-migration repair this replaced). */
const LEDGER_PAGE = 500;

/** Default trailing days of the USD balance series absent an admin override. */
const DEFAULT_BALANCE_WINDOW_DAYS = 365;

/** Namespace under which the per-wallet balance-range override is stored in `'user-settings'`. */
const BALANCE_RANGE_NAMESPACE = 'valuation';

/** The only two admin-settable balance-chart ranges: the default trailing year, or unbounded. */
export type BalanceRangeSetting = '1y' | 'all';

/** How many days back to accept as the "current" price when today is unbackfilled. */
const CURRENT_PRICE_LOOKBACK = 7;

/** Sun per TRX. */
const SUN_PER_TRX = 1_000_000;

/** Default token decimals when neither the ledger nor the metadata registry revealed them (USDT convention). */
const DEFAULT_TOKEN_DECIMALS = 6;

/**
 * Known USD stablecoins on TRON, eligible for the $1 missing-day fallback.
 * Keyed by contract address; USDC's TRON deployment is a fixed constant like
 * USDT's. Membership is deliberately narrow — only assets whose peg is the
 * product — so an arbitrary token can never inherit the pin.
 */
const STABLECOIN_ASSETS = new Set<string>([
    USDT_CONTRACT_ADDRESS,
    'TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8' // USDC (TRON)
]);

/**
 * Maximum deviation from $1.00 a stablecoin's nearest real price may show
 * before the fallback refuses to pin missing days. 2% is far outside normal
 * peg noise but inside a genuine depeg (USDC hit ~$0.88 in March 2023 —
 * exactly when a naive pin lies).
 */
const STABLECOIN_DEPEG_TOLERANCE = 0.02;

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

    /** Signed day difference (`a` - `b`) between two UTC day strings. */
    private static dayDelta(a: string, b: string): number {
        return (Date.parse(`${a}T00:00:00.000Z`) - Date.parse(`${b}T00:00:00.000Z`)) / 86_400_000;
    }

    /** Short display label for an unnamed token. */
    private static shortAsset(asset: string): string {
        return asset.length > 10 ? `${asset.slice(0, 5)}…${asset.slice(-4)}` : asset;
    }

    /**
     * Read an account's complete value-transfer ledger, newest-first from the
     * service, returned as-is for the caller to normalize. Reads the value ledger
     * (`getValueTransfers`) rather than the transaction table: a leg is already the
     * unit of value movement, so a contract's TRX deposit is a first-class
     * `internal` leg here and enters PnL without pattern-matching contract types.
     *
     * Paged by a keyset cursor, uncapped — the value read returns a bare array (no
     * total), so a page shorter than {@link LEDGER_PAGE} marks the end. A very
     * high-volume wallet costs a slower read, not a truncated one; every owned
     * address's ledger is read in full, so an internal transfer's two legs are
     * always both present (no per-wallet window for a leg to fall outside of). The
     * cursor — the last leg's `(timestamp, txId, origin, legKey, assetId)` — is a
     * stable watermark even while forward-sync concurrently inserts newer legs;
     * `offset` would shift underneath the scan and silently duplicate or skip legs
     * at a page boundary (see {@link IValueTransferCursor}).
     *
     * @param accountHistory - The account-history service.
     * @param address - Address whose ledger to read.
     * @returns Every value leg for the address.
     */
    private async readLedger(accountHistory: IAccountHistoryService, address: string): Promise<IValueTransfer[]> {
        const all: IValueTransfer[] = [];
        let cursor: IValueTransferCursor | undefined;
        for (;;) {
            const page = await accountHistory.getValueTransfers({ address, limit: LEDGER_PAGE, cursor });
            all.push(...page);
            if (page.length < LEDGER_PAGE) {
                break;
            }
            const last = page[page.length - 1];
            cursor = { timestamp: last.timestamp, txId: last.txId, origin: last.origin, legKey: last.legKey, assetId: last.assetId };
        }
        return all;
    }

    /**
     * Resolve the balance-over-time chart's trailing window for a query: the
     * default trailing year, widened to unbounded if an admin has set any
     * in-scope wallet's stored override to `'all'`. One window covers the whole
     * query because the series is a single reconstructed curve, not one stitched
     * per wallet — widening it for a wallet the caller is already viewing never
     * exposes data they are not entitled to see.
     *
     * Degrades to the default when `'user-settings'` is unavailable (mirrors how
     * the rest of this service treats an absent optional dependency).
     *
     * @param userId - Better Auth id whose stored overrides to check.
     * @param addresses - The report-scope addresses for this query.
     * @returns Trailing window in days, or `null` for unbounded.
     */
    private async resolveBalanceWindowDays(userId: string, addresses: string[]): Promise<number | null> {
        const userSettings = this.serviceRegistry.get<IUserSettingsService>('user-settings');
        if (!userSettings) {
            return DEFAULT_BALANCE_WINDOW_DAYS;
        }
        try {
            const stored = await userSettings.getNamespace(userId, BALANCE_RANGE_NAMESPACE);
            const unboundedRange: BalanceRangeSetting = 'all';
            const hasUnboundedOverride = addresses.some((address) => stored[address] === unboundedRange);
            return hasUnboundedOverride ? null : DEFAULT_BALANCE_WINDOW_DAYS;
        } catch (error) {
            this.logger.warn(
                { error, userId },
                'valuation: balance-range override read failed; falling back to default window'
            );
            return DEFAULT_BALANCE_WINDOW_DAYS;
        }
    }

    /**
     * Whether every report-scope address has finished account-history's ledger
     * backfill. The balance series back-solves from today's snapshot across
     * whatever deltas the ledger has, so a day missing purely because ingestion
     * hasn't reached it yet — not because nothing happened — still shifts the
     * whole reconstructed curve. An address absent from the progress read (never
     * ticked yet) counts as not complete, the conservative read.
     *
     * @param accountHistory - The account-history service for the progress read.
     * @param addresses - The report-scope addresses for this query.
     * @returns `true` only if every address is `'complete'` and not still catching
     *   up on a forward-sync backlog.
     */
    private async resolveHistoryBackfillComplete(accountHistory: IAccountHistoryService, addresses: string[]): Promise<boolean> {
        try {
            const progress = await accountHistory.getProgressFor(addresses);
            const progressByAddress = new Map(progress.map((entry) => [entry.address, entry]));
            // A 'complete' account still draining a forward-sync backlog (catchingUp)
            // has recent ledger rows missing behind an already-current snapshot anchor,
            // which shifts the whole reconstructed curve — treat it as incomplete so the
            // in-progress warning stays up for exactly the high-activity wallets that
            // overflow the per-tick forward page cap.
            return addresses.every((address) => {
                const entry = progressByAddress.get(address);
                return entry?.status === 'complete' && !entry.catchingUp;
            });
        } catch (error) {
            this.logger.warn(
                { error },
                'valuation: backfill-progress read failed; treating history as incomplete'
            );
            return false;
        }
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

        // Fee and reward legs deliberately carry one empty party (burned TRX has
        // no recipient; protocol-minted rewards have no sender), so they resolve
        // before the both-parties guard. Both are external by construction: a fee
        // is a disposal with no proceeds (flagged for the engine), a reward is an
        // income acquisition priced at the day's price.
        if (leg.origin === 'fee') {
            if (leg.from !== scopeAddress) {
                return null;
            }
            return {
                txId: leg.txId,
                day: leg.timestamp.toISOString().slice(0, 10),
                timestamp: leg.timestamp.getTime(),
                asset: PRICE_ASSET_TRX,
                quantity: Number(leg.amountRaw) / SUN_PER_TRX,
                direction: 'out',
                internal: false,
                wallet: scopeAddress,
                fee: true
            };
        }
        if (leg.origin === 'reward') {
            if (leg.to !== scopeAddress) {
                return null;
            }
            return {
                txId: leg.txId,
                day: leg.timestamp.toISOString().slice(0, 10),
                timestamp: leg.timestamp.getTime(),
                asset: PRICE_ASSET_TRX,
                quantity: Number(leg.amountRaw) / SUN_PER_TRX,
                direction: 'in',
                internal: false,
                wallet: scopeAddress
            };
        }

        if (!leg.from || !leg.to || leg.from === leg.to) {
            return null;
        }
        // Defense in depth at the ledger-read boundary: a TRC20 leg keys holdings and
        // the price series on its contract address, so an empty assetId would corrupt
        // portfolio math onto the "" asset. The events source already drops these legs
        // upstream; this guards the persistence-read seam. Type-qualified because a
        // legitimate TRX leg carries an empty assetId by design.
        if (leg.assetType === 'TRC20' && !leg.assetId) {
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

        // TRC20: the asset is the token contract. Prefer decimals already learned for
        // this asset — a sibling leg can carry authoritative decimals this leg lacks,
        // because the events source omits them and the trc20 back-fill only stamps the
        // walk's own token — then fall back to this leg's explicit value, defaulting
        // only when nothing is known. Update the map whenever a leg reveals a better
        // value so the snapshot-holdings path keys on authoritative decimals too. The
        // ledger carries no symbol, so the label stays a short address form.
        const asset = leg.assetId;
        let decimals = tokenMeta.get(asset)?.decimals;
        if (decimals === undefined || (typeof leg.assetDecimals === 'number' && leg.assetDecimals !== decimals)) {
            decimals = typeof leg.assetDecimals === 'number' ? leg.assetDecimals : DEFAULT_TOKEN_DECIMALS;
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

        // Upgrade token metadata from the registry (real symbol/decimals learned
        // from decoded trc20 transfers). The ledger walk above only yields
        // decimals and a short-address label; the registry supplies the display
        // symbol for every token and decimals for tokens the ledger legs never
        // carried (e.g. held in the snapshot but acquired outside the ingested
        // window). Ledger-observed decimals stay authoritative when present.
        try {
            const registry = await accountHistory.getTokenMetadata(tokenAssets);
            for (const meta of registry) {
                const existing = tokenMeta.get(meta.asset);
                tokenMeta.set(meta.asset, {
                    symbol: meta.symbol ?? existing?.symbol ?? ValuationService.shortAsset(meta.asset),
                    decimals: existing?.decimals ?? meta.decimals ?? DEFAULT_TOKEN_DECIMALS
                });
            }
        } catch (error) {
            this.logger.warn({ error }, 'valuation: token-metadata read failed; falling back to ledger-learned metadata');
        }

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
        // Depeg-aware stablecoin fallback: a known stablecoin's missing day may
        // be pinned to $1, but only when a real price *near that specific day*
        // does not dispute the peg. Scoped per (asset, day) rather than per
        // asset — a coin trading at par today says nothing about whether it
        // held its peg on a historical gap day, so a past depeg (a
        // March-2023-style event) is checked against prices near the day it
        // happened, not against today's price. A day with no real coverage
        // nearby pins freely — that is the exact gap the fallback exists to fill.
        const today = ValuationService.today();
        const stableAssetsInPlay = Array.from(new Set(
            [...assetsToPrice, ...tokenAssets].filter((asset) => STABLECOIN_ASSETS.has(asset))
        ));
        const stableGapDays = new Map<string, Set<string>>();
        for (const asset of stableAssetsInPlay) {
            const days = externalMoves
                .filter((m) => m.asset === asset && !priceMap.has(`${asset}|${m.day}`))
                .map((m) => m.day);
            if (days.length > 0) {
                stableGapDays.set(asset, new Set(days));
            }
        }
        const stablePinAllowed = new Map<string, boolean>();
        const resolveStablePin = async (asset: string, day: string): Promise<boolean> => {
            const key = `${asset}|${day}`;
            const cached = stablePinAllowed.get(key);
            if (cached !== undefined) {
                return cached;
            }
            try {
                const windowEnd = ValuationService.shiftDay(day, CURRENT_PRICE_LOOKBACK);
                const nearby = await priceHistory.getSeries(
                    asset,
                    ValuationService.shiftDay(day, -CURRENT_PRICE_LOOKBACK),
                    windowEnd > today ? today : windowEnd
                );
                const nearest = nearby.reduce<{ day: string; priceUsd: number } | null>((best, point) => {
                    if (!best) {
                        return point;
                    }
                    return Math.abs(ValuationService.dayDelta(point.day, day)) < Math.abs(ValuationService.dayDelta(best.day, day))
                        ? point
                        : best;
                }, null);
                const allowed = nearest === null || Math.abs(nearest.priceUsd - 1) <= STABLECOIN_DEPEG_TOLERANCE;
                stablePinAllowed.set(key, allowed);
                return allowed;
            } catch (error) {
                this.logger.warn({ error, asset, day }, 'valuation: stablecoin depeg check failed; defaulting to allowing pin');
                stablePinAllowed.set(key, true);
                return true;
            }
        };
        await Promise.all(
            Array.from(stableGapDays.entries()).flatMap(([asset, days]) =>
                Array.from(days).map((day) => resolveStablePin(asset, day))
            )
        );
        const priceOnDay = (asset: string, day: string): number | null => {
            const stored = priceMap.get(`${asset}|${day}`);
            if (stored !== undefined) {
                return stored;
            }
            return STABLECOIN_ASSETS.has(asset) && stablePinAllowed.get(`${asset}|${day}`) !== false ? 1 : null;
        };

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
        let trxQty = 0;
        let stakedSun = 0;
        let unstakingSun = 0;
        const tokenQty = new Map<string, number>();
        let capturedAt: Date | null = null;
        for (const snapshot of snapshots) {
            // Withdrawable (unclaimed) vote rewards are real net worth — the
            // claim only moves them into the liquid balance — so they count in
            // the TRX quantity alongside liquid, staked, and unstaking TRX.
            trxQty += (
                snapshot.trxBalanceSun +
                snapshot.stakedEnergySun +
                snapshot.stakedBandwidthSun +
                snapshot.unstakingSun +
                snapshot.withdrawableRewardSun
            ) / SUN_PER_TRX;
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
                try {
                    const series = await priceHistory.getSeries(asset, ValuationService.shiftDay(today, -CURRENT_PRICE_LOOKBACK), today);
                    if (series.length > 0) {
                        currentPrice.set(asset, series[series.length - 1].priceUsd);
                        return;
                    }
                    // Same depeg-aware $1 pin as the historical lookup, scoped to
                    // today: a held stablecoin with no local coverage values at
                    // par instead of dropping out of USD totals entirely.
                    const pinAllowed = STABLECOIN_ASSETS.has(asset) ? await resolveStablePin(asset, today) : false;
                    currentPrice.set(asset, pinAllowed ? 1 : null);
                } catch (error) {
                    this.logger.warn({ error, asset }, 'valuation: current price fetch failed; treating as unpriced');
                    const pinAllowed = STABLECOIN_ASSETS.has(asset) && stablePinAllowed.get(`${asset}|${today}`) !== false;
                    currentPrice.set(asset, pinAllowed ? 1 : null);
                }
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
        const windowDays = await this.resolveBalanceWindowDays(query.userId, query.addresses);
        const earliestDeltaDay = trxDeltas.reduce<string | null>(
            (min, d) => (!min || d.day < min ? d.day : min),
            null
        );
        const priceFloorDay = windowDays === null
            ? (earliestDeltaDay ?? anchorDay)
            : ValuationService.shiftDay(anchorDay, -windowDays);
        const trxSeries = await priceHistory.getSeries(PRICE_ASSET_TRX, priceFloorDay, anchorDay);
        const trxPriceByDay = new Map(trxSeries.map((p) => [p.day, p.priceUsd]));
        const balanceSeriesUsd = reconstructTrxBalanceSeries(
            anchorDay,
            trxQty,
            trxDeltas,
            (day) => trxPriceByDay.get(day) ?? null,
            windowDays
        );
        const historyBackfillComplete = await this.resolveHistoryBackfillComplete(accountHistory, query.addresses);

        // The engine's incompleteness evidence: any zero-basis disposal or
        // undrained migration means the ledger did not reach far enough back, so
        // PnL and cost basis are approximate and the UI should label them.
        const basisApproximate = lots.zeroBasisDisposals > 0 || lots.undrainedMigrations > 0;

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
            pricedValueFraction: Math.max(0, Math.min(1, pricedValueFraction)),
            historyBackfillComplete,
            basisApproximate
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
            pricedValueFraction: 1,
            historyBackfillComplete: true,
            basisApproximate: false
        };
    }
}
