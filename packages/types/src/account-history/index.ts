/**
 * @fileoverview Barrel for the account-history domain contracts.
 *
 * Re-exports the published service interface and its DTOs so the root types
 * index can surface them with a single explicit export line.
 */

export type {
    AccountIngestionStatus,
    ITrackedAccount,
    IAccountIngestionProgress,
    IAccountHistorySettings,
    IAccountHistoryAccountStats,
    IAccountHistoryStats,
    IAddTrackedAccountInput,
    IAccountTransactionQuery,
    IAccountTransactionPage,
    IActivityCalendarBucket,
    IWalletActivityStats,
    IWalletResourceTotals,
    IWalletFlowBucket,
    IWalletCounterparty,
    IWalletActivitySummary,
    IWalletValuationSummary,
    IAccountTokenBalance,
    IAccountBalanceSnapshot,
    IAccountHistoryService
} from './IAccountHistoryService.js';
