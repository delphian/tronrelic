/**
 * @fileoverview Barrel for the account-history domain contracts.
 *
 * Re-exports the published service interface and its DTOs so the root types
 * index can surface them with a single explicit export line.
 */

export type {
    AccountIngestionStatus,
    AccountHistoryTickKind,
    AccountHistoryTickSkipReason,
    IAccountHistorySourceFlags,
    IAccountHistorySourcePages,
    IAccountHistoryTickAccountOutcome,
    IAccountHistoryTickOutcome,
    ITrackedAccount,
    IAccountIngestionProgress,
    IAccountHistorySettings,
    IAccountHistoryAccountStats,
    IAccountHistoryStats,
    IAddTrackedAccountInput,
    IAccountTransactionQuery,
    IValueTransferCursor,
    IValueTransferQuery,
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
    ITokenMetadata,
    IAccountHistoryService
} from './IAccountHistoryService.js';
