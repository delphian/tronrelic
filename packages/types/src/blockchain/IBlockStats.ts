/**
 * Block-level statistics aggregated from transactions.
 * Provides summary metrics for a single blockchain block.
 */
export interface IBlockStats {
    /** Number of TRX transfer transactions */
    transfers: number;
    /** Number of smart contract calls */
    contractCalls: number;
    /** Number of resource delegation transactions */
    delegations: number;
    /** Number of staking transactions */
    stakes: number;
    /** Number of token creation transactions */
    tokenCreations: number;
    /** Number of internal transactions within smart contracts */
    internalTransactions: number;
    /** Total energy consumed by all transactions */
    totalEnergyUsed: number;
    /** Total energy cost in TRX */
    totalEnergyCost: number;
    /** Total bandwidth consumed by all transactions */
    totalBandwidthUsed: number;
}
