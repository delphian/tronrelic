/**
 * Persistent cursor state for block-based summation aggregation.
 *
 * Tracks the last successfully processed block to enable deterministic,
 * resumable aggregation. The job uses this state to calculate the next
 * block range to process, ensuring no blocks are skipped or double-counted.
 */
export interface IAggregationState {
    /** Last block number successfully aggregated (endBlock of most recent summation) */
    lastProcessedBlock: number;
    /** Wall-clock timestamp when last aggregation completed (for monitoring only) */
    lastAggregationTime: Date;
}
