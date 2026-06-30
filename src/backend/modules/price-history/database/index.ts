/**
 * @fileoverview Storage constants and document/row shapes for the price-history
 * module.
 *
 * Why centralized: the ClickHouse table name, the Mongo control collections, and
 * the row/doc shapes are referenced by the service, the provider projector, the
 * migration, and the tests. Declaring them once here keeps those call sites from
 * drifting — the same discipline the account-history module follows.
 */

import type { IPriceHistorySettings } from '@/types';

/** Mongo singleton holding pacing settings (`module_price-history_settings`). */
export const SETTINGS_COLLECTION = 'module_price-history_settings';

/** Mongo per-asset backfill cursor (`module_price-history_progress`). */
export const PROGRESS_COLLECTION = 'module_price-history_progress';

/** ClickHouse daily price series table. */
export const PRICE_TABLE = 'price_history';

/** Fixed key for the settings singleton document. */
export const SETTINGS_KEY = 'settings';

/** Source tag stored on rows fetched from CoinGecko. */
export const PRICE_SOURCE_COINGECKO = 'coingecko';

/**
 * Hard floor on how far back the deep backfill walks, as a guard against an
 * endless day-by-day walk when a provider keeps returning prices (e.g. a coin
 * listed near genesis). TRX has traded since 2017; ten years of headroom covers
 * every real account without unbounded fetching.
 */
export const MAX_BACKFILL_DAYS = 3650;

/**
 * Default pacing. `daysPerTick` is the variable cost (one CoinGecko call per day
 * walked) and is kept modest so a tick stays inside CoinGecko's free-tier rate
 * budget; `tokensPerTick` bounds how many distinct token assets advance per tick
 * so a burst of newly-discovered tokens cannot saturate the API.
 */
export const DEFAULT_SETTINGS: IPriceHistorySettings = {
    ingestionEnabled: true,
    daysPerTick: 30,
    tokensPerTick: 3
};

/**
 * Per-asset backfill cursor. Absolute day bounds plus two booleans capture the
 * two-phase strategy: `recentSeeded` flips once the dense recent window is filled
 * in one ranged call, and `backfillComplete` flips once the backward day-walk
 * reaches the asset's listing (a provider null) or the {@link MAX_BACKFILL_DAYS}
 * floor. A failed tick leaves the cursor at its last cleanly-written day so the
 * next tick resumes without re-fetching.
 */
export interface IPriceAssetProgressDoc {
    /** {@link import('@/types').PriceAsset} — `'TRX'` or a TRC20 contract address. */
    asset: string;
    /** True once the dense recent window has been seeded. */
    recentSeeded: boolean;
    /** Oldest UTC day (`YYYY-MM-DD`) cleanly written, or null before any write. */
    oldestDayFetched: string | null;
    /** Newest UTC day (`YYYY-MM-DD`) cleanly written, or null before any write. */
    newestDayFetched: string | null;
    /** True once backward backfill reached the listing or the lookback floor. */
    backfillComplete: boolean;
    /** Last cursor mutation, for least-recently-advanced selection. */
    updatedAt: Date;
}

/**
 * The settings singleton document. Mirrors {@link IPriceHistorySettings} plus the
 * fixed key and an audit timestamp.
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
    /** Source tag, e.g. {@link PRICE_SOURCE_COINGECKO}. */
    source: string;
    /** Version column (`DateTime64(3,'UTC')` formatted string). */
    fetched_at: string;
}
