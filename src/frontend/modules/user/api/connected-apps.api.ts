/**
 * @fileoverview Client-side API helpers for a user's connected apps.
 *
 * Same-origin fetches, so the browser attaches the Better Auth session cookie
 * and the backend scopes every call to the signed-in user.
 */

import { parseJsonResponse } from './http';

/**
 * Revoke one of the signed-in user's connected apps.
 *
 * @param clientId - The app's OAuth client id, often a URL.
 * @returns Resolves once the grant and its tokens are gone.
 * @throws When the request fails, with the backend's message.
 */
export async function revokeConnectedApp(clientId: string): Promise<void> {
    const response = await fetch(`/api/user/connected-apps?clientId=${encodeURIComponent(clientId)}`, {
        method: 'DELETE',
        credentials: 'same-origin'
    });
    if (!response.ok) {
        await parseJsonResponse<unknown>(response);
    }
}
