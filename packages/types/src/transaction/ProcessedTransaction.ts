import type { ITransaction } from './ITransaction.js';
import type { ITransactionPersistencePayload } from './ITransactionPersistencePayload.js';
import type { ITransactionCategoryFlags } from './ITransactionCategoryFlags.js';

/**
 * Transaction category threshold configuration.
 *
 * These thresholds determine when a transaction qualifies for special categorization.
 * They should be passed from the backend's blockchainConfig to ensure consistency.
 */
export interface TransactionCategoryThresholds {
    /** Minimum TRX amount to qualify as a delegation transaction */
    delegationAmountTRX: number;
    /** Minimum TRX amount to qualify as a stake transaction */
    stakeAmountTRX: number;
}

/**
 * Enriched transaction model with category detection methods.
 *
 * This class wraps the ITransaction interface and provides convenience methods
 * for checking transaction categories. By decentralizing category logic into the model
 * itself, we eliminate the need for separate category flags and keep the detection logic
 * portable across observers and plugins.
 */
export class ProcessedTransaction implements ITransaction {
    /** Complete transaction data ready for database persistence */
    payload: ITransactionPersistencePayload;
    /** Socket.IO-ready representation for real-time client notifications */
    snapshot: any;
    /** Boolean flags for efficient transaction categorization and routing (deprecated, use methods instead) */
    categories: ITransactionCategoryFlags;
    /** Original contract parameter values from TronGrid API */
    rawValue: Record<string, unknown>;
    /** Transaction receipt with energy/bandwidth execution details (may be null) */
    info: any;

    private thresholds: TransactionCategoryThresholds;

    constructor(data: ITransaction, thresholds: TransactionCategoryThresholds) {
        this.payload = data.payload;
        this.snapshot = data.snapshot;
        this.categories = data.categories;
        this.rawValue = data.rawValue;
        this.info = data.info;
        this.thresholds = thresholds;
    }

    /**
     * Check if this transaction qualifies as a delegation transaction.
     *
     * A transaction is considered a delegation if it's a DelegateResourceContract or
     * UnDelegateResourceContract and the amount exceeds the configured threshold.
     * This method replaces the old `categories.isDelegation` flag.
     */
    isDelegation(): boolean {
        const isDelegationType =
            this.payload.type === 'DelegateResourceContract' ||
            this.payload.type === 'UnDelegateResourceContract';

        if (!isDelegationType) {
            return false;
        }

        const amountTRX = this.payload.amountTRX ?? 0;
        return amountTRX >= this.thresholds.delegationAmountTRX;
    }

    /**
     * Check if this transaction qualifies as a stake transaction.
     *
     * A transaction is considered a stake if it's a FreezeBalanceContract,
     * FreezeBalanceV2Contract, or UnfreezeBalanceContract and the amount exceeds
     * the configured threshold. This method replaces the old `categories.isStake` flag.
     */
    isStake(): boolean {
        const isStakeType =
            this.payload.type === 'FreezeBalanceContract' ||
            this.payload.type === 'FreezeBalanceV2Contract' ||
            this.payload.type === 'UnfreezeBalanceContract';

        if (!isStakeType) {
            return false;
        }

        const amountTRX = this.payload.amountTRX ?? 0;
        return amountTRX >= this.thresholds.stakeAmountTRX;
    }

    /**
     * Check if this transaction qualifies as a token creation.
     *
     * A transaction is considered token creation if it's an AssetIssueContract or
     * CreateSmartContract transaction. This method replaces the old
     * `categories.isTokenCreation` flag.
     */
    isTokenCreation(): boolean {
        return (
            this.payload.type === 'AssetIssueContract' ||
            this.payload.type === 'CreateSmartContract'
        );
    }
}
