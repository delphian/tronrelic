/**
 * Frontend types for the Resource Markets plugin.
 *
 * These types define data structures used exclusively in the frontend portion
 * of the plugin. They supplement the shared types defined in the shared/types
 * directory which are used by both backend and frontend.
 */

/**
 * Historical pricing record for a market.
 *
 * Backend returns aggregated historical data in 6-hour buckets to reduce
 * payload size. Each record represents the minimum USDT transfer cost observed
 * during that time window, along with metadata about the aggregation.
 */
export interface MarketHistoryRecord {
    /** Timestamp when this historical record was recorded (ISO 8601 string) */
    recordedAt: string;

    /** Minimum cost in TRX to send 1 USDT transfer (65k energy) during this time window */
    minUsdtTransferCost: number | null;

    /** Optional: Number of data points aggregated into this bucket (e.g., how many 10-minute samples) */
    count?: number;

    /** Optional: Maximum cost during this time window (if backend provides range data) */
    maxUsdtTransferCost?: number | null;
}
