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
}
