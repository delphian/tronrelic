/**
 * Redux slice for user identity state.
 *
 * Manages the current user's identity, linked wallets, preferences,
 * and loading/error states. Works with the UserIdentityProvider
 * for initialization and persistence.
 */

import { createSlice, createAsyncThunk, type PayloadAction } from '@reduxjs/toolkit';
import { UserIdentityState } from '@/types';
import type { IUserData, IWalletLink, IUserPreferences } from './types';
import {
    bootstrapUser,
    connectWallet as apiConnectWallet,
    linkWallet as apiLinkWallet,
    unlinkWallet as apiUnlinkWallet,
    setPrimaryWallet as apiSetPrimaryWallet,
    refreshWalletVerification as apiRefreshWalletVerification,
    updatePreferences as apiUpdatePreferences,
    recordActivity as apiRecordActivity,
    logoutUser as apiLogoutUser
} from './api';
import type { IConnectWalletResult, ILinkWalletResult } from './api';

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
     * Whether the currently connected wallet has been cryptographically signed.
     * True  = wallet is verified on the backend; user is in the *verified* state.
     * False = wallet is registered (connected, no signature); user is in the
     *         *registered* state with respect to this wallet.
     */
    walletVerified: boolean;

    /**
     * Whether wallet connection detected an existing owner requiring login.
     * When true, frontend should prompt for signature to prove ownership
     * and perform identity swap.
     */
    walletLoginRequired: boolean;

    /**
     * The existing user ID that owns the connected wallet (when walletLoginRequired=true).
     * Used for display purposes only - actual swap happens via linkWallet.
     */
    existingWalletOwner: string | null;
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
    walletVerified: false,
    walletLoginRequired: false,
    existingWalletOwner: null
};

// ============================================================================
// Async Thunks
// ============================================================================

/**
 * Bootstrap user identity from the backend.
 *
 * Server is the only writer of the `tronrelic_uid` cookie. This thunk hits
 * `POST /api/user/bootstrap`, which is idempotent: returning visitors get
 * their canonical user back (cookie unchanged); first-time visitors have a
 * UUID minted server-side and an HttpOnly cookie set on the response.
 *
 * If the backend resolves a merged tombstone, it returns the canonical
 * user's id and refreshes the cookie to point at it — no client-side
 * cookie/localStorage write is needed.
 */
export const initializeUser = createAsyncThunk(
    'user/initialize',
    async (_arg: void, { rejectWithValue }) => {
        try {
            const userData = await bootstrapUser();
            return { userId: userData.id, userData };
        } catch (error) {
            return rejectWithValue(
                error instanceof Error ? error.message : 'Failed to initialize user'
            );
        }
    }
);

/**
 * Register a wallet to the current user (no signature).
 *
 * Stage 1 of the two-stage wallet flow: stores the wallet on the backend
 * with `verified: false` and moves the user from *anonymous* to
 * *registered*. The thunk name `connectWalletThunk` matches the underlying
 * HTTP route (`POST /api/user/:id/wallet/connect`); the *effect* is
 * registration.
 *
 * When the wallet is already linked to another user, returns
 * `loginRequired: true`. Frontend should then prompt for signature
 * verification to log in as that existing owner.
 */
export const connectWalletThunk = createAsyncThunk(
    'user/connectWallet',
    async (
        payload: { userId: string; address: string },
        { rejectWithValue }
    ) => {
        try {
            const result = await apiConnectWallet(payload.userId, payload.address);
            return result;
        } catch (error) {
            return rejectWithValue(
                error instanceof Error ? error.message : 'Failed to connect wallet'
            );
        }
    }
);

/**
 * Verify a wallet on the current user (cryptographic signature required).
 *
 * Stage 2 of the two-stage wallet flow: upgrades a registered wallet to
 * `verified: true` (or adds it as already verified) and moves the user
 * into the *verified* state. The thunk name `linkWalletThunk` matches the
 * underlying HTTP route (`POST /api/user/:id/wallet`); the *effect* is
 * verification.
 *
 * If the wallet belongs to another user, performs identity swap and returns
 * `identitySwapped: true` with the existing owner's data. Frontend updates
 * cookie/localStorage to the new ID — this is the cross-browser login path
 * for *verified* users.
 */
export const linkWalletThunk = createAsyncThunk(
    'user/linkWallet',
    async (
        payload: {
            userId: string;
            address: string;
            message: string;
            signature: string;
            nonce: string;
        },
        { rejectWithValue }
    ) => {
        try {
            const result = await apiLinkWallet(
                payload.userId,
                payload.address,
                payload.message,
                payload.signature,
                payload.nonce
            );

            // Handle identity swap — the backend already rewrote the
            // HttpOnly cookie to the winner's UUID via Set-Cookie on this
            // response. Trigger a full reload so Redux, WebSocket
            // subscriptions, and cached state rebuild against the canonical
            // user. The next bootstrap call will read the refreshed cookie.
            if (result.identitySwapped && result.user) {
                if (typeof window !== 'undefined') {
                    window.location.reload();
                }
            }

            return result;
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
            nonce: string;
        },
        { rejectWithValue }
    ) => {
        try {
            const userData = await apiUnlinkWallet(
                payload.userId,
                payload.address,
                payload.message,
                payload.signature,
                payload.nonce
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
 *
 * Step-up authentication: requires a fresh signature even though the wallet
 * was already verified at link time. Callers must mint a 'set-primary'
 * challenge, prompt the user to sign with TronLink, and submit the
 * resulting (message, signature, nonce) triple.
 */
export const setPrimaryWalletThunk = createAsyncThunk(
    'user/setPrimaryWallet',
    async (
        payload: {
            userId: string;
            address: string;
            message: string;
            signature: string;
            nonce: string;
        },
        { rejectWithValue }
    ) => {
        try {
            const userData = await apiSetPrimaryWallet(
                payload.userId,
                payload.address,
                payload.message,
                payload.signature,
                payload.nonce
            );
            return userData;
        } catch (error) {
            return rejectWithValue(
                error instanceof Error ? error.message : 'Failed to set primary wallet'
            );
        }
    }
);

/**
 * Refresh the freshness clock on an already-verified wallet.
 *
 * Callers mint a `'refresh-verification'` challenge, sign the canonical
 * message with TronLink, and dispatch this thunk with
 * `(message, signature, nonce)`. On success the wallet's `verifiedAt`
 * is now, the server re-derives the user as `Verified`, and the
 * refetched user document propagates that through `selectIsVerified`
 * and `userData.authStatus` so any UI gated on Verified comes back
 * online — admin nav, public profile, plugin features that check
 * Verified.
 */
export const refreshWalletVerificationThunk = createAsyncThunk(
    'user/refreshWalletVerification',
    async (
        payload: {
            userId: string;
            address: string;
            message: string;
            signature: string;
            nonce: string;
        },
        { rejectWithValue }
    ) => {
        try {
            const userData = await apiRefreshWalletVerification(
                payload.userId,
                payload.address,
                payload.message,
                payload.signature,
                payload.nonce
            );
            return userData;
        } catch (error) {
            return rejectWithValue(
                error instanceof Error ? error.message : 'Failed to refresh wallet verification'
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

/**
 * End the user's verified session.
 *
 * Calls `POST /api/user/:id/logout`, which downgrades `identityState`
 * from `Verified` to `Registered` (or `Anonymous` when no wallets
 * remain) and clears `identityVerifiedAt` on the backend. Wallets,
 * preferences, and the cookie all survive — only the live session
 * ends. Re-establishing a session requires signing with a wallet
 * the user has previously verified.
 */
export const logoutThunk = createAsyncThunk(
    'user/logout',
    async (userId: string, { rejectWithValue }) => {
        try {
            const userData = await apiLogoutUser(userId);
            return userData;
        } catch (error) {
            return rejectWithValue(
                error instanceof Error ? error.message : 'Failed to log out'
            );
        }
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
            state.walletLoginRequired = false;
            state.existingWalletOwner = null;
            // Keep providerDetected as-is
        },

        /**
         * Set wallet verification status.
         */
        setWalletVerified(state, action: PayloadAction<boolean>) {
            state.walletVerified = action.payload;
        },

        /**
         * Set wallet login required state.
         * Called when connectWallet detects wallet belongs to another user.
         */
        setWalletLoginRequired(state, action: PayloadAction<{ required: boolean; existingUserId?: string }>) {
            state.walletLoginRequired = action.payload.required;
            state.existingWalletOwner = action.payload.existingUserId ?? null;
        },

        /**
         * Clear wallet login required state.
         * Called after successful login or when user cancels.
         */
        clearWalletLoginRequired(state) {
            state.walletLoginRequired = false;
            state.existingWalletOwner = null;
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

        // Register wallet (stage 1: backend stores wallet with verified=false)
        builder
            .addCase(connectWalletThunk.pending, (state) => {
                state.status = 'loading';
                state.error = null;
                state.walletLoginRequired = false;
                state.existingWalletOwner = null;
            })
            .addCase(connectWalletThunk.fulfilled, (state, action) => {
                state.status = 'succeeded';
                const result = action.payload as IConnectWalletResult;

                if (result.loginRequired) {
                    // Wallet belongs to another user - prompt for login
                    state.walletLoginRequired = true;
                    state.existingWalletOwner = result.existingUserId ?? null;
                } else if (result.success && result.user) {
                    // Wallet connected successfully
                    state.userData = result.user;
                    state.walletLoginRequired = false;
                    state.existingWalletOwner = null;
                }
            })
            .addCase(connectWalletThunk.rejected, (state, action) => {
                state.status = 'failed';
                state.error = action.payload as string;
            });

        // Verify wallet (stage 2: backend upgrades wallet to verified=true)
        builder
            .addCase(linkWalletThunk.pending, (state) => {
                state.status = 'loading';
                state.error = null;
            })
            .addCase(linkWalletThunk.fulfilled, (state, action) => {
                state.status = 'succeeded';
                const result = action.payload as ILinkWalletResult;

                // Update user data (either current user or swapped user)
                state.userData = result.user;

                if (result.identitySwapped) {
                    // Identity was swapped - update userId to new identity
                    state.userId = result.user.id;
                    // Clear login required state
                    state.walletLoginRequired = false;
                    state.existingWalletOwner = null;
                }
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

        // Refresh wallet verification (re-pump verifiedAt on existing wallet)
        builder
            .addCase(refreshWalletVerificationThunk.pending, (state) => {
                state.status = 'loading';
                state.error = null;
            })
            .addCase(refreshWalletVerificationThunk.fulfilled, (state, action) => {
                state.status = 'succeeded';
                state.userData = action.payload;
            })
            .addCase(refreshWalletVerificationThunk.rejected, (state, action) => {
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

        // Logout
        builder
            .addCase(logoutThunk.pending, (state) => {
                state.status = 'loading';
                state.error = null;
            })
            .addCase(logoutThunk.fulfilled, (state, action) => {
                state.status = 'succeeded';
                state.userData = action.payload;
            })
            .addCase(logoutThunk.rejected, (state, action) => {
                state.status = 'failed';
                state.error = action.payload as string;
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
 * Select the user's canonical identity state (anonymous / registered / verified).
 *
 * This reads the stored `identityState` field directly. Prefer this — and the
 * `selectIsAnonymous` / `selectIsRegistered` / `selectIsVerified` shortcuts —
 * over deriving the value from `wallets`. Falls back to `'anonymous'` when
 * user data has not yet loaded (no userData), which lets components treat
 * the pre-init state as the safest possible value.
 */
export const selectIdentityState = (state: { user: UserState }): UserIdentityState =>
    state.user.userData?.identityState ?? UserIdentityState.Anonymous;

/**
 * Select whether the user is in the *anonymous* identity state.
 */
export const selectIsAnonymous = (state: { user: UserState }): boolean =>
    selectIdentityState(state) === UserIdentityState.Anonymous;

/**
 * Select whether the user is in the *registered* identity state.
 *
 * Registered = at least one wallet linked, none cryptographically signed.
 */
export const selectIsRegistered = (state: { user: UserState }): boolean =>
    selectIdentityState(state) === UserIdentityState.Registered;

/**
 * Select whether the user is in the *verified* identity state.
 *
 * Verified = at least one cryptographically signed wallet.
 */
export const selectIsVerified = (state: { user: UserState }): boolean =>
    selectIdentityState(state) === UserIdentityState.Verified;

/**
 * Select whether the user has at least one linked wallet (registered or verified).
 *
 * Equivalent to `identityState !== UserIdentityState.Anonymous`.
 */
export const selectHasWallets = (state: { user: UserState }): boolean =>
    selectIdentityState(state) !== UserIdentityState.Anonymous;

/**
 * Select whether the user has at least one cryptographically signed wallet.
 *
 * Equivalent to `selectIsVerified`. Kept as an alias for callers reasoning
 * about per-wallet verification status rather than per-user identity state.
 */
export const selectHasVerifiedWallet = (state: { user: UserState }): boolean =>
    selectIsVerified(state);

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

/**
 * Select whether wallet login is required (wallet belongs to another user).
 */
export const selectWalletLoginRequired = (state: { user: UserState }): boolean =>
    state.user.walletLoginRequired;

/**
 * Select the existing wallet owner ID (when walletLoginRequired=true).
 */
export const selectExistingWalletOwner = (state: { user: UserState }): string | null =>
    state.user.existingWalletOwner;

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
    setWalletVerified,
    setWalletLoginRequired,
    clearWalletLoginRequired
} = userSlice.actions;

export default userSlice.reducer;
