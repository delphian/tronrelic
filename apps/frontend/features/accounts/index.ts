/**
 * Accounts Feature Module
 *
 * This module handles all account-related functionality including:
 * - Account analytics and history
 * - Wallet management
 * - Bookmark tracking
 */

// Components
export { AccountAnalytics } from './components/AccountAnalytics';
export { AccountHistory } from './components/AccountHistory';
export { AccountSummary } from './components/AccountSummary';
export { BookmarkPanel } from './components/BookmarkPanel';

// Redux slices
export { default as walletReducer } from './slice';
export * from './slice';
export { default as bookmarkReducer } from './bookmarkSlice';
export * from './bookmarkSlice';

// Hooks
export { useWallet } from './hooks/useWallet';
