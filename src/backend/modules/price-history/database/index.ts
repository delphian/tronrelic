/**
 * @fileoverview Storage constants and document/row shapes for the price-history
 * module.
 *
 * Why centralized: the ClickHouse table name, the Mongo control collections, and
 * the row/doc shapes are referenced by the service, the migrations, and the
 * tests. Declaring them once here keeps those call sites from drifting — the
 * same discipline the account-history module follows.
 */

import type { IPriceHistorySettings } from '@/types';

/** Mongo singleton holding pacing and routing settings (`module_price-history_settings`). */
export const SETTINGS_COLLECTION = 'module_price-history_settings';

/** Mongo per-asset backfill cursor (`module_price-history_progress`). */
export const PROGRESS_COLLECTION = 'module_price-history_progress';

/** ClickHouse daily price series table. */
export const PRICE_TABLE = 'price_history';

/** Fixed key for the settings singleton document. */
export const SETTINGS_KEY = 'settings';

/**
 * Hard floor on how far back the deep backfill walks, as a guard against an
 * endless walk when a vendor keeps returning prices (e.g. a coin listed near
 * genesis). TRX has traded since 2017; ten years of headroom covers every real
 * account without unbounded fetching.
 */
export const MAX_BACKFILL_DAYS = 3650;

/**
 * Default pacing and routing. `chunkDays` is the variable cost (one ranged
 * vendor call per tick covers this many days) and starts at a year so a
 * multi-year backfill completes in a handful of ticks; `tokensPerTick` bounds
 * how many distinct token assets are seeded per tick so a burst of
 * newly-discovered tokens cannot saturate a vendor's rate budget. The source
 * lists name the vendors tried in order: TronScan first for TRX because it has
 * no history wall, CoinGecko first for tokens because an aggregator price beats
 * a single pool's, with GeckoTerminal covering the long tail no aggregator lists.
 */
export const DEFAULT_SETTINGS: IPriceHistorySettings = {
    ingestionEnabled: true,
    chunkDays: 365,
    tokensPerTick: 3,
    trxSources: ['tronscan', 'coingecko'],
    tokenSources: ['coingecko', 'geckoterminal']
};

/**
 * Per-asset backfill cursor. Absolute day bounds plus two booleans capture the
 * two-phase strategy: `recentSeeded` flips once the dense recent window is
 * filled in one ranged call, and `backfillComplete` flips once the backward
 * chunk walk reaches the asset's listing (an empty chunk) or the
 * {@link MAX_BACKFILL_DAYS} floor. A failed tick leaves the cursor at its last
 * cleanly-written day so the next tick resumes without re-fetching.
 *
 * A fetch that finds no prices, in either phase, parks the asset rather than
 * recording the answer as final: `unpricedAttempts` counts the consecutive
 * attempts that came back without prices and `nextAttemptAt` holds the asset
 * until the progressive backoff (`lib/retry-backoff.ts`) allows another try.
 * Both reset to nothing once a fetch returns prices. This is what lets a
 * vendor added or enabled later pick the asset up without an operator having
 * to find and clear the cursor by hand.
 *
 * A fetch that fails outright, with every vendor asked returning an error,
 * leaves the day bounds alone but is counted in `failedAttempts` and holds the
 * asset through `nextAttemptAt` on the shorter failure schedule. Without that,
 * the failing asset stayed due and least-recently-updated, so every tick asked
 * the same vendors again and no other asset's deep walk could advance.
 */
export interface IPriceAssetProgressDoc {
    /** {@link import('@/types').PriceAsset} — `'TRX'` or a TRC20 contract address. */
    asset: string;
    /** True once the dense recent window has been seeded with at least one price. */
    recentSeeded: boolean;
    /** Oldest UTC day (`YYYY-MM-DD`) cleanly written, or null before any write. */
    oldestDayFetched: string | null;
    /** Newest UTC day (`YYYY-MM-DD`) cleanly written, or null before any write. */
    newestDayFetched: string | null;
    /** True once backward backfill reached the listing or the lookback floor. */
    backfillComplete: boolean;
    /** Vendor id that served the most recent successful fetch, or null. */
    source: string | null;
    /** Vendor-specific handle behind that fetch (pool address, coin id), or null. */
    sourceRef: string | null;
    /** Consecutive seed or deep-walk attempts that found no prices; 0 once a fetch returns some. */
    unpricedAttempts: number;
    /** Consecutive seed or deep-walk fetches that failed with vendor errors; 0 once a fetch gets any answer. */
    failedAttempts: number;
    /** Earliest time the asset may be fetched again after an unpriced or failed attempt, or null when not held. */
    nextAttemptAt: Date | null;
    /** Last cursor mutation, for least-recently-advanced selection. */
    updatedAt: Date;
}

/**
 * The settings singleton document. Mirrors {@link IPriceHistorySettings} plus the
 * fixed key and an audit timestamp. Older documents may still carry the retired
 * `daysPerTick` field; the service ignores it and reads `chunkDays`.
 */
export interface IPriceHistorySettingsDoc extends IPriceHistorySettings {
    /** Always {@link SETTINGS_KEY}. */
    key: string;
    /** Last settings mutation. */
    updatedAt: Date;
}

/**
 * One row of the ClickHouse `price_history` table. Columns are flat scalars so
 * the table joins cheaply to the account-history ledger on `day`. `day` is a bare
 * `YYYY-MM-DD` string (ClickHouse `Date`); `fetched_at` is the ReplacingMergeTree
 * version column so a re-fetch of the same `(asset, day)` overwrites in place.
 */
export interface IPriceHistoryRow extends Record<string, unknown> {
    /** The priced asset. */
    asset: string;
    /** UTC calendar day, `YYYY-MM-DD`. */
    day: string;
    /** Closing USD price. */
    price_usd: number;
    /** Vendor id the price came from, e.g. `tronscan`. */
    source: string;
    /** Version column (`DateTime64(3,'UTC')` formatted string). */
    fetched_at: string;
}
