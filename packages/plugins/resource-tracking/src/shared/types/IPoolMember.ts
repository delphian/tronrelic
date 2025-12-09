/**
 * Pool membership record mapping delegator accounts to controlling pools.
 *
 * When a delegation transaction with Permission_id >= 3 is observed, the system
 * checks if we know which pool controls the delegator address. If unknown, it
 * fetches account permissions from TronGrid and extracts pool addresses from
 * the active_permission[].keys[].address fields.
 *
 * This organic discovery means pool memberships are learned over time as
 * delegation activity is observed, rather than requiring seed data.
 */
export interface IPoolMember {
    /** Delegator address (the staker's wallet) */
    account: string;
    /** Pool address that has permission to control this account */
    pool: string;
    /** Permission ID granting the pool control (typically 3+) */
    permissionId: number;
    /** Permission name from TronGrid (e.g., "TronLending", "EnergyPool") */
    permissionName: string;
    /** True if account === pool (user delegating with their own custom permission) */
    selfSigned: boolean;
    /** When this membership was first discovered */
    discoveredAt: Date;
    /** Last time delegation activity was seen from this account */
    lastSeenAt: Date;
}
