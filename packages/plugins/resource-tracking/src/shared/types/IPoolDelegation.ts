/**
 * Pool-controlled delegation transaction record.
 *
 * Captures delegations executed by energy rental pools (Permission_id >= 3).
 * These transactions are distinguished from direct user delegations because
 * they are authorized by custom permissions granted to pool addresses.
 *
 * The poolAddress field is discovered by fetching account permissions from
 * TronGrid and extracting the controlling pool from active_permission keys.
 */
export interface IPoolDelegation {
    /** Unique transaction hash from TRON blockchain */
    txId: string;
    /** Transaction timestamp from blockchain */
    timestamp: Date;
    /** Block number where transaction occurred */
    blockNumber: number;
    /** Delegator address (staker's wallet controlled by pool) */
    fromAddress: string;
    /** Recipient address (energy renter) */
    toAddress: string;
    /** Pool address that controls the fromAddress (discovered from permissions) */
    poolAddress: string | null;
    /** Resource type: 0 = BANDWIDTH, 1 = ENERGY */
    resourceType: 0 | 1;
    /** Amount in SUN (positive for delegate, negative for reclaim) */
    amountSun: number;
    /** Permission ID used to authorize this transaction (>= 3 for pool control) */
    permissionId: number;
    /** Lock period in blocks (TRON block time is 3 seconds) */
    lockPeriod?: number;
    /** Rental duration in minutes (lockPeriod * 3 / 60) */
    rentalPeriodMinutes?: number;
    /** Normalized amount accounting for rental duration (amountTRX * durationDays) */
    normalizedAmountTrx?: number;
    /** Automatic timestamp when record created */
    createdAt?: Date;
}
