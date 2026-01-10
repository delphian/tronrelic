import { ISummationData } from '../../shared/types/ISummationData.js';
import { ISummationMetadata } from '../../shared/types/api.js';
/**
 * Result of sampling operation containing aggregated data and metadata.
 *
 * Returned by `sampleSummations` to provide both the sampled data points
 * and transparency about the aggregation operation performed.
 */
export interface SampledResult {
    /**
     * Array of aggregated summation data points.
     *
     * When sampling is applied, each point represents multiple database records
     * summed together. When no sampling is needed, this is the original input array.
     */
    data: ISummationData[];
    /**
     * Metadata describing the sampling operation.
     *
     * Includes statistics about how many records were aggregated per point,
     * whether sampling occurred, and the original record count.
     */
    metadata: ISummationMetadata;
}
/**
 * Maps summation records into evenly-distributed time buckets across a fixed date range.
 *
 * This function implements time-based bucketing to prevent data cramping when sparse records
 * exist for a long time period. Instead of aggregating records sequentially, it:
 *
 * 1. **Generates evenly-spaced time buckets** across the full date range (startDate to endDate)
 * 2. **Maps records into buckets** based on their timestamps
 * 3. **Aggregates records within each bucket** by summing amounts and transaction counts
 * 4. **Returns null for empty buckets** to create gaps in the chart
 *
 * This prevents the "cramping" issue where sparse data (e.g., 10 records for 7 days) appears
 * compressed into a small X-axis range. Instead, records appear at their actual timestamps
 * with the X-axis spanning the full requested period.
 *
 * **Performance:** O(n + m) where n is input records and m is requested points.
 * Single-pass bucketing with in-place aggregation for optimal memory usage.
 *
 * @param records - Array of summation data from the database (must be sorted by timestamp)
 * @param requestedPoints - Number of evenly-distributed time buckets to create (typically 288)
 * @param startDate - Start of the time range (determines first bucket timestamp)
 * @param endDate - End of the time range (determines last bucket timestamp)
 * @returns Sampled data with metadata about the bucketing operation
 *
 * @example
 * ```typescript
 * // Map 10 sparse records across 7 days into 288 time buckets
 * const now = new Date();
 * const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
 * const summations = await fetchSummationsFromDB(weekAgo, now); // Returns 10 records
 * const result = sampleSummations(summations, 288, weekAgo, now);
 *
 * console.log(result.data.length);                  // 288 (fixed)
 * console.log(result.data.filter(d => d !== null).length); // 10 (non-null buckets)
 * console.log(result.metadata.bucketsWithData);     // 10
 * console.log(result.metadata.bucketsWithoutData);  // 278
 *
 * // Chart now spans full 7 days with data appearing at actual timestamps
 * ```
 *
 * @example
 * ```typescript
 * // Dense data scenario - multiple records per bucket
 * const summations = await fetchSummationsFromDB(startDate, endDate); // 1000 records
 * const result = sampleSummations(summations, 288, startDate, endDate);
 *
 * console.log(result.metadata.bucketsWithData);     // 288 (all buckets have data)
 * console.log(result.metadata.recordsPerBucket);    // ~3.47 average (1000 / 288)
 * ```
 */
export declare function sampleSummations(records: ISummationData[], requestedPoints: number, startDate: Date, endDate: Date): SampledResult;
//# sourceMappingURL=sampleSummations.d.ts.map