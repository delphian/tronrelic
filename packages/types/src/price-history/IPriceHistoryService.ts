/**
 * @fileoverview Published contract for the price-history service.
 *
 * Valuation and PnL are impossible without a *local* historical price series:
 * the platform refuses to make a live external price call on a page load, so a
 * scheduled ingester backfills daily USD prices into ClickHouse once and serves
 * every downstream read (per-transaction valuation, balance-over-time, cost
 * basis) from local storage. Prices are immutable, so a date is fetched once and
 * never refreshed — the whole concern is a bounded, resumable backfill plus a
 * trivial daily append, mirroring the account-history ingestion discipline.
 *
 * This file is the *published* surface only. The data-source seam
 * (`IPriceHistoryProvider`, CoinGecko v1) lives inside the module, never here,
 * so the types package stays source-independent.
 */

/**
 * An asset priced in USD. `'TRX'` is the native coin; any other value is a TRC20
 * token's base58 contract address. Kept as a bare string (not an enum) because
 * the tracked token set is discovered at runtime from the transaction ledger,
 * not known at compile time.
 */
export type PriceAsset = string;

/**
 * The native-coin sentinel for {@link PriceAsset}. Exported as a constant so
 * callers compare against a single source of truth rather than re-typing the
 * literal.
 */
export const PRICE_ASSET_TRX: PriceAsset = 'TRX';

/**
 * One asset's closing USD price for one UTC day — the atomic unit the series is
 * built from. The day is a bare `YYYY-MM-DD` (UTC) so it joins directly to the
 * ledger's day buckets without re-deriving a timezone boundary, and matches the
 * daily granularity cost-basis and tax accounting require (intraday pricing is
 * neither reproducible nor needed).
 */
export interface IPricePoint {
    /** The priced asset — {@link PRICE_ASSET_TRX} or a TRC20 contract address. */
    asset: PriceAsset;
    /** UTC calendar day, `YYYY-MM-DD`. */
    day: string;
    /** Closing USD price on that day. */
    priceUsd: number;
}

/**
 * Pacing dials for the backfill, throttle-down only — they bound work per tick
 * so a deep historical backfill or a burst of newly-discovered tokens cannot
 * exceed CoinGecko's rate budget (a separate budget from the TronGrid limiter
 * that protects block sync). Mirrors `IAccountHistorySettings`.
 */
export interface IPriceHistorySettings {
    /** Master switch; false parks all price ingestion without losing cursors. */
    ingestionEnabled: boolean;
    /** Max per-day deep-backfill fetches per tick (the variable cost). */
    daysPerTick: number;
    /** Max distinct token assets advanced per tick. */
    tokensPerTick: number;
}

/**
 * Per-asset coverage rollup for the admin surface and for a consumer to decide
 * whether a date is priceable. Absolute day bounds, never a percentage —
 * an asset's true listing date is not known up front.
 */
export interface IPriceAssetCoverage {
    /** The asset this coverage describes. */
    asset: PriceAsset;
    /** Oldest UTC day with a stored price, or null when none stored yet. */
    oldestDay: string | null;
    /** Newest UTC day with a stored price, or null when none stored yet. */
    newestDay: string | null;
    /** Distinct days stored for the asset. */
    dayCount: number;
    /** True once the dense recent window has been seeded for this asset. */
    recentSeeded: boolean;
    /** True once the backward backfill has reached the asset's start. */
    backfillComplete: boolean;
}

/**
 * The full price-history snapshot for the admin page and live payloads.
 */
export interface IPriceHistoryStats {
    /** Effective pacing settings. */
    settings: IPriceHistorySettings;
    /** Coverage per tracked asset. */
    assets: IPriceAssetCoverage[];
    /** Cross-asset rollups for the page header. */
    totals: {
        /** Number of distinct tracked assets. */
        assetCount: number;
        /** Oldest day stored across all assets, or null. */
        oldestDay: string | null;
        /** Newest day stored across all assets, or null. */
        newestDay: string | null;
        /**
         * Seeded assets whose newest stored day has fallen behind yesterday — the
         * forward append is lagging for them. A non-zero value tells the operator
         * the series is going stale and may warrant a manual forward run or a
         * cadence bump.
         */
        staleAssets: number;
    };
}

/**
 * Cross-module coverage diagnostics — held tokens joined against the price series.
 *
 * The actionable observability metric for the portfolio surface: a token a user
 * holds but the series cannot price is excluded from their USD totals, so the
 * unpriced list tells the operator exactly which contracts need a price source.
 * Computed at the admin layer (which can reach both the held-token set and the
 * coverage), not by the service itself.
 */
export interface IPriceCoverageDiagnostics {
    /** Distinct TRC20 tokens held across all tracked accounts. */
    heldTokenCount: number;
    /** Held tokens that have local price coverage. */
    pricedTokenCount: number;
    /** Held tokens with NO local price coverage — chase a source for these. */
    unpricedTokens: PriceAsset[];
}

/**
 * The central service every price read and every ingestion tick routes through.
 * Published on the service registry as `'price-history'`; the ClickHouse
 * `price_history` table is reached only here. The valuation engine consumes this
 * to value transactions and balances at their UTC-day price.
 */
export interface IPriceHistoryService {
    /**
     * Read one asset's USD price on a specific UTC day. Returns null when the day
     * is not yet backfilled or predates the asset's listing — the caller treats a
     * null as "unpriced" rather than zero, so an unlisted token never silently
     * values to nothing.
     *
     * @param asset - The asset to price.
     * @param day - UTC `YYYY-MM-DD`.
     * @returns The closing USD price, or null when unavailable.
     */
    getPriceOn(asset: PriceAsset, day: string): Promise<number | null>;

    /**
     * Batch one asset's prices for an explicit set of days — the read shape the
     * valuation engine uses to value every transaction by its own day in a single
     * round-trip rather than one query per row.
     *
     * @param asset - The asset to price.
     * @param days - UTC `YYYY-MM-DD` days to look up.
     * @returns The stored points for the requested days; missing days are omitted.
     */
    getPricesForDays(asset: PriceAsset, days: string[]): Promise<IPricePoint[]>;

    /**
     * Read a contiguous daily series for one asset, oldest first — backs the
     * USD balance-over-time chart's price track.
     *
     * @param asset - The asset to price.
     * @param fromDay - Inclusive start UTC `YYYY-MM-DD`.
     * @param toDay - Inclusive end UTC `YYYY-MM-DD`.
     * @returns The stored points in the range, oldest first.
     */
    getSeries(asset: PriceAsset, fromDay: string, toDay: string): Promise<IPricePoint[]>;

    /**
     * Register token assets for backfill. The valuation engine calls this with the
     * TRC20 contracts a user actually held (discovered from the ledger) so the
     * ingester widens its tracked set only to assets that need pricing, never the
     * whole token universe. Idempotent; TRX is always tracked implicitly.
     *
     * @param assets - TRC20 contract addresses to ensure are tracked.
     */
    ensureAssetsTracked(assets: PriceAsset[]): Promise<void>;

    /** Read current pacing settings, seeded with defaults on first read. */
    getSettings(): Promise<IPriceHistorySettings>;

    /**
     * Merge pacing settings; only supplied fields change.
     *
     * @param patch - Partial settings to merge.
     * @returns The settings after the merge.
     */
    updateSettings(patch: Partial<IPriceHistorySettings>): Promise<IPriceHistorySettings>;

    /** Build the coverage snapshot for the admin page and live broadcasts. */
    getStats(): Promise<IPriceHistoryStats>;

    /**
     * Advance the backward backfill one bounded slice: seed any un-seeded asset's
     * dense recent window, then walk older days via the per-day source up to
     * `daysPerTick`, persisting the cursor after each clean write so a failed tick
     * resumes without re-fetching. Invoked by the scheduler and by a manual run.
     */
    runBackfillTick(): Promise<void>;

    /**
     * Append the most recent closed day for every tracked asset — the cheap daily
     * forward tick that keeps the series current once backfill has caught up.
     */
    runForwardTick(): Promise<void>;
}
