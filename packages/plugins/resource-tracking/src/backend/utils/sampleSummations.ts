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
export function sampleSummations(
    records: ISummationData[],
    requestedPoints: number,
    startDate: Date,
    endDate: Date
): SampledResult {
    const totalRecords = records.length;

    // Edge case: no records - return empty array
    if (totalRecords === 0 || requestedPoints <= 0) {
        return {
            data: [],
            metadata: {
                requestedPoints,
                actualPoints: 0,
                recordsPerPoint: 0,
                samplingApplied: false,
                totalRecordsInDatabase: totalRecords,
            },
        };
    }

    // Calculate time range and bucket width
    const timeRangeMs = endDate.getTime() - startDate.getTime();
    const bucketWidthMs = timeRangeMs / requestedPoints;

    // Create buckets as a map: bucketIndex -> records in that bucket
    const bucketMap = new Map<number, ISummationData[]>();

    // Map each record into its appropriate time bucket
    for (const record of records) {
        const recordTime = new Date(record.timestamp).getTime();

        // Calculate which bucket this record belongs to
        const timeSinceStart = recordTime - startDate.getTime();
        const bucketIndex = Math.floor(timeSinceStart / bucketWidthMs);

        // Clamp to valid bucket range (handle edge cases where record is slightly outside range)
        const clampedIndex = Math.max(0, Math.min(requestedPoints - 1, bucketIndex));

        // Add record to bucket
        if (!bucketMap.has(clampedIndex)) {
            bucketMap.set(clampedIndex, []);
        }
        bucketMap.get(clampedIndex)!.push(record);
    }

    // Generate all buckets with evenly-distributed timestamps
    const sampledData: (ISummationData | null)[] = [];
    let bucketsWithData = 0;

    for (let i = 0; i < requestedPoints; i++) {
        // Calculate timestamp for this bucket (midpoint of the bucket's time range)
        const bucketStartTime = startDate.getTime() + (i * bucketWidthMs);
        const bucketMidTime = bucketStartTime + (bucketWidthMs / 2);
        const bucketTimestamp = new Date(bucketMidTime);

        const recordsInBucket = bucketMap.get(i);

        if (recordsInBucket && recordsInBucket.length > 0) {
            // Bucket has data - aggregate it
            const aggregated = aggregateBucket(recordsInBucket, bucketTimestamp);
            sampledData.push(aggregated);
            bucketsWithData++;
        } else {
            // Bucket is empty - insert null to create gap in chart
            sampledData.push(null);
        }
    }

    const bucketsWithoutData = requestedPoints - bucketsWithData;
    const recordsPerBucket = bucketsWithData > 0 ? totalRecords / bucketsWithData : 0;

    return {
        data: sampledData as any, // TypeScript doesn't know we're mixing null and ISummationData
        metadata: {
            requestedPoints,
            actualPoints: bucketsWithData,
            recordsPerPoint: recordsPerBucket,
            samplingApplied: true,
            totalRecordsInDatabase: totalRecords,
        },
    };
}

/**
 * Aggregates a bucket of summation records into a single data point.
 *
 * Implements the aggregation logic for combining multiple summation records into one point
 * by summing amounts, optionally using a fixed timestamp, and spanning block ranges. This
 * is the core transformation applied during time-based bucketing.
 *
 * **Aggregation rules:**
 * - Resource amounts (SUN): Sum all values
 * - Transaction counts: Sum all values
 * - Net values: Recalculated from summed components
 * - Timestamp: Uses provided timestamp (for evenly-spaced buckets), or averages records' timestamps
 * - Block range: First startBlock to last endBlock in bucket
 *
 * @param bucket - Array of summation records to aggregate
 * @param fixedTimestamp - Optional fixed timestamp for this bucket (for evenly-spaced output)
 * @returns Single aggregated summation data point
 *
 * @throws Error if bucket is empty (caller should validate)
 */
function aggregateBucket(bucket: ISummationData[], fixedTimestamp?: Date): ISummationData {
    if (bucket.length === 0) {
        throw new Error('Cannot aggregate empty bucket');
    }

    // Single record - return as-is
    if (bucket.length === 1) {
        return bucket[0];
    }

    // Initialize aggregated values
    let energyDelegated = 0;
    let energyReclaimed = 0;
    let bandwidthDelegated = 0;
    let bandwidthReclaimed = 0;
    let transactionCount = 0;
    let totalTransactionsDelegated = 0;
    let totalTransactionsUndelegated = 0;
    let timestampSum = 0;

    // Accumulate sums across all records in bucket
    for (const record of bucket) {
        energyDelegated += record.energyDelegated;
        energyReclaimed += record.energyReclaimed;
        bandwidthDelegated += record.bandwidthDelegated;
        bandwidthReclaimed += record.bandwidthReclaimed;
        transactionCount += record.transactionCount;
        totalTransactionsDelegated += record.totalTransactionsDelegated;
        totalTransactionsUndelegated += record.totalTransactionsUndelegated;
        timestampSum += new Date(record.timestamp).getTime();
    }

    // Calculate net values from summed components
    const netEnergy = energyDelegated - energyReclaimed;
    const netBandwidth = bandwidthDelegated - bandwidthReclaimed;
    const totalTransactionsNet = totalTransactionsDelegated - totalTransactionsUndelegated;

    // Use fixed timestamp if provided, otherwise calculate midpoint from records
    const timestamp = fixedTimestamp ?? new Date(timestampSum / bucket.length);

    // Span block range across entire bucket
    const startBlock = bucket[0].startBlock;
    const endBlock = bucket[bucket.length - 1].endBlock;

    return {
        energyDelegated,
        energyReclaimed,
        netEnergy,
        bandwidthDelegated,
        bandwidthReclaimed,
        netBandwidth,
        transactionCount,
        totalTransactionsDelegated,
        totalTransactionsUndelegated,
        totalTransactionsNet,
        timestamp,
        startBlock,
        endBlock,
        createdAt: new Date(), // Set to current time for aggregated records
    };
}
