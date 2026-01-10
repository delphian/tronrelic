/**
 * Transactions Feature Module
 *
 * This module handles transaction display and filtering including:
 * - Transaction feed
 * - Transaction details
 * - Transaction filtering
 */

// Components
export { TransactionDetails } from './components/TransactionDetails';
export { TransactionFeed } from './components/TransactionFeed';
export { TransactionFilter } from './components/TransactionFilter';

// Redux slice
export { default as transactionReducer } from './slice';
export * from './slice';
