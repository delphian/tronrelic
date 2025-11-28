/**
 * User identity utilities.
 *
 * Handles UUID generation, storage (cookie + localStorage), and validation.
 * Uses dual storage for SSR compatibility: cookies for server-side access,
 * localStorage for client-side persistence.
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
 * Generate a UUID v4.
 *
 * Uses crypto.randomUUID when available (modern browsers),
 * falls back to crypto.getRandomValues for older environments.
 *
 * @returns Generated UUID string
 */
export function generateUUID(): string {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return crypto.randomUUID();
    }

    // Fallback using crypto.getRandomValues (IE11+, all modern browsers)
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
        const bytes = new Uint8Array(16);
        crypto.getRandomValues(bytes);

        // Set version (4) and variant (8, 9, a, or b) bits per RFC 4122
        bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
        bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10xx

        const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
        return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }

    // Final fallback for extremely old environments (pre-IE11)
    // This path should never execute in practice
    throw new Error('No cryptographic random number generator available');
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
