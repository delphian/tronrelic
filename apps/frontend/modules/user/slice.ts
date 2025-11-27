/**
 * Redux slice for user identity state.
 *
 * Manages the current user's identity, linked wallets, preferences,
 * and loading/error states. Works with the UserIdentityProvider
 * for initialization and persistence.
 */

import { createSlice, createAsyncThunk, type PayloadAction } from '@reduxjs/toolkit';
import type { IUserData, IWalletLink, IUserPreferences } from './types';
import {
    fetchUser,
    connectWallet as apiConnectWallet,
    linkWallet as apiLinkWallet,
    unlinkWallet as apiUnlinkWallet,
    setPrimaryWallet as apiSetPrimaryWallet,
    updatePreferences as apiUpdatePreferences,
    recordActivity as apiRecordActivity
} from './api';

/**
 * Status of user identity operations.
 */
export type UserStatus = 'idle' | 'loading' | 'succeeded' | 'failed';

/**
 * Status of TronLink wallet connection.
 */
export type WalletConnectionStatus = 'idle' | 'checking' | 'connecting' | 'connected' | 'error';

/**
 * User identity state shape.
 */
export interface UserState {
    /**
     * User UUID (generated or loaded from storage).
     */
    userId: string | null;

    /**
     * Full user data from backend.
     */
    userData: IUserData | null;

    /**
     * Current operation status.
     */
    status: UserStatus;

    /**
     * Error message if status is 'failed'.
     */
    error: string | null;

    /**
     * Whether initial identity has been established.
     */
    initialized: boolean;

    // =========================================================================
    // Wallet Connection State (TronLink session)
    // =========================================================================

    /**
     * Currently connected TronLink wallet address (session-only, not persisted).
     * This is the live connection to TronLink browser extension.
     */
    connectedAddress: string | null;

    /**
     * TronLink connection status.
     */
    connectionStatus: WalletConnectionStatus;

    /**
     * Whether TronLink provider is detected in the browser.
     */
    providerDetected: boolean;

    /**
     * Error message for wallet connection issues.
     */
    connectionError: string | null;

    /**
     * Whether the connected wallet has been cryptographically verified.
     * True = signature verified (linked to backend)
     * False = connected but no signature (display-only)
     */
    walletVerified: boolean;
}

const initialState: UserState = {
    userId: null,
    userData: null,
    status: 'idle',
    error: null,
    initialized: false,
    // Wallet connection state
    connectedAddress: null,
    connectionStatus: 'idle',
    providerDetected: false,
    connectionError: null,
    walletVerified: false
};

// ============================================================================
// Async Thunks
// ============================================================================

/**
 * Initialize user identity by fetching/creating from backend.
 */
export const initializeUser = createAsyncThunk(
    'user/initialize',
    async (userId: string, { rejectWithValue }) => {
        try {
            const userData = await fetchUser(userId);
            return { userId, userData };
        } catch (error) {
            return rejectWithValue(
                error instanceof Error ? error.message : 'Failed to initialize user'
            );
        }
    }
);

/**
 * Connect a wallet to the current user (without verification).
 * This is step 1 of the two-step wallet flow.
 */
export const connectWalletThunk = createAsyncThunk(
    'user/connectWallet',
    async (
        payload: { userId: string; address: string },
        { rejectWithValue }
    ) => {
        try {
            const userData = await apiConnectWallet(payload.userId, payload.address);
            return userData;
        } catch (error) {
            return rejectWithValue(
                error instanceof Error ? error.message : 'Failed to connect wallet'
            );
        }
    }
);

/**
 * Link a wallet to the current user (with signature verification).
 * This is step 2 of the two-step wallet flow.
 */
export const linkWalletThunk = createAsyncThunk(
    'user/linkWallet',
    async (
        payload: {
            userId: string;
            address: string;
            message: string;
            signature: string;
            timestamp: number;
        },
        { rejectWithValue }
    ) => {
        try {
            const userData = await apiLinkWallet(
                payload.userId,
                payload.address,
                payload.message,
                payload.signature,
                payload.timestamp
            );
            return userData;
        } catch (error) {
            return rejectWithValue(
                error instanceof Error ? error.message : 'Failed to link wallet'
            );
        }
    }
);

/**
 * Unlink a wallet from the current user.
 */
export const unlinkWalletThunk = createAsyncThunk(
    'user/unlinkWallet',
    async (
        payload: {
            userId: string;
            address: string;
            message: string;
            signature: string;
        },
        { rejectWithValue }
    ) => {
        try {
            const userData = await apiUnlinkWallet(
                payload.userId,
                payload.address,
                payload.message,
                payload.signature
            );
            return userData;
        } catch (error) {
            return rejectWithValue(
                error instanceof Error ? error.message : 'Failed to unlink wallet'
            );
        }
    }
);

/**
 * Set a wallet as primary.
 */
export const setPrimaryWalletThunk = createAsyncThunk(
    'user/setPrimaryWallet',
    async (
        payload: { userId: string; address: string },
        { rejectWithValue }
    ) => {
        try {
            const userData = await apiSetPrimaryWallet(payload.userId, payload.address);
            return userData;
        } catch (error) {
            return rejectWithValue(
                error instanceof Error ? error.message : 'Failed to set primary wallet'
            );
        }
    }
);

/**
 * Update user preferences.
 */
export const updatePreferencesThunk = createAsyncThunk(
    'user/updatePreferences',
    async (
        payload: { userId: string; preferences: Partial<IUserPreferences> },
        { rejectWithValue }
    ) => {
        try {
            const userData = await apiUpdatePreferences(payload.userId, payload.preferences);
            return userData;
        } catch (error) {
            return rejectWithValue(
                error instanceof Error ? error.message : 'Failed to update preferences'
            );
        }
    }
);

/**
 * Record activity (fire-and-forget, doesn't affect state on failure).
 */
export const recordActivityThunk = createAsyncThunk(
    'user/recordActivity',
    async (userId: string) => {
        await apiRecordActivity(userId);
        return true;
    }
);

// ============================================================================
// Slice Definition
// ============================================================================

const userSlice = createSlice({
    name: 'user',
    initialState,
    reducers: {
        /**
         * Set user ID directly (for SSR hydration).
         */
        setUserId(state, action: PayloadAction<string>) {
            state.userId = action.payload;
        },

        /**
         * Set user data directly (for SSR hydration or WebSocket updates).
         */
        setUserData(state, action: PayloadAction<IUserData>) {
            state.userData = action.payload;
            state.userId = action.payload.id;
        },

        /**
         * Mark user as initialized.
         */
        markInitialized(state) {
            state.initialized = true;
        },

        /**
         * Clear error state.
         */
        clearError(state) {
            state.error = null;
            if (state.status === 'failed') {
                state.status = 'idle';
            }
        },

        /**
         * Reset user state (e.g., on logout or identity clear).
         */
        resetUserState() {
            return initialState;
        },

        // =====================================================================
        // Wallet Connection Actions
        // =====================================================================

        /**
         * Set connected wallet address (TronLink session).
         */
        setConnectedAddress(state, action: PayloadAction<string | null>) {
            state.connectedAddress = action.payload;
        },

        /**
         * Set wallet connection status.
         */
        setConnectionStatus(state, action: PayloadAction<WalletConnectionStatus>) {
            state.connectionStatus = action.payload;
            if (action.payload !== 'error') {
                state.connectionError = null;
            }
        },

        /**
         * Set wallet connection error.
         */
        setConnectionError(state, action: PayloadAction<string | null>) {
            state.connectionError = action.payload;
            if (action.payload) {
                state.connectionStatus = 'error';
            }
        },

        /**
         * Set whether TronLink provider is detected.
         */
        setProviderDetected(state, action: PayloadAction<boolean>) {
            state.providerDetected = action.payload;
        },

        /**
         * Reset wallet connection state (disconnect from TronLink).
         */
        resetWalletConnection(state) {
            state.connectedAddress = null;
            state.connectionStatus = 'idle';
            state.connectionError = null;
            state.walletVerified = false;
            // Keep providerDetected as-is
        },

        /**
         * Set wallet verification status.
         */
        setWalletVerified(state, action: PayloadAction<boolean>) {
            state.walletVerified = action.payload;
        }
    },
    extraReducers: (builder) => {
        // Initialize user
        builder
            .addCase(initializeUser.pending, (state) => {
                state.status = 'loading';
                state.error = null;
            })
            .addCase(initializeUser.fulfilled, (state, action) => {
                state.status = 'succeeded';
                state.userId = action.payload.userId;
                state.userData = action.payload.userData;
                state.initialized = true;
            })
            .addCase(initializeUser.rejected, (state, action) => {
                state.status = 'failed';
                state.error = action.payload as string;
                state.initialized = true; // Mark as initialized even on failure
            });

        // Connect wallet (unverified)
        builder
            .addCase(connectWalletThunk.pending, (state) => {
                state.status = 'loading';
                state.error = null;
            })
            .addCase(connectWalletThunk.fulfilled, (state, action) => {
                state.status = 'succeeded';
                state.userData = action.payload;
            })
            .addCase(connectWalletThunk.rejected, (state, action) => {
                state.status = 'failed';
                state.error = action.payload as string;
            });

        // Link wallet (verified)
        builder
            .addCase(linkWalletThunk.pending, (state) => {
                state.status = 'loading';
                state.error = null;
            })
            .addCase(linkWalletThunk.fulfilled, (state, action) => {
                state.status = 'succeeded';
                state.userData = action.payload;
            })
            .addCase(linkWalletThunk.rejected, (state, action) => {
                state.status = 'failed';
                state.error = action.payload as string;
            });

        // Unlink wallet
        builder
            .addCase(unlinkWalletThunk.pending, (state) => {
                state.status = 'loading';
                state.error = null;
            })
            .addCase(unlinkWalletThunk.fulfilled, (state, action) => {
                state.status = 'succeeded';
                state.userData = action.payload;
            })
            .addCase(unlinkWalletThunk.rejected, (state, action) => {
                state.status = 'failed';
                state.error = action.payload as string;
            });

        // Set primary wallet
        builder
            .addCase(setPrimaryWalletThunk.pending, (state) => {
                state.status = 'loading';
                state.error = null;
            })
            .addCase(setPrimaryWalletThunk.fulfilled, (state, action) => {
                state.status = 'succeeded';
                state.userData = action.payload;
            })
            .addCase(setPrimaryWalletThunk.rejected, (state, action) => {
                state.status = 'failed';
                state.error = action.payload as string;
            });

        // Update preferences
        builder
            .addCase(updatePreferencesThunk.pending, (state) => {
                state.status = 'loading';
                state.error = null;
            })
            .addCase(updatePreferencesThunk.fulfilled, (state, action) => {
                state.status = 'succeeded';
                state.userData = action.payload;
            })
            .addCase(updatePreferencesThunk.rejected, (state, action) => {
                state.status = 'failed';
                state.error = action.payload as string;
            });

        // Record activity (no state changes on success/failure)
        builder
            .addCase(recordActivityThunk.fulfilled, () => {
                // No state change needed
            })
            .addCase(recordActivityThunk.rejected, () => {
                // Silently ignore activity recording failures
            });
    }
});

// ============================================================================
// Selectors
// ============================================================================

/**
 * Select user ID.
 */
export const selectUserId = (state: { user: UserState }): string | null =>
    state.user.userId;

/**
 * Select full user data.
 */
export const selectUserData = (state: { user: UserState }): IUserData | null =>
    state.user.userData;

/**
 * Select linked wallets.
 */
export const selectWallets = (state: { user: UserState }): IWalletLink[] =>
    state.user.userData?.wallets ?? [];

/**
 * Select primary wallet address.
 */
export const selectPrimaryWallet = (state: { user: UserState }): string | null => {
    const primary = state.user.userData?.wallets?.find((w) => w.isPrimary);
    return primary?.address ?? null;
};

/**
 * Select user preferences.
 */
export const selectPreferences = (state: { user: UserState }): IUserPreferences =>
    state.user.userData?.preferences ?? {};

/**
 * Select user status.
 */
export const selectUserStatus = (state: { user: UserState }): UserStatus =>
    state.user.status;

/**
 * Select user error.
 */
export const selectUserError = (state: { user: UserState }): string | null =>
    state.user.error;

/**
 * Select whether user is initialized.
 */
export const selectUserInitialized = (state: { user: UserState }): boolean =>
    state.user.initialized;

/**
 * Select whether user has any linked wallets.
 */
export const selectHasWallets = (state: { user: UserState }): boolean =>
    (state.user.userData?.wallets?.length ?? 0) > 0;

// ============================================================================
// Wallet Connection Selectors
// ============================================================================

/**
 * Select connected TronLink wallet address.
 */
export const selectConnectedAddress = (state: { user: UserState }): string | null =>
    state.user.connectedAddress;

/**
 * Select wallet connection status.
 */
export const selectConnectionStatus = (state: { user: UserState }): WalletConnectionStatus =>
    state.user.connectionStatus;

/**
 * Select whether TronLink provider is detected.
 */
export const selectProviderDetected = (state: { user: UserState }): boolean =>
    state.user.providerDetected;

/**
 * Select wallet connection error.
 */
export const selectConnectionError = (state: { user: UserState }): string | null =>
    state.user.connectionError;

/**
 * Select whether wallet is connected via TronLink.
 */
export const selectIsWalletConnected = (state: { user: UserState }): boolean =>
    state.user.connectionStatus === 'connected' && state.user.connectedAddress !== null;

/**
 * Select whether connected wallet is cryptographically verified.
 */
export const selectWalletVerified = (state: { user: UserState }): boolean =>
    state.user.walletVerified;

// ============================================================================
// Exports
// ============================================================================

export const {
    setUserId,
    setUserData,
    markInitialized,
    clearError,
    resetUserState,
    // Wallet connection actions
    setConnectedAddress,
    setConnectionStatus,
    setConnectionError,
    setProviderDetected,
    resetWalletConnection,
    setWalletVerified
} = userSlice.actions;

export default userSlice.reducer;
