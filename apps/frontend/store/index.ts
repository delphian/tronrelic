import { configureStore, combineReducers } from '@reduxjs/toolkit';
import memoReducer from './slices/memoSlice';
import { blockchainReducer } from '../features/blockchain';
import { uiReducer } from '../features/ui-state';
import { realtimeReducer } from '../features/realtime';
import { transactionReducer } from '../features/transactions';
import { userReducer, type UserState } from '../modules/user';
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
 * Combined root reducer.
 */
const rootReducer = combineReducers({
    memos: memoReducer,
    blockchain: blockchainReducer,
    ui: uiReducer,
    realtime: realtimeReducer,
    transactions: transactionReducer,
    user: userReducer,
    theme: themeReducer
});

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
        trace: process.env.NODE_ENV === 'development',
        traceLimit: 25
    };
}

/**
 * Preloaded state interface for SSR hydration.
 */
export interface PreloadedUserState {
    user?: UserState;
}

/**
 * Create Redux store with optional preloaded state.
 *
 * Used for SSR hydration to prevent UI flash by preloading
 * user data fetched on the server.
 *
 * @param preloadedState - Optional state to hydrate store with
 * @returns Configured Redux store
 */
export function createStore(preloadedState?: PreloadedUserState) {
    return configureStore({
        reducer: rootReducer,
        preloadedState: preloadedState as ReturnType<typeof rootReducer>,
        devTools: resolveDevToolsConfiguration()
    });
}

/**
 * Default store instance for client-side usage.
 */
export const store = configureStore({
    reducer: rootReducer,
    devTools: resolveDevToolsConfiguration()
});

export type RootState = ReturnType<typeof rootReducer>;
export type AppDispatch = typeof store.dispatch;
export type AppStore = typeof store;
