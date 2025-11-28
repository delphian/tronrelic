/**
 * User module type definitions.
 *
 * Shared interfaces for user identity, wallet linking,
 * preferences, and activity tracking.
 */

/**
 * User data returned from the API.
 */
export interface IUserData {
    id: string;
    /**
     * UI/feature gate controlling what is surfaced to the user.
     * When false, frontend shows "Connect" button and hides logged-in features.
     * UUID tracking continues regardless of this flag.
     */
    isLoggedIn: boolean;
    wallets: IWalletLink[];
    preferences: IUserPreferences;
    activity: IUserActivity;
    createdAt: string;
    updatedAt: string;
}

/**
 * Linked wallet information.
 *
 * Wallet connection follows a two-step flow:
 * 1. Connect: Store address with verified=false (no signature required)
 * 2. Verify: Update to verified=true after signature verification
 *
 * The `isPrimary` field is automatically maintained by the backend:
 * 1. Primary = most recent lastUsed among verified wallets
 * 2. Fallback = most recent lastUsed among unverified wallets (if no verified)
 */
export interface IWalletLink {
    address: string;
    linkedAt: string;
    isPrimary: boolean;
    /** Whether wallet ownership has been cryptographically verified via signature */
    verified: boolean;
    /** Timestamp of last connection/use (ISO string) */
    lastUsed: string;
    label?: string;
}

/**
 * User preferences.
 */
export interface IUserPreferences {
    theme?: 'light' | 'dark' | 'system';
    notifications?: boolean;
    timezone?: string;
    language?: string;
}

/**
 * User activity tracking.
 */
export interface IUserActivity {
    lastSeen: string;
    pageViews: number;
    firstSeen: string;
}

/**
 * User statistics for admin UI.
 */
export interface IUserStats {
    totalUsers: number;
    usersWithWallets: number;
    totalWalletLinks: number;
    activeToday: number;
    activeThisWeek: number;
    averageWalletsPerUser: number;
}
