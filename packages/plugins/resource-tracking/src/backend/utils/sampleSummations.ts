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
 * Aggregates summation records into a smaller number of evenly-distributed data points.
 *
 * This function implements intelligent downsampling when the number of database records
 * exceeds the requested point count. It divides records into buckets and aggregates each
 * bucket by:
 *
 * - **Summing** all resource amounts (energyDelegated, energyReclaimed, bandwidth, etc.)
 * - **Summing** all transaction counts
 * - **Recalculating** net values from summed components
 * - **Averaging** timestamps to the midpoint of the bucket
 * - **Spanning** block ranges from first startBlock to last endBlock in the bucket
 *
 * When `requestedPoints >= records.length`, no sampling is applied and all records
 * are returned as-is with metadata indicating no aggregation occurred.
 *
 * **Performance:** O(n) where n is the number of input records. Single-pass iteration
 * with in-place aggregation for optimal memory usage.
 *
 * @param records - Array of summation data from the database (must be sorted by timestamp)
 * @param requestedPoints - Desired number of data points to return (typically 288)
 * @returns Sampled data with metadata about the aggregation operation
 *
 * @example
 * ```typescript
 * // Aggregate 1,000 database records into 288 display points
 * const summations = await fetchSummationsFromDB(startDate, endDate);
 * const result = sampleSummations(summations, 288);
 *
 * console.log(result.metadata.samplingApplied); // true
 * console.log(result.metadata.recordsPerPoint);  // ~3.47 (1000 / 288)
 * console.log(result.data.length);               // 288
 *
 * // Each point in result.data represents ~3.47 original records summed together
 * ```
 *
 * @example
 * ```typescript
 * // No sampling needed when records <= requestedPoints
 * const summations = await fetchSummationsFromDB(startDate, endDate);
 * const result = sampleSummations(summations, 500); // Only 100 records exist
 *
 * console.log(result.metadata.samplingApplied);     // false
 * console.log(result.metadata.recordsPerPoint);     // 1.0
 * console.log(result.data.length);                  // 100 (all original records)
 * ```
 */
export function sampleSummations(
    records: ISummationData[],
    requestedPoints: number
): SampledResult {
    const totalRecords = records.length;

    // No sampling needed when we have fewer records than requested points
    if (requestedPoints >= totalRecords) {
        return {
            data: records,
            metadata: {
                requestedPoints,
                actualPoints: totalRecords,
                recordsPerPoint: totalRecords > 0 ? 1.0 : 0,
                samplingApplied: false,
                totalRecordsInDatabase: totalRecords,
            },
        };
    }

    // Calculate bucket size - how many records to aggregate per point
    const bucketSize = Math.ceil(totalRecords / requestedPoints);
    const sampledData: ISummationData[] = [];

    // Process records in buckets
    for (let i = 0; i < totalRecords; i += bucketSize) {
        const bucketEnd = Math.min(i + bucketSize, totalRecords);
        const bucket = records.slice(i, bucketEnd);

        // Aggregate bucket into single point
        const aggregated = aggregateBucket(bucket);
        sampledData.push(aggregated);
    }

    return {
        data: sampledData,
        metadata: {
            requestedPoints,
            actualPoints: sampledData.length,
            recordsPerPoint: totalRecords / sampledData.length,
            samplingApplied: true,
            totalRecordsInDatabase: totalRecords,
        },
    };
}

/**
 * Aggregates a bucket of summation records into a single data point.
 *
 * Implements the aggregation logic for combining multiple consecutive summation
 * records into one point by summing amounts, averaging timestamps, and spanning
 * block ranges. This is the core transformation applied during downsampling.
 *
 * **Aggregation rules:**
 * - Resource amounts (SUN): Sum all values
 * - Transaction counts: Sum all values
 * - Net values: Recalculated from summed components
 * - Timestamp: Midpoint (average) of all timestamps in bucket
 * - Block range: First startBlock to last endBlock in bucket
 *
 * @param bucket - Array of consecutive summation records to aggregate
 * @returns Single aggregated summation data point
 *
 * @throws Error if bucket is empty (caller should validate)
 */
function aggregateBucket(bucket: ISummationData[]): ISummationData {
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

    // Calculate midpoint timestamp
    const avgTimestamp = new Date(timestampSum / bucket.length);

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
        timestamp: avgTimestamp,
        startBlock,
        endBlock,
        createdAt: new Date(), // Set to current time for aggregated records
    };
}
