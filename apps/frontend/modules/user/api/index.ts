/**
 * User module API barrel export.
 */

export {
    // User API functions
    fetchUser,
    connectWallet,
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
    // Public profile functions
    fetchProfile,
    // Admin API functions
    adminListUsers,
    adminGetUserStats,
    adminGetUser
} from './client';

export type { ISessionData, IConnectWalletResult, ILinkWalletResult, IPublicProfile } from './client';
