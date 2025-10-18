import type { ITransaction } from './ITransaction.js';
import type { ITransactionPersistencePayload } from './ITransactionPersistencePayload.js';
import type { ITransactionCategoryFlags } from './ITransactionCategoryFlags.js';

/**
 * Enriched transaction model with category detection methods.
 *
 * This class wraps the ITransaction interface and provides convenience methods
 * for checking transaction categories. By decentralizing category logic into the model
 * itself, we eliminate the need for separate category flags and keep the detection logic
 * portable across observers and plugins.
 *
 * Note: These methods only identify transaction types. Amount-based filtering should be
 * applied at the application level where business logic requires it.
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

    constructor(data: ITransaction) {
        this.payload = data.payload;
        this.snapshot = data.snapshot;
        this.categories = data.categories;
        this.rawValue = data.rawValue;
        this.info = data.info;
    }

    /**
     * Check if this transaction is a delegation transaction.
     *
     * A transaction is considered a delegation if it's a DelegateResourceContract or
     * UnDelegateResourceContract. This method only identifies the transaction type and
     * does not apply amount thresholds.
     */
    isDelegation(): boolean {
        return (
            this.payload.type === 'DelegateResourceContract' ||
            this.payload.type === 'UnDelegateResourceContract'
        );
    }

    /**
     * Check if this transaction is a stake transaction.
     *
     * A transaction is considered a stake if it's a FreezeBalanceContract,
     * FreezeBalanceV2Contract, or UnfreezeBalanceContract. This method only identifies
     * the transaction type and does not apply amount thresholds.
     */
    isStake(): boolean {
        return (
            this.payload.type === 'FreezeBalanceContract' ||
            this.payload.type === 'FreezeBalanceV2Contract' ||
            this.payload.type === 'UnfreezeBalanceContract'
        );
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
