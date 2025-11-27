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
    wallets: IWalletLink[];
    preferences: IUserPreferences;
    activity: IUserActivity;
    createdAt: string;
    updatedAt: string;
}

/**
 * Linked wallet information.
 */
export interface IWalletLink {
    address: string;
    linkedAt: string;
    isPrimary: boolean;
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
