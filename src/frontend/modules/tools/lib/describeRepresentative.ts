/**
 * @fileoverview A readable name for a Super Representative.
 *
 * TRON stores only the URL or free-text name a representative registered, so
 * most labels arrive as `https://example.com/`. Stripping the scheme and the
 * trailing slash leaves the part a reader recognizes.
 */

/**
 * Shorten a representative's registered URL to a display name.
 *
 * @param url - The URL or name the representative registered.
 * @param address - Its address, used when it registered nothing.
 * @returns The host and path without scheme or trailing slash, the free-text
 *   name as written, or a shortened address.
 */
export function describeRepresentative(url: string, address: string): string {
    const trimmed = url.trim().replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/+$/, '');

    return trimmed.length > 0 ? trimmed : `${address.slice(0, 6)}…${address.slice(-4)}`;
}
