/**
 * Transaction type definitions.
 *
 * Exports all blockchain transaction-related interfaces used throughout the TronRelic
 * observer pattern and plugin system. These types are framework-independent and provide
 * a clean abstraction over raw blockchain data.
 */
export type { ITransaction } from './ITransaction.js';
export type { ITransactionPersistencePayload } from './ITransactionPersistencePayload.js';
export type { ITransactionCategoryFlags } from './ITransactionCategoryFlags.js';
export { ProcessedTransaction } from './ProcessedTransaction.js';
