/**
 * Redux slice for user identity state.
 *
 * Manages the current user's identity, linked wallets, preferences,
 * and loading/error states. Works with the UserIdentityProvider
 * for initialization and persistence.
 */

import { createSlice, createAsyncThunk, type PayloadAction } from '@reduxjs/toolkit';
import type {
    IUserData,
    IWalletLink,
    IUserPreferences
} from '../../lib/userIdentity';
import {
    fetchUser,
    linkWallet as apiLinkWallet,
    unlinkWallet as apiUnlinkWallet,
    setPrimaryWallet as apiSetPrimaryWallet,
    updatePreferences as apiUpdatePreferences,
    recordActivity as apiRecordActivity
} from '../../lib/userIdentity';

/**
 * Status of user identity operations.
 */
export type UserStatus = 'idle' | 'loading' | 'succeeded' | 'failed';

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
}

const initialState: UserState = {
    userId: null,
    userData: null,
    status: 'idle',
    error: null,
    initialized: false
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
 * Link a wallet to the current user.
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

        // Link wallet
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
// Exports
// ============================================================================

export const {
    setUserId,
    setUserData,
    markInitialized,
    clearError,
    resetUserState
} = userSlice.actions;

export default userSlice.reducer;
