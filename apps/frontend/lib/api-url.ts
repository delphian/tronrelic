/**
 * API URL utilities for server-side and client-side fetch requests.
 *
 * This module provides centralized logic for determining the correct API URL
 * based on execution context (server vs browser, Docker vs local npm).
 *
 * ## Why This Matters
 *
 * When Next.js performs server-side rendering (SSR), fetch requests happen on
 * the server, not in the browser. In Docker deployments, using the public API URL
 * (e.g., https://dev.tronrelic.com/api) causes SSL certificate validation issues
 * because the frontend container can't verify the certificate chain.
 *
 * The solution: use Docker's internal network (http://backend:4000) for SSR
 * fetches, which bypasses SSL entirely and improves performance. Client-side
 * fetches still use the public URL from the browser.
 *
 * ## Environment Variables
 *
 * - `SITE_BACKEND` (server-only): Internal Docker network URL (http://backend:4000)
 * - `NEXT_PUBLIC_API_URL` (client + server): Public-facing API URL
 *
 * ## Usage Examples
 *
 * ```typescript
 * // Server Component (SSR)
 * export async function MyServerComponent() {
 *     const apiUrl = getServerSideApiUrl();
 *     const res = await fetch(`${apiUrl}/api/menu`);
 *     // In Docker: http://backend:4000/api/menu
 *     // Locally: http://localhost:4000/api/menu
 * }
 *
 * // Client Component
 * export function MyClientComponent() {
 *     const apiUrl = getClientSideApiUrl();
 *     const res = await fetch(`${apiUrl}/api/menu`);
 *     // Always uses NEXT_PUBLIC_API_URL from browser
 * }
 * ```
 */

/**
 * Returns the API base URL for server-side fetch requests (SSR).
 *
 * When running in Docker, this returns the internal Docker network URL
 * (http://backend:4000) to avoid SSL certificate validation issues and
 * improve performance. When running locally via npm, it falls back to
 * NEXT_PUBLIC_API_URL or localhost.
 *
 * This function should ONLY be called from Server Components or server-side
 * code (getServerSideProps, API routes, etc.). Client components should use
 * getClientSideApiUrl() instead.
 *
 * @returns {string} The base API URL without /api suffix (e.g., http://backend:4000)
 *
 * @example
 * ```typescript
 * // In a Server Component
 * export async function SystemNavSSR() {
 *     const apiUrl = getServerSideApiUrl();
 *     const response = await fetch(`${apiUrl}/api/menu?namespace=system`);
 *     // Docker: http://backend:4000/api/menu?namespace=system
 *     // Local: http://localhost:4000/api/menu?namespace=system
 * }
 * ```
 */
export function getServerSideApiUrl(): string {
    // SITE_BACKEND is required for SSR fetches
    // Set in .env: http://backend:4000 for Docker, http://localhost:4000 for local
    if (!process.env.SITE_BACKEND) {
        throw new Error('SITE_BACKEND environment variable is required for server-side API requests');
    }
    return process.env.SITE_BACKEND;
}

/**
 * Returns the API base URL for client-side fetch requests (browser).
 *
 * Dynamically detects the backend URL from window.location to avoid build-time inlining.
 * This enables universal Docker images that work on any domain without rebuilding.
 *
 * This function should ONLY be called from Client Components or browser-side
 * code (useEffect, event handlers, etc.). Server components should use
 * getServerSideApiUrl() instead.
 *
 * @returns {string} The base API URL without /api suffix (e.g., http://localhost:4000)
 *
 * @example
 * ```typescript
 * // In a Client Component
 * 'use client';
 * export function MarketDashboard() {
 *     const apiUrl = getClientSideApiUrl();
 *     const response = await fetch(`${apiUrl}/api/markets`);
 *     // Localhost: http://localhost:4000/api/markets
 *     // Production: https://tronrelic.com/api/markets
 * }
 * ```
 */
export function getClientSideApiUrl(): string {
    if (typeof window === 'undefined') {
        throw new Error('getClientSideApiUrl() can only be called client-side');
    }

    const protocol = window.location.protocol;
    const hostname = window.location.hostname;
    const isLocalhost = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(hostname);

    // Localhost: use port 4000 for backend
    if (isLocalhost) {
        return `${protocol}//${hostname}:4000`;
    }

    // Production: use same hostname (Nginx proxies to backend)
    return `${protocol}//${hostname}`;
}

/**
 * Returns the full API URL (with /api suffix) for server-side fetch requests.
 *
 * Convenience wrapper around getServerSideApiUrl() that includes the /api path.
 * Useful when you want the complete API base path.
 *
 * @returns {string} The full API URL (e.g., http://backend:4000/api)
 *
 * @example
 * ```typescript
 * const apiUrl = getServerSideApiUrlWithPath();
 * const response = await fetch(`${apiUrl}/menu?namespace=system`);
 * // Docker: http://backend:4000/api/menu?namespace=system
 * ```
 */
export function getServerSideApiUrlWithPath(): string {
    return `${getServerSideApiUrl()}/api`;
}

/**
 * Returns the full API URL (with /api suffix) for client-side fetch requests.
 *
 * Convenience wrapper around getClientSideApiUrl() that includes the /api path.
 * Useful when you want the complete API base path.
 *
 * @returns {string} The full API URL (e.g., http://localhost:4000/api)
 *
 * @example
 * ```typescript
 * const apiUrl = getClientSideApiUrlWithPath();
 * const response = await fetch(`${apiUrl}/menu?namespace=system`);
 * // Always: http://localhost:4000/api/menu?namespace=system
 * ```
 */
export function getClientSideApiUrlWithPath(): string {
    return `${getClientSideApiUrl()}/api`;
}
