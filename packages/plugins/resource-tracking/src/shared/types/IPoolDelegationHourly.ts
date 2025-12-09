/**
 * Hourly aggregated pool delegation data for long-term trend analysis.
 *
 * Each document represents one hour of delegation activity for a single pool,
 * enabling historical pool volume charts without requiring raw transaction data.
 * Aggregated during the purge job before raw pool-delegations are pruned.
 *
 * Matches the structure of the old system's rm_delegation_hourly_volume table,
 * extended to support per-pool granularity rather than global network totals.
 */
export interface IPoolDelegationHourly {
    /**
     * Composite key: "YYYY-MM-DD HH:poolAddress" for upsert operations.
     * Example: "2024-01-15 14:TGNuLPkkgsf42xdRSXYpVSqUvtFT4HEupg"
     */
    hourKey: string;

    /**
     * Hour start as ISO date string "YYYY-MM-DD HH" for display.
     * Example: "2024-01-15 14"
     */
    dateHour: string;

    /**
     * Unix timestamp (seconds) of the hour start for time-range queries.
     */
    timestamp: number;

    /**
     * Pool address this aggregation belongs to.
     * Null for global network totals (optional future use).
     */
    poolAddress: string | null;

    /**
     * Resource type: 0 = BANDWIDTH, 1 = ENERGY
     */
    resourceType: 0 | 1;

    /**
     * Total delegated amount in TRX for this hour.
     */
    totalAmountTrx: number;

    /**
     * Total normalized amount (accounting for rental duration) in TRX.
     * A 7-day rental contributes 7x its TRX value due to energy regeneration.
     */
    totalNormalizedAmountTrx: number;

    /**
     * Number of delegation transactions in this hour.
     */
    delegationCount: number;

    /**
     * Number of unique delegator addresses in this hour.
     */
    uniqueDelegators: number;

    /**
     * Number of unique recipient addresses in this hour.
     */
    uniqueRecipients: number;

    /**
     * When this aggregation was created or last updated.
     */
    createdAt?: Date;
}
