/**
 * @fileoverview User identity constants and read-only helpers.
 *
 * The server is the only writer of `tronrelic_uid`. The cookie is HttpOnly,
 * so client-side code cannot read or set it; the JS UUID generator,
 * cookie writer, and localStorage mirror that previously lived here have
 * been removed. SSR utilities still need to *read* the cookie (Next.js
 * exposes HttpOnly cookies to server components via `next/headers`), and
 * UUID validation is still useful as a guard against malformed values
 * arriving from the request — those helpers remain.
 *
 * ## Cookie Specification
 *
 * Cookie name: `tronrelic_uid`
 * - HttpOnly: true (server-only; not exposed to JavaScript)
 * - SameSite: Lax (allow same-site navigation, block cross-site POST)
 * - Secure: true in production (HTTPS only)
 * - Path: / (available site-wide)
 * - Max-Age: 1 year
 *
 * ## Privacy Compliance
 *
 * This cookie is classified as "functional/essential" under GDPR and
 * similar regulations because it's necessary for the website to remember
 * user preferences and provide personalized features. No consent banner
 * required.
 */

/**
 * Cookie name for user identity. Imported by SSR helpers in `./server.ts`.
 */
export const USER_ID_COOKIE_NAME = 'tronrelic_uid';

/**
 * Validate UUID v4 format.
 *
 * Used on the SSR side to reject malformed cookie values before passing
 * them to the backend.
 *
 * @param uuid - String to validate
 * @returns True if valid UUID v4 format
 */
export function isValidUUID(uuid: string): boolean {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuidRegex.test(uuid);
}
