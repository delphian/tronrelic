/**
 * User Module
 *
 * Provides user identity management including UUID tracking,
 * wallet linking, preferences, and activity tracking.
 *
 * ## Directory Structure
 *
 * ```
 * modules/user/
 * ├── index.ts          # Barrel exports (this file)
 * ├── slice.ts          # Redux state management
 * ├── api/
 * │   ├── index.ts      # API exports
 * │   └── client.ts     # API client functions
 * ├── types/
 * │   ├── index.ts      # Type exports
 * │   └── user.types.ts # Interface definitions
 * ├── hooks/
 * │   ├── index.ts      # Hooks exports
 * │   └── useWallet.ts  # TronLink wallet connection hook
 * └── lib/
 *     ├── index.ts      # Lib exports (client-safe)
 *     ├── identity.ts   # UUID/cookie utilities
 *     ├── tronWeb.ts    # TronLink provider utilities
 *     └── server.ts     # SSR utilities (import directly, not via barrel)
 * ```
 */

// =============================================================================
// Types
// =============================================================================

export type {
    IUserData,
    IWalletLink,
    IUserPreferences,
    IUserActivity,
    IUserStats
} from './types';

// =============================================================================
// Redux Slice
// =============================================================================

export { default as userReducer } from './slice';

export {
    // Actions
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
    // Async thunks
    initializeUser,
    linkWalletThunk,
    unlinkWalletThunk,
    setPrimaryWalletThunk,
    updatePreferencesThunk,
    recordActivityThunk,
    loginThunk,
    logoutThunk,
    // Selectors
    selectUserId,
    selectUserData,
    selectWallets,
    selectPrimaryWallet,
    selectPreferences,
    selectUserStatus,
    selectUserError,
    selectUserInitialized,
    selectHasWallets,
    selectIsLoggedIn,
    // Wallet connection selectors
    selectConnectedAddress,
    selectConnectionStatus,
    selectProviderDetected,
    selectConnectionError,
    selectIsWalletConnected,
    selectWalletVerified
} from './slice';

export type { UserState, UserStatus, WalletConnectionStatus } from './slice';

// =============================================================================
// API Client
// =============================================================================

export {
    // User API functions
    fetchUser,
    linkWallet,
    unlinkWallet,
    setPrimaryWallet,
    updatePreferences,
    recordActivity,
    // Session tracking functions
    startSession,
    recordPage,
    heartbeat,
    endSession,
    // Login state functions
    loginUser,
    logoutUser,
    // Admin API functions
    adminListUsers,
    adminGetUserStats,
    adminGetUser
} from './api';

export type { ISessionData } from './api';

// =============================================================================
// Identity Utilities (Client-side)
// =============================================================================

export {
    USER_ID_COOKIE_NAME,
    USER_ID_STORAGE_KEY,
    COOKIE_MAX_AGE,
    generateUUID,
    isValidUUID,
    getUserIdFromCookie,
    getUserIdFromStorage,
    setUserIdCookie,
    getOrCreateUserId,
    clearUserIdentity,
    // TronLink provider utilities
    getTronWeb,
    assertTronWeb,
    // SSR state building utilities
    buildSSRUserState
} from './lib';

export type { TronWebProvider, SSRUserData } from './lib';

// =============================================================================
// Server Utilities (SSR)
// =============================================================================
// NOTE: Server utilities (getServerUserId, getServerUser, hasServerUserIdentity)
// must be imported directly from './lib/server' in Server Components only.
// They use next/headers which cannot be re-exported through client-safe barrels.

// =============================================================================
// Hooks
// =============================================================================

export { useWallet, useSessionTracking } from './hooks';

// =============================================================================
// Components
// =============================================================================

export { UserIdentityProvider } from './components';
export type { UserIdentityProviderProps } from './components';
export { WalletButton } from './components';
export { UsersMonitor } from './components';
