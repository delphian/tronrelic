import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { TronTransactionDocument, TransactionAlertPayload } from '@tronrelic/shared';

export type RealtimeTransactionEvent = TransactionAlertPayload['event'];

export type LiveTransaction = TronTransactionDocument & {
    realtimeEvent?: RealtimeTransactionEvent;
};

interface ITransactionsState {
    transactions: LiveTransaction[];
}

const RECENT_WINDOW_MS = 120_000;

/**
 * Filters transactions down to the most recent activity window.
 * The helper inspects each transaction timestamp and retains entries that sit inside the rolling time window so stale alerts disappear quickly.
 * This keeps the live feed relevant by trimming anything older than the configured recent window while preserving the newest events.
 */
function filterRecentTransactions(transactions: LiveTransaction[]): LiveTransaction[] {
    const cutoff = Date.now() - RECENT_WINDOW_MS;

    return transactions.filter(transaction => {
        const parsedTimestamp = new Date(transaction.timestamp).getTime();

        if (!Number.isFinite(parsedTimestamp)) {
            return true;
        }

        return parsedTimestamp >= cutoff;
    });
}

const initialState: ITransactionsState = {
    transactions: []
};

const transactionsSlice = createSlice({
    name: 'transactions',
    initialState,
    reducers: {
        setTransactions(state, action: PayloadAction<TronTransactionDocument[]>) {
            const seen = new Set<string>();

            const mapped = action.payload
                .filter(transaction => {
                    if (seen.has(transaction.txId)) {
                        return false;
                    }
                    seen.add(transaction.txId);
                    return true;
                })
                .map(transaction => ({ ...transaction }));

            state.transactions = filterRecentTransactions(mapped).slice(0, 200);
        },
        prependTransaction(state, action: PayloadAction<LiveTransaction>) {
            const incoming = action.payload;

            const merged = [
                incoming,
                ...state.transactions.filter(existing => existing.txId !== incoming.txId)
            ];

            state.transactions = filterRecentTransactions(merged).slice(0, 200);
        }
    }
});

export const { setTransactions, prependTransaction } = transactionsSlice.actions;
export default transactionsSlice.reducer;
