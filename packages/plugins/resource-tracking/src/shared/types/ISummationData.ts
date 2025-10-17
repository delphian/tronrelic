/**
 * Aggregated resource delegation statistics for a time period.
 *
 * Rolled up every 10 minutes from individual transaction details to provide
 * trend analysis without retaining full transaction history. Energy and bandwidth
 * are tracked separately with both gross flows (delegated/reclaimed) and net totals.
 */
export interface ISummationData {
    /** ISO timestamp marking the start of this aggregation period */
    timestamp: Date;
    /** Total energy delegated in this period (SUN, positive values only) */
    energyDelegated: number;
    /** Total energy reclaimed in this period (SUN, positive values only) */
    energyReclaimed: number;
    /** Total bandwidth delegated in this period (SUN, positive values only) */
    bandwidthDelegated: number;
    /** Total bandwidth reclaimed in this period (SUN, positive values only) */
    bandwidthReclaimed: number;
    /** Net energy flow (energyDelegated - energyReclaimed) */
    netEnergy: number;
    /** Net bandwidth flow (bandwidthDelegated - bandwidthReclaimed) */
    netBandwidth: number;
    /** Number of delegation transactions in this period */
    transactionCount: number;
    /** Automatic timestamp when record created */
    createdAt: Date;
}
