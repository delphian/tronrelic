/**
 * Server-side user identity utilities.
 *
 * Provides functions for reading user identity from cookies during
 * server-side rendering in Next.js App Router. Uses `next/headers`
 * for cookie access in server components.
 *
 * ## Usage in Server Components
 *
 * ```typescript
 * import { getServerUserId, getServerUser } from '@/modules/user';
 *
 * export default async function UserPage() {
 *     const userId = getServerUserId();
 *
 *     if (!userId) {
 *         return <p>No user identity found</p>;
 *     }
 *
 *     const user = await getServerUser(userId);
 *     return <UserProfile user={user} />;
 * }
 * ```
 *
 * ## Notes
 *
 * - Only call these functions from server components or SSR functions
 * - DO NOT call from client components (use Redux store instead)
 * - Cookie validation is basic (UUID format check only)
 * - For authenticated operations, backend validates cookie against :id param
 */

import { cookies } from 'next/headers';
import { USER_ID_COOKIE_NAME, isValidUUID } from './identity';
import type { IUserData } from '../types';

/**
 * Get user ID from cookies during SSR.
 *
 * Uses Next.js `cookies()` function to read the identity cookie
 * from the request. Returns null if cookie is missing or invalid.
 *
 * @returns User UUID or null if not found/invalid
 *
 * @example
 * ```typescript
 * // In a server component
 * const userId = await getServerUserId();
 * ```
 */
export async function getServerUserId(): Promise<string | null> {
    const cookieStore = await cookies();
    const cookie = cookieStore.get(USER_ID_COOKIE_NAME);

    if (!cookie?.value) {
        return null;
    }

    const value = cookie.value;
    if (!isValidUUID(value)) {
        return null;
    }

    return value;
}

/**
 * Fetch user data from backend during SSR.
 *
 * Performs a server-to-backend fetch to get user data. The request
 * includes the user's cookies for authentication validation.
 *
 * Note: This makes a network request during SSR, so use sparingly.
 * For pages that don't need immediate user data, let the client
 * fetch after hydration via UserIdentityProvider.
 *
 * @param userId - User UUID to fetch
 * @returns User data or null if not found/error
 *
 * @example
 * ```typescript
 * // In a server component
 * const userId = getServerUserId();
 * if (userId) {
 *     const user = await getServerUser(userId);
 * }
 * ```
 */
export async function getServerUser(userId: string): Promise<IUserData | null> {
    try {
        const backendUrl = process.env.SITE_BACKEND || 'http://localhost:4000';
        const cookieStore = await cookies();
        const uidCookie = cookieStore.get(USER_ID_COOKIE_NAME);

        const response = await fetch(`${backendUrl}/api/user/${userId}`, {
            headers: {
                Cookie: uidCookie ? `${USER_ID_COOKIE_NAME}=${uidCookie.value}` : ''
            },
            cache: 'no-store',
            signal: AbortSignal.timeout(5000)
        });

        if (!response.ok) {
            return null;
        }

        const data = await response.json();
        return data as IUserData;
    } catch {
        // SSR fetch failed - let client fetch after hydration
        return null;
    }
}

/**
 * Check if user has a valid identity cookie during SSR.
 *
 * Quick check without fetching user data. Useful for conditional
 * rendering or redirect logic in server components.
 *
 * @returns True if valid user ID cookie exists
 *
 * @example
 * ```typescript
 * // In a server component
 * if (!(await hasServerUserIdentity())) {
 *     redirect('/login');
 * }
 * ```
 */
export async function hasServerUserIdentity(): Promise<boolean> {
    return (await getServerUserId()) !== null;
}
