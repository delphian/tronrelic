/**
 * @fileoverview One energy or bandwidth delegation involving a wallet.
 *
 * Delegations move no TRX, so they never appear among transfers; the address
 * page lists them separately so energy rentals to or from the wallet are
 * visible.
 */

import type { IAddressExplorerAmount } from './IAddressExplorerAmount.js';

/**
 * A delegation or undelegation the wallet made or received.
 */
export interface IAddressExplorerDelegation {
    /** Whether resources were delegated or taken back. */
    action: 'delegate' | 'undelegate';
    /** Block time, ISO 8601. */
    time: string;
    /** Block number. */
    block: number;
    /** The transaction id, hex. */
    txId: string;
    /** The address whose stake backs the delegation, base58. */
    delegator: string;
    /** The address that receives the resources, base58. */
    receiver: string;
    /** `ENERGY` or `BANDWIDTH`. */
    resource: string;
    /** The staked TRX behind the delegation; this is not an amount of energy. */
    stakedTrx: IAddressExplorerAmount;
    /** Delegations only: whether the delegator locked it for a period. */
    locked?: boolean;
    /** Delegations only: the lock period, or null when not locked. */
    lockPeriod?: { blocks: number; approxHours: number } | null;
    /** The permission slot on the delegator's account the transaction was signed under. */
    permissionId: number;
    /** The transaction's on-chain result. */
    status: string;
}
