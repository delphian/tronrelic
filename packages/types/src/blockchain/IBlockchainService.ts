import type { IBlock } from './IBlock.js';

/**
 * Timeseries data point for transaction volume charts.
 */
export interface ITransactionTimeseriesPoint {
    /** ISO 8601 timestamp for this data point */
    date: string;
    /** Total transactions in this time window */
    transactions: number;
    /** Average transactions per block in this window */
    avgPerBlock: number;
}

/**
 * Window selector for the network-activity overview series.
 *
 * Matches the 1h/24h/7d controls the sibling chart widgets expose so the
 * core overview widget offers the same operator-facing window vocabulary.
 * `1h` buckets per minute (60 points); `24h` and `7d` bucket per hour (24
 * and 168 points respectively).
 */
export type OverviewTimeseriesWindow = '1h' | '24h' | '7d';

/**
 * One bucket of the network-activity overview series.
 *
 * Carries all three toggle-able metrics for a single time bucket so the
 * widget switches between them client-side without a refetch. `transactions`
 * and `transfers` are block-level counts (every contract type vs. native
 * `TransferContract` only); `volume` is the summed native TRX moved by those
 * transfers (TRC20/USDT value is not denominated in TRX and is excluded).
 */
export interface IOverviewTimeseriesPoint {
    /** ISO 8601 timestamp marking the start of this bucket. */
    date: string;
    /** Total transactions of every contract type in the bucket. */
    transactions: number;
    /** Native `TransferContract` transfers in the bucket. */
    transfers: number;
    /** Summed native TRX moved by `TransferContract` transfers in the bucket. */
    volume: number;
}

/**
 * Blockchain service interface for plugins.
 *
 * Provides read-only access to blockchain sync state and processed block data.
 * Plugins use this to query the most recently processed block, retrieve recent
 * transactions, and access timeseries data for charting.
 *
 * This interface exposes only safe, read-only methods. Internal sync operations
 * like block processing and queue management are not exposed to plugins.
 */
export interface IBlockchainService {
    /**
     * Retrieve the most recently processed block from the database.
     * Returns block summary with transaction count and statistics.
     * Returns null if no blocks have been processed yet.
     */
    getLatestBlock(): Promise<IBlock | null>;

    /**
     * Retrieve transaction count timeseries data grouped by time windows.
     *
     * Aggregates historical block data to produce time-windowed transaction
     * statistics for charting. Grouping granularity adjusts based on range:
     * - 1 day: 30-minute buckets
     * - 7 days: hourly buckets
     * - 30+ days: 4-hour windows
     *
     * @param days - Number of days of history (min 1, max 90)
     * @returns Array of timeseries points sorted chronologically
     */
    getTransactionTimeseries(days: number): Promise<ITransactionTimeseriesPoint[]>;

    /**
     * Count transactions by contract type within a time range.
     *
     * Queries the core transactions collection for total count matching
     * the specified contract type and timestamp range. Used by plugins
     * for calculating percentages against total network activity.
     *
     * @param contractType - Transaction type (e.g., 'TransferContract', 'TriggerSmartContract')
     * @param start - Start of time range (inclusive)
     * @param end - End of time range (exclusive)
     * @returns Count of matching transactions
     */
    countTransactionsByType(contractType: string, start: Date, end: Date): Promise<number>;

    /**
     * Retrieve the combined network-activity overview series for a window.
     *
     * Powers the core `core:network-activity` widget. Each point carries the
     * transaction count, native-transfer count, and native TRX transfer volume
     * for one time bucket, so the widget toggles between the three metrics
     * client-side. Counts come from the `blocks` collection; volume sums
     * `amountTRX` over `TransferContract` rows in the `transactions` collection.
     *
     * @param window - `1h` (minute buckets), `24h` or `7d` (hourly buckets).
     * @returns Buckets sorted chronologically.
     */
    getOverviewTimeseries(window: OverviewTimeseriesWindow): Promise<IOverviewTimeseriesPoint[]>;
}
