/**
 * User module API client functions.
 *
 * Provides typed API calls for user identity operations including
 * fetching users, linking wallets, managing preferences, and admin operations.
 */

import { apiClient } from '../../../lib/api';
import type { IUserData, IUserPreferences, IUserStats } from '../types';

// ============================================================================
// Wallet Connection Result Types
// ============================================================================

/**
 * Result of wallet connection attempt.
 *
 * When a wallet is already linked to another user, returns `loginRequired: true`
 * with the existing user ID. The frontend should prompt for signature verification
 * to prove wallet ownership before swapping identity.
 */
export interface IConnectWalletResult {
    /** Whether connection succeeded (wallet now linked to this user) */
    success: boolean;
    /** Updated user data (when success=true) */
    user?: IUserData;
    /** Whether wallet is linked to another user and login is required */
    loginRequired?: boolean;
    /** The existing user ID that owns this wallet (when loginRequired=true) */
    existingUserId?: string;
}

/**
 * Result of wallet link/verification attempt.
 *
 * When identity swap occurs (wallet belonged to another user), returns
 * `identitySwapped: true` with the existing user's data.
 */
export interface ILinkWalletResult {
    /** The user data (either updated current user or swapped-to user) */
    user: IUserData;
    /** Whether identity was swapped to existing wallet owner */
    identitySwapped?: boolean;
    /** The previous user ID before swap (for cleanup on frontend) */
    previousUserId?: string;
}

// ============================================================================
// User API Functions
// ============================================================================

/**
 * Fetch or create user from backend.
 *
 * @param userId - User UUID
 * @returns User data from API
 */
export async function fetchUser(userId: string): Promise<IUserData> {
    const response = await apiClient.get(`/user/${userId}`, {
        withCredentials: true
    });
    return response.data as IUserData;
}

/**
 * Connect a wallet to user identity (without verification).
 *
 * This is the first step in the two-step wallet flow. Stores the
 * wallet address as unverified. Use linkWallet to verify ownership.
 *
 * When wallet is already linked to another user, returns loginRequired=true.
 * Frontend should then prompt for signature verification to login.
 *
 * @param userId - User UUID
 * @param address - TRON wallet address
 * @returns Connection result with success status or login requirement
 */
export async function connectWallet(
    userId: string,
    address: string
): Promise<IConnectWalletResult> {
    const response = await apiClient.post(
        `/user/${userId}/wallet/connect`,
        { address },
        { withCredentials: true }
    );
    return response.data as IConnectWalletResult;
}

/**
 * Link a wallet to user identity (with signature verification).
 *
 * If wallet belongs to another user, performs identity swap and returns
 * identitySwapped=true with the existing user's data. Frontend should
 * update cookie/localStorage to the new user ID.
 *
 * @param userId - User UUID
 * @param address - TRON wallet address
 * @param message - Message that was signed
 * @param signature - TronLink signature
 * @param timestamp - Timestamp when signature was created
 * @returns Link result with user data and optional identity swap indicator
 */
export async function linkWallet(
    userId: string,
    address: string,
    message: string,
    signature: string,
    timestamp: number
): Promise<ILinkWalletResult> {
    const response = await apiClient.post(
        `/user/${userId}/wallet`,
        { address, message, signature, timestamp },
        { withCredentials: true }
    );
    return response.data as ILinkWalletResult;
}

/**
 * Unlink a wallet from user identity.
 *
 * @param userId - User UUID
 * @param address - TRON wallet address to unlink
 * @param message - Message that was signed
 * @param signature - TronLink signature
 * @returns Updated user data
 */
export async function unlinkWallet(
    userId: string,
    address: string,
    message: string,
    signature: string
): Promise<IUserData> {
    const response = await apiClient.delete(
        `/user/${userId}/wallet/${address}`,
        {
            data: { message, signature },
            withCredentials: true
        }
    );
    return response.data as IUserData;
}

/**
 * Set a wallet as primary.
 *
 * @param userId - User UUID
 * @param address - TRON wallet address to set as primary
 * @returns Updated user data
 */
export async function setPrimaryWallet(
    userId: string,
    address: string
): Promise<IUserData> {
    const response = await apiClient.patch(
        `/user/${userId}/wallet/${address}/primary`,
        {},
        { withCredentials: true }
    );
    return response.data as IUserData;
}

/**
 * Update user preferences.
 *
 * @param userId - User UUID
 * @param preferences - Partial preferences to update
 * @returns Updated user data
 */
export async function updatePreferences(
    userId: string,
    preferences: Partial<IUserPreferences>
): Promise<IUserData> {
    const response = await apiClient.patch(
        `/user/${userId}/preferences`,
        preferences,
        { withCredentials: true }
    );
    return response.data as IUserData;
}

/**
 * Record user activity (page view).
 *
 * @param userId - User UUID
 * @deprecated Use startSession and recordPage for session-aware tracking
 */
export async function recordActivity(userId: string): Promise<void> {
    await apiClient.post(
        `/user/${userId}/activity`,
        {},
        { withCredentials: true }
    );
}

// ============================================================================
// Session Tracking Functions
// ============================================================================

/** Screen size category based on viewport width breakpoints */
export type ScreenSizeCategory = 'mobile-sm' | 'mobile-md' | 'mobile-lg' | 'tablet' | 'desktop' | 'desktop-lg' | 'unknown';

/**
 * Session data returned from session/start endpoint.
 */
export interface ISessionData {
    startedAt: string;
    endedAt: string | null;
    durationSeconds: number;
    pages: Array<{ path: string; timestamp: string }>;
    device: 'mobile' | 'tablet' | 'desktop' | 'unknown';
    screenWidth: number | null;
    screenSize: ScreenSizeCategory;
    referrerDomain: string | null;
    country: string | null;
}

/**
 * Start a new session or return the active session.
 * Device, country, and referrer are derived from request headers server-side.
 * Screen size is derived from the provided screenWidth using design system breakpoints.
 *
 * @param userId - User UUID
 * @param referrer - Optional referrer URL (defaults to document.referrer)
 * @param screenWidth - Optional viewport width in pixels
 * @returns Session data
 */
export async function startSession(
    userId: string,
    referrer?: string,
    screenWidth?: number
): Promise<ISessionData> {
    const response = await apiClient.post(
        `/user/${userId}/session/start`,
        { referrer, screenWidth },
        { withCredentials: true }
    );
    return response.data.session as ISessionData;
}

/**
 * Record a page visit in the current session.
 *
 * @param userId - User UUID
 * @param path - Route path (e.g., '/accounts/TXyz...')
 */
export async function recordPage(userId: string, path: string): Promise<void> {
    await apiClient.post(
        `/user/${userId}/session/page`,
        { path },
        { withCredentials: true }
    );
}

/**
 * Update session heartbeat to extend duration tracking.
 * Should be called periodically (e.g., every 30 seconds).
 *
 * @param userId - User UUID
 */
export async function heartbeat(userId: string): Promise<void> {
    await apiClient.post(
        `/user/${userId}/session/heartbeat`,
        {},
        { withCredentials: true }
    );
}

/**
 * End the current session explicitly.
 * Called when user navigates away or closes the page.
 *
 * @param userId - User UUID
 */
export async function endSession(userId: string): Promise<void> {
    await apiClient.post(
        `/user/${userId}/session/end`,
        {},
        { withCredentials: true }
    );
}

// ============================================================================
// Login State Functions
// ============================================================================

/**
 * Log in a user (set isLoggedIn to true).
 *
 * This is a UI/feature gate - it controls what is surfaced to the user,
 * not their underlying identity. UUID tracking continues regardless.
 *
 * @param userId - User UUID
 * @returns Updated user data
 */
export async function loginUser(userId: string): Promise<IUserData> {
    const response = await apiClient.post(
        `/user/${userId}/login`,
        {},
        { withCredentials: true }
    );
    return response.data as IUserData;
}

/**
 * Log out a user (set isLoggedIn to false).
 *
 * This is a UI/feature gate - wallets and all other data remain intact.
 * The user is still tracked by UUID under the hood.
 *
 * @param userId - User UUID
 * @returns Updated user data
 */
export async function logoutUser(userId: string): Promise<IUserData> {
    const response = await apiClient.post(
        `/user/${userId}/logout`,
        {},
        { withCredentials: true }
    );
    return response.data as IUserData;
}

// ============================================================================
// Public Profile Functions
// ============================================================================

/**
 * Public profile data returned from the profile endpoint.
 */
export interface IPublicProfile {
    /** UUID of the user who owns this profile */
    userId: string;
    /** Verified wallet address for this profile */
    address: string;
    /** When the user account was created */
    createdAt: string;
    /** Always true (only verified profiles are returned) */
    isVerified: true;
}

/**
 * Fetch public profile by wallet address.
 *
 * This endpoint is publicly accessible - no authentication required.
 * Returns null if no verified profile exists for the given address.
 *
 * @param address - TRON wallet address
 * @returns Profile data or null if not found
 */
export async function fetchProfile(address: string): Promise<IPublicProfile | null> {
    try {
        const response = await apiClient.get(`/profile/${address}`);
        return response.data as IPublicProfile;
    } catch (error) {
        if ((error as { response?: { status: number } }).response?.status === 404) {
            return null;
        }
        throw error;
    }
}

// ============================================================================
// Admin API Functions
// ============================================================================

const adminHeaderKey = 'x-admin-token';

/**
 * List all users (admin endpoint).
 *
 * @param token - Admin API token
 * @param options - Pagination and search options
 * @returns Users list with stats
 */
export async function adminListUsers(
    token: string,
    options?: { limit?: number; skip?: number; search?: string }
): Promise<{ users: IUserData[]; total: number; stats: IUserStats }> {
    const response = await apiClient.get('/admin/users', {
        headers: { [adminHeaderKey]: token },
        params: options
    });
    return response.data as { users: IUserData[]; total: number; stats: IUserStats };
}

/**
 * Get user statistics (admin endpoint).
 *
 * @param token - Admin API token
 * @returns User statistics
 */
export async function adminGetUserStats(token: string): Promise<IUserStats> {
    const response = await apiClient.get('/admin/users/stats', {
        headers: { [adminHeaderKey]: token }
    });
    return response.data as IUserStats;
}

/**
 * Get any user by ID (admin endpoint).
 *
 * @param token - Admin API token
 * @param userId - User UUID to lookup
 * @returns User data or null if not found
 */
export async function adminGetUser(
    token: string,
    userId: string
): Promise<IUserData | null> {
    try {
        const response = await apiClient.get(`/admin/users/${userId}`, {
            headers: { [adminHeaderKey]: token }
        });
        return response.data as IUserData;
    } catch (error) {
        if ((error as { response?: { status: number } }).response?.status === 404) {
            return null;
        }
        throw error;
    }
}
