/**
 * Whale transaction aggregation result for timeseries.
 */
export interface IWhaleTimeseriesPoint {
    /** Date string (YYYY-MM-DD) */
    date: string;

    /** Total TRX volume for this date */
    volume: number;

    /** Maximum single transaction amount */
    max: number;

    /** Number of whale transactions */
    count: number;
}
