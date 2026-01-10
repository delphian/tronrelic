/**
 * Aggregated resource delegation statistics for a block range.
 *
 * Block-based aggregation provides deterministic, verifiable summaries of delegation
 * activity. Each summation covers a fixed block range (default 300 blocks ≈ 5 minutes)
 * and includes both resource amounts (energy/bandwidth) and transaction counts.
 */
export interface ISummationData {
    /** ISO timestamp marking when this aggregation was created */
    timestamp: Date;
    /** First block number in this aggregation range (inclusive) */
    startBlock: number;
    /** Last block number in this aggregation range (inclusive) */
    endBlock: number;
    /** Total energy delegated in this block range (SUN, positive values only) */
    energyDelegated: number;
    /** Total energy reclaimed in this block range (SUN, positive values only) */
    energyReclaimed: number;
    /** Total bandwidth delegated in this block range (SUN, positive values only) */
    bandwidthDelegated: number;
    /** Total bandwidth reclaimed in this block range (SUN, positive values only) */
    bandwidthReclaimed: number;
    /** Net energy flow (energyDelegated - energyReclaimed) */
    netEnergy: number;
    /** Net bandwidth flow (bandwidthDelegated - bandwidthReclaimed) */
    netBandwidth: number;
    /** Total number of transactions in this block range */
    transactionCount: number;
    /** Number of delegation transactions (amountSun > 0) */
    totalTransactionsDelegated: number;
    /** Number of undelegate transactions (amountSun < 0) */
    totalTransactionsUndelegated: number;
    /** Net transaction count (delegated - undelegated) */
    totalTransactionsNet: number;
    /** Automatic timestamp when record created */
    createdAt: Date;
}
