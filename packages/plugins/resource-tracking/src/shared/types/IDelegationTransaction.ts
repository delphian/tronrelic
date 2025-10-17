/**
 * Stored delegation transaction with full TronGrid details.
 *
 * Captures both delegation and reclaim operations with complete context
 * from the TRON blockchain. Amount fields use positive values for delegations
 * and negative values for reclaims to simplify aggregation logic.
 */
export interface IDelegationTransaction {
    /** Unique transaction hash from TRON blockchain */
    txId: string;
    /** Transaction timestamp from blockchain */
    timestamp: Date;
    /** Sender address (owner delegating resources) */
    fromAddress: string;
    /** Receiver address (beneficiary receiving delegated resources) */
    toAddress: string;
    /** Resource type: 0 = BANDWIDTH, 1 = ENERGY */
    resourceType: 0 | 1;
    /** Amount in SUN (positive for delegate, negative for reclaim) */
    amountSun: number;
    /** Whether the delegation is locked (true) or flexible (false) */
    locked: boolean;
    /** Lock period in seconds (only applies if locked is true) */
    lockPeriod?: number;
    /** Block number where transaction occurred */
    blockNumber: number;
    /** Automatic timestamp when record created */
    createdAt: Date;
}
