/**
 * Whale delegation transaction record.
 *
 * Stores high-value resource delegations that exceed the configured threshold.
 * These records are kept separately from regular delegation transactions to
 * enable specialized whale tracking, pattern detection, and market intelligence.
 *
 * Whale delegations reveal institutional activity, large-scale energy rental
 * operations, and market-moving resource allocation patterns on the TRON network.
 */
export interface IWhaleDelegation {
    /**
     * Unique transaction hash from TRON blockchain.
     * Used to prevent duplicate storage and link to blockchain explorer.
     */
    txId: string;

    /**
     * Transaction timestamp from blockchain.
     * Reflects when the delegation transaction was confirmed on-chain.
     */
    timestamp: Date;

    /**
     * Sender address (resource owner delegating resources).
     * The whale address providing energy or bandwidth.
     */
    fromAddress: string;

    /**
     * Receiver address (beneficiary receiving delegated resources).
     * The address that will be able to use the delegated resources.
     */
    toAddress: string;

    /**
     * Type of resource being delegated.
     * - 0 = BANDWIDTH (for transaction fees)
     * - 1 = ENERGY (for smart contract execution)
     */
    resourceType: 0 | 1;

    /**
     * Delegation amount in SUN (precise storage).
     * Stored in SUN (1 TRX = 1,000,000 SUN) for precision in calculations.
     * Always positive (use transaction type to determine delegation vs reclaim).
     */
    amountSun: number;

    /**
     * Delegation amount in TRX (user-friendly display).
     * Converted from SUN for human-readable presentation.
     * Calculated as: amountSun / 1,000,000
     */
    amountTrx: number;

    /**
     * Block number where transaction occurred.
     * Used for block-range queries and blockchain sync correlation.
     */
    blockNumber: number;

    /**
     * Record creation timestamp (database insertion time).
     * Automatic timestamp when whale record is created.
     * Different from transaction timestamp (which is blockchain time).
     */
    createdAt: Date;
}
