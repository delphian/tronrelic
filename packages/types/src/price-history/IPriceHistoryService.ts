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
 * (`IPriceHistoryProvider`, implemented per vendor) lives in the backend
 * providers module, never here, so the types package stays source-independent.
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
 * Pacing and routing settings for the backfill. The pacing dials are
 * throttle-down only — they bound work per tick so a deep historical backfill or
 * a burst of newly-discovered tokens cannot exceed an external source's rate
 * budget (a separate budget from the TronGrid limiter that protects block sync).
 * The two source lists are the routing policy: which configured price vendors
 * serve which asset class, in the order they are tried.
 */
export interface IPriceHistorySettings {
    /** Master switch; false parks all price ingestion without losing cursors. */
    ingestionEnabled: boolean;
    /**
     * Width, in days, of one deep-backfill range request. Each tick advances a
     * single asset by one chunk, so this is the variable cost per tick: a wider
     * chunk finishes a backfill in fewer ticks but asks the source for more per
     * call. It is also the widest gap a source may show inside its history before
     * the walk treats the empty chunk as the asset's listing date.
     */
    chunkDays: number;
    /** Max distinct token assets seeded per tick. */
    tokensPerTick: number;
    /**
     * Ordered vendor ids tried for the native TRX price. The first enabled
     * vendor that returns prices for a range wins; a vendor that is disabled or
     * has nothing for the asset is skipped.
     */
    trxSources: string[];
    /** Ordered vendor ids tried for TRC20 token prices; same semantics as `trxSources`. */
    tokenSources: string[];
}

/**
 * One price vendor as the routing settings see it: enough for an operator to
 * order the sources per asset class without leaving the price-history page.
 * Credentials and base URLs stay on the providers configuration surface.
 */
export interface IPriceSourceInfo {
    /** Stable vendor id, the value stored in `trxSources` / `tokenSources`. */
    id: string;
    /** Display name for the settings form. */
    label: string;
    /** Whether the vendor can serve the native TRX price. */
    supportsTrx: boolean;
    /** Whether the vendor can serve TRC20 token prices by contract address. */
    supportsTokens: boolean;
    /** Whether the operator has the vendor switched on in its configuration. */
    enabled: boolean;
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
    /**
     * Days the deep backfill still has to walk before reaching the lookback
     * floor — derived from the cursor, so an operator can estimate completion
     * (divide by `chunkDays` × tick cadence). 0 once complete; null before the
     * recent window is seeded (no cursor to measure from).
     */
    estimatedDaysRemaining: number | null;
    /** Vendor id that served the asset's most recent successful fetch, or null before any. */
    source: string | null;
    /**
     * Vendor-specific handle behind that fetch — a liquidity pool address for a
     * DEX source, a coin id for an aggregator — so an operator can check what a
     * price is actually being read from. Null when the vendor has no such handle.
     */
    sourceRef: string | null;
    /**
     * Consecutive fetches, in either the seed or the deep walk, that came back
     * without prices. The count drives a progressive retry backoff, and resets
     * to zero as soon as a fetch returns prices. A non-zero value means the
     * asset is waiting out that backoff rather than being worked on: with
     * `recentSeeded` false no source could price its recent window, and with
     * `recentSeeded` true a deep chunk was left unanswered while a source the
     * routing order names was switched off.
     */
    unpricedAttempts: number;
    /** ISO timestamp of the earliest moment the asset will be fetched again, or null when it is not parked. */
    nextAttemptAt: string | null;
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
        /**
         * Provider fetch calls attempted since this backend process started.
         * Paired with {@link providerErrors} it exposes the provider's error
         * rate; in-memory by design (a restart resets it) because the signal is
         * "is the provider healthy right now", not an audit trail.
         */
        providerCalls: number;
        /**
         * Provider fetch calls that failed since this backend process started.
         * A rising value warns of rate-limiting or an outage before coverage
         * visibly stalls.
         */
        providerErrors: number;
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

    /** Read current pacing and routing settings, seeded with defaults on first read. */
    getSettings(): Promise<IPriceHistorySettings>;

    /**
     * Merge settings; only supplied fields change.
     *
     * @param patch - Partial settings to merge.
     * @returns The settings after the merge.
     */
    updateSettings(patch: Partial<IPriceHistorySettings>): Promise<IPriceHistorySettings>;

    /**
     * List the price vendors the routing settings can choose from, with what
     * each can serve and whether it is currently switched on, so the settings
     * form offers only real options.
     */
    getPriceSources(): Promise<IPriceSourceInfo[]>;

    /** Build the coverage snapshot for the admin page and live broadcasts. */
    getStats(): Promise<IPriceHistoryStats>;

    /**
     * Clear one asset's backfill cursor so the next tick seeds it again from
     * scratch. Stored prices are kept (a re-fetch overwrites in place), so this is
     * safe to use after adding or re-ordering a price source, or when an asset
     * was recorded as unpriceable before a source that covers it existed.
     *
     * @param asset - The asset whose cursor to clear; must already be tracked.
     * @throws When the asset has no cursor, so a mistyped asset cannot be
     *   created as a tracked one.
     */
    resetAsset(asset: PriceAsset): Promise<void>;

    /**
     * Advance the backward backfill one bounded slice: seed any un-seeded asset's
     * dense recent window, then fetch one `chunkDays`-wide range of older days
     * for the least-recently-advanced asset, persisting the cursor after each
     * clean write so a failed tick resumes without re-fetching. Invoked by the
     * scheduler and by a manual run.
     */
    runBackfillTick(): Promise<void>;

    /**
     * Append the most recent closed day for every tracked asset — the cheap daily
     * forward tick that keeps the series current once backfill has caught up.
     */
    runForwardTick(): Promise<void>;
}
