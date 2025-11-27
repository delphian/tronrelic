/**
 * User identity management utilities.
 *
 * Handles UUID generation, storage (cookie + localStorage), and API client
 * functions for the user module. Uses dual storage for SSR compatibility:
 * cookies for server-side access, localStorage for client-side persistence.
 *
 * ## Cookie Specification
 *
 * Cookie name: `tronrelic_uid`
 * - HttpOnly: false (client needs to read for API calls)
 * - SameSite: Lax (allow same-site navigation, block cross-site POST)
 * - Secure: true in production (HTTPS only)
 * - Path: / (available site-wide)
 * - Max-Age: 1 year (31536000 seconds)
 *
 * ## Privacy Compliance
 *
 * This cookie is classified as "functional/essential" under GDPR and similar
 * regulations because it's necessary for the website to remember user
 * preferences and provide personalized features. No consent banner required.
 */

import { apiClient } from './api';

/**
 * Cookie name for user identity.
 */
export const USER_ID_COOKIE_NAME = 'tronrelic_uid';

/**
 * localStorage key for user identity (client-side backup).
 */
export const USER_ID_STORAGE_KEY = 'tronrelic_uid';

/**
 * Cookie max age in seconds (1 year).
 */
export const COOKIE_MAX_AGE = 31536000;

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

/**
 * Generate a UUID v4.
 *
 * Uses crypto.randomUUID when available (modern browsers),
 * falls back to manual generation for older environments.
 *
 * @returns Generated UUID string
 */
export function generateUUID(): string {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return crypto.randomUUID();
    }

    // Fallback for environments without crypto.randomUUID
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
}

/**
 * Validate UUID v4 format.
 *
 * @param uuid - String to validate
 * @returns True if valid UUID v4 format
 */
export function isValidUUID(uuid: string): boolean {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuidRegex.test(uuid);
}

/**
 * Get user ID from cookie (works on both client and server with cookie string).
 *
 * @param cookieString - Optional cookie string for SSR contexts
 * @returns User ID or null if not found
 */
export function getUserIdFromCookie(cookieString?: string): string | null {
    const cookies = cookieString || (typeof document !== 'undefined' ? document.cookie : '');

    const match = cookies.match(new RegExp(`(?:^|; )${USER_ID_COOKIE_NAME}=([^;]*)`));
    const value = match ? decodeURIComponent(match[1]) : null;

    if (value && isValidUUID(value)) {
        return value;
    }

    return null;
}

/**
 * Get user ID from localStorage (client-side only).
 *
 * @returns User ID or null if not found
 */
export function getUserIdFromStorage(): string | null {
    if (typeof localStorage === 'undefined') {
        return null;
    }

    const value = localStorage.getItem(USER_ID_STORAGE_KEY);
    if (value && isValidUUID(value)) {
        return value;
    }

    return null;
}

/**
 * Get or create user ID using dual storage (cookie + localStorage).
 *
 * Priority:
 * 1. Check cookie (for SSR compatibility)
 * 2. Check localStorage (for client persistence)
 * 3. Generate new UUID and store in both locations
 *
 * @param cookieString - Optional cookie string for SSR contexts
 * @returns User ID (existing or newly generated)
 */
export function getOrCreateUserId(cookieString?: string): string {
    // Check cookie first (works in SSR)
    const cookieId = getUserIdFromCookie(cookieString);
    if (cookieId) {
        // Ensure localStorage is synced (client-side only)
        if (typeof localStorage !== 'undefined') {
            const storageId = localStorage.getItem(USER_ID_STORAGE_KEY);
            if (storageId !== cookieId) {
                localStorage.setItem(USER_ID_STORAGE_KEY, cookieId);
            }
        }
        return cookieId;
    }

    // Check localStorage (client-side only)
    const storageId = getUserIdFromStorage();
    if (storageId) {
        // Set cookie from localStorage (client-side only)
        setUserIdCookie(storageId);
        return storageId;
    }

    // Generate new UUID
    const newId = generateUUID();
    setUserIdCookie(newId);
    if (typeof localStorage !== 'undefined') {
        localStorage.setItem(USER_ID_STORAGE_KEY, newId);
    }

    return newId;
}

/**
 * Set user ID cookie (client-side only).
 *
 * @param userId - User ID to store
 */
export function setUserIdCookie(userId: string): void {
    if (typeof document === 'undefined') {
        return;
    }

    const isProduction = typeof window !== 'undefined' &&
        window.location.protocol === 'https:';

    const cookieValue = [
        `${USER_ID_COOKIE_NAME}=${encodeURIComponent(userId)}`,
        `path=/`,
        `max-age=${COOKIE_MAX_AGE}`,
        `samesite=lax`,
        isProduction ? 'secure' : ''
    ].filter(Boolean).join('; ');

    document.cookie = cookieValue;
}

/**
 * Clear user identity from both cookie and localStorage.
 *
 * Use with caution - this will generate a new identity on next page load.
 */
export function clearUserIdentity(): void {
    // Clear cookie
    if (typeof document !== 'undefined') {
        document.cookie = `${USER_ID_COOKIE_NAME}=; path=/; max-age=0`;
    }

    // Clear localStorage
    if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(USER_ID_STORAGE_KEY);
    }
}

// ============================================================================
// API Client Functions
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
 * Link a wallet to user identity.
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
