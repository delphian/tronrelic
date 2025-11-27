/**
 * User feature exports.
 *
 * Provides user identity management including UUID tracking,
 * wallet linking, and preferences.
 */

// Redux slice
export { default as userReducer } from './slice';
export {
    // Actions
    setUserId,
    setUserData,
    markInitialized,
    clearError,
    resetUserState,
    // Async thunks
    initializeUser,
    linkWalletThunk,
    unlinkWalletThunk,
    setPrimaryWalletThunk,
    updatePreferencesThunk,
    recordActivityThunk,
    // Selectors
    selectUserId,
    selectUserData,
    selectWallets,
    selectPrimaryWallet,
    selectPreferences,
    selectUserStatus,
    selectUserError,
    selectUserInitialized,
    selectHasWallets
} from './slice';

// Types
export type { UserState, UserStatus } from './slice';
