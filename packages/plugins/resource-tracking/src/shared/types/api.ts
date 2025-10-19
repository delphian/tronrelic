import { ISummationData } from './ISummationData.js';

/**
 * Metadata about data sampling applied to summation query results.
 *
 * Provides transparency when the backend aggregates multiple database records
 * into fewer display points to reduce payload size and improve frontend
 * rendering performance. Includes statistics about the sampling operation
 * to help users understand data density and facilitate debugging.
 */
export interface ISummationMetadata {
    /**
     * Number of data points requested by the client.
     *
     * This is the `points` query parameter value. Defaults to 288 if not specified.
     *
     * @example 288 // Request 288 evenly-distributed points
     */
    requestedPoints: number;

    /**
     * Number of data points actually returned in the response.
     *
     * May be less than `requestedPoints` if insufficient data exists in the database.
     * Will equal `requestedPoints` when sampling is applied.
     * Will equal `totalRecordsInDatabase` when no sampling is needed.
     *
     * @example 250 // Returned 250 points (fewer than requested due to data availability)
     */
    actualPoints: number;

    /**
     * Average number of database records aggregated into each returned point.
     *
     * Calculated as `totalRecordsInDatabase / actualPoints`.
     * Value of 1.0 means no aggregation occurred (one-to-one mapping).
     * Value > 1.0 indicates multiple records were summed per point.
     *
     * @example 3.2 // Each point represents ~3.2 original database records
     */
    recordsPerPoint: number;

    /**
     * Whether data sampling (aggregation) was applied to reduce point count.
     *
     * `true` when `totalRecordsInDatabase > requestedPoints` (aggregation occurred).
     * `false` when all database records returned as-is (no aggregation needed).
     *
     * @example true // Data was aggregated into fewer points
     */
    samplingApplied: boolean;

    /**
     * Total number of summation records found in the database for the query period.
     *
     * Represents the raw record count before any sampling/aggregation.
     * Used to calculate `recordsPerPoint` and determine if sampling is needed.
     *
     * @example 1250 // Query returned 1,250 database records before sampling
     */
    totalRecordsInDatabase: number;
}

/**
 * API response structure for summation data queries with optional sampling.
 *
 * Wraps summation data points with metadata about the sampling operation.
 * The backend may aggregate multiple database records into fewer points when
 * `requestedPoints < totalRecordsInDatabase` to optimize payload size and
 * frontend rendering performance.
 *
 * @example
 * ```typescript
 * // Request 288 points for 7-day period
 * const response = await fetch('/api/plugins/resource-tracking/summations?period=7d&points=288');
 * const json: ISummationResponse = await response.json();
 *
 * if (json.success) {
 *   console.log(`Displaying ${json.metadata.actualPoints} points`);
 *   console.log(`Each point averages ${json.metadata.recordsPerPoint.toFixed(1)} records`);
 *   renderChart(json.data);
 * }
 * ```
 */
export interface ISummationResponse {
    /**
     * Whether the API request succeeded without errors.
     *
     * `true` indicates successful data retrieval and processing.
     * `false` indicates an error occurred (check error message in response).
     */
    success: boolean;

    /**
     * Array of summation data points, potentially sampled/aggregated.
     *
     * When sampling is applied (`metadata.samplingApplied === true`), each point
     * represents the sum of multiple database records aggregated into a single
     * time bucket. Resource amounts and transaction counts are summed, timestamps
     * are averaged to the midpoint, and block ranges span the full aggregated range.
     *
     * When no sampling is needed, this is the raw database query result.
     */
    data: ISummationData[];

    /**
     * Metadata about the sampling operation and data characteristics.
     *
     * Provides transparency about how many records were aggregated, whether
     * sampling occurred, and statistics to help interpret the data density.
     */
    metadata: ISummationMetadata;
}
