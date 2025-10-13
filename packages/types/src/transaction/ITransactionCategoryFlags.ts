/**
 * Categorizes transactions by their blockchain purpose.
 *
 * These flags enable efficient filtering and routing of transactions to specialized
 * observers without requiring deep inspection of transaction details. They're set
 * during initial transaction processing based on transaction type and thresholds.
 */
export interface ITransactionCategoryFlags {
    /** Transaction involves resource delegation (energy or bandwidth) */
    isDelegation: boolean;
    /** Transaction freezes or unfreezes TRX for staking */
    isStake: boolean;
    /** Transaction creates a new token or smart contract */
    isTokenCreation: boolean;
}
