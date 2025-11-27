/**
 * User module API barrel export.
 */

export {
    // User API functions
    fetchUser,
    linkWallet,
    unlinkWallet,
    setPrimaryWallet,
    updatePreferences,
    recordActivity,
    // Admin API functions
    adminListUsers,
    adminGetUserStats,
    adminGetUser
} from './client';
