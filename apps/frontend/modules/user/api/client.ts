/**
 * User module API client functions.
 *
 * Provides typed API calls for user identity operations including
 * fetching users, linking wallets, managing preferences, and admin operations.
 */

import { apiClient } from '../../../lib/api';
import type { IUserData, IUserPreferences, IUserStats } from '../types';

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
 * @param userId - User UUID
 * @param address - TRON wallet address
 * @returns Updated user data
 */
export async function connectWallet(
    userId: string,
    address: string
): Promise<IUserData> {
    const response = await apiClient.post(
        `/user/${userId}/wallet/connect`,
        { address },
        { withCredentials: true }
    );
    return response.data as IUserData;
}

/**
 * Link a wallet to user identity (with signature verification).
 *
 * @param userId - User UUID
 * @param address - TRON wallet address
 * @param message - Message that was signed
 * @param signature - TronLink signature
 * @param timestamp - Timestamp when signature was created
 * @returns Updated user data
 */
export async function linkWallet(
    userId: string,
    address: string,
    message: string,
    signature: string,
    timestamp: number
): Promise<IUserData> {
    const response = await apiClient.post(
        `/user/${userId}/wallet`,
        { address, message, signature, timestamp },
        { withCredentials: true }
    );
    return response.data as IUserData;
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
 */
export async function recordActivity(userId: string): Promise<void> {
    await apiClient.post(
        `/user/${userId}/activity`,
        {},
        { withCredentials: true }
    );
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
