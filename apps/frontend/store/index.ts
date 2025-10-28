import { configureStore } from '@reduxjs/toolkit';
import { marketReducer } from '../features/markets';
import memoReducer from './slices/memoSlice';
import { walletReducer, bookmarkReducer } from '../features/accounts';
import { blockchainReducer } from '../features/blockchain';
import { uiReducer } from '../features/ui-state';
import { realtimeReducer } from '../features/realtime';
import { transactionReducer } from '../features/transactions';
import themeReducer from '../features/system/themeSlice';

declare global {
    interface Window {
        __REDUX_DEVTOOLS_EXTENSION__?: ((options?: Record<string, unknown>) => unknown) & {
            connect: (options?: Record<string, unknown>) => unknown;
        };
        __REDUX_DEVTOOLS_EXTENSION_COMPOSE__?: (...args: unknown[]) => unknown;
    }
}

/**
 * Resolve devtools configuration for local development.
 * The helper checks for the Redux DevTools browser extension and returns
 * configuration metadata so the extension initializes with useful labels
 * and tracing. In production or non-browser contexts the devtools integration
 * is disabled to avoid referencing unavailable window globals.
 */
function resolveDevToolsConfiguration(): false | Record<string, unknown> {
    if (typeof window === 'undefined') {
        return false;
    }

    if (!window.__REDUX_DEVTOOLS_EXTENSION__) {
        return false;
    }

    return {
        name: 'TronRelic Frontend',
        trace: true,
        traceLimit: 25
    };
}

export const store = configureStore({
    reducer: {
        markets: marketReducer,
        memos: memoReducer,
        wallet: walletReducer,
        bookmarks: bookmarkReducer,
        blockchain: blockchainReducer,
        ui: uiReducer,
        realtime: realtimeReducer,
        transactions: transactionReducer,
        theme: themeReducer
    },
    devTools: resolveDevToolsConfiguration()
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
