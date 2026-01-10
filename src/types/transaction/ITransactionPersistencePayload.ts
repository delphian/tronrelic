/**
 * Complete transaction data prepared for database persistence.
 *
 * This interface represents a fully enriched blockchain transaction ready for storage.
 * All addresses are converted to Base58 format, amounts are calculated in both sun and
 * TRX units, and USD conversions are complete. This abstraction isolates observers from
 * database implementation details while providing all necessary transaction context.
 */
export interface ITransactionPersistencePayload {
    /** Unique transaction identifier from the blockchain */
    txId: string;
    /** Block number containing this transaction */
    blockNumber: number;
    /** Transaction execution timestamp */
    timestamp: Date;
    /** Primary transaction type (TransferContract, TriggerSmartContract, etc.) */
    type: string;
    /** Optional sub-categorization for complex transaction types */
    subType?: string;
    /** Source address with enriched metadata (exchange vs wallet, known names) */
    from: {
        address: string;
        name?: string | null;
        type?: string | null;
        labels?: string[];
        description?: string | null;
    };
    /** Destination address with enriched metadata */
    to: {
        address: string;
        name?: string | null;
        type?: string | null;
        labels?: string[];
        description?: string | null;
    };
    /** Transaction amount in sun (smallest unit) */
    amount?: number;
    /** Transaction amount in TRX */
    amountTRX?: number;
    /** Transaction amount in USD at execution time */
    amountUSD?: number;
    /** Energy resource consumption and cost details */
    energy?: {
        consumed: number;
        price: number;
        totalCost: number;
    };
    /** Bandwidth resource consumption and cost details */
    bandwidth?: {
        consumed: number;
        price: number;
        totalCost: number;
    };
    /** Smart contract details if transaction involves a contract */
    contract?: {
        address: string;
        method?: string;
        parameters?: Record<string, unknown>;
    };
    /** Optional transaction memo or note */
    memo?: string | null;
    /** Internal transactions triggered by smart contract execution */
    internalTransactions?: unknown[];
    /** Notification channels that should be triggered for this transaction */
    notifications?: string[];
    /** Advanced pattern analysis and risk scoring */
    analysis?: {
        relatedAddresses?: string[];
        relatedTransactions?: string[];
        pattern?: 'accumulation' | 'distribution' | 'arbitrage' | 'exchange_reshuffle' |
                  'exchange_outflow' | 'exchange_inflow' | 'self_shuffle' |
                  'cluster_distribution' | 'mega_whale' | 'delegation' | 'stake' |
                  'token_creation' | 'unknown';
        riskScore?: number;
        clusterId?: string;
        confidence?: number;
    };
}
