/**
 * DEPRECATED: This static configuration module uses build-time environment variables.
 *
 * ⚠️ DO NOT USE THIS MODULE IN NEW CODE ⚠️
 *
 * Problem:
 * Next.js production builds inline NEXT_PUBLIC_* environment variables at build time,
 * making Docker images domain-specific. This prevents us from distributing universal
 * Docker images that work on any domain (tronrelic.com, dev.tronrelic.com, etc.)
 * without rebuilding.
 *
 * Modern replacement:
 * - For SSR code (server components, generateMetadata): use getServerConfig() from lib/serverConfig.ts
 * - For client code (client components, hooks, event handlers): use getRuntimeConfig() from lib/runtimeConfig.ts
 *
 * Migration guide:
 * ```typescript
 * // OLD (deprecated)
 * import { config } from '@/lib/config';
 * const url = config.siteUrl;
 *
 * // NEW (SSR)
 * import { getServerConfig } from '@/lib/serverConfig';
 * const { siteUrl } = await getServerConfig();
 *
 * // NEW (Client)
 * import { getRuntimeConfig } from '@/lib/runtimeConfig';
 * const { siteUrl } = getRuntimeConfig();
 * ```
 *
 * When will this be removed:
 * After all existing usages are migrated to runtime config (Phase 2).
 * Currently kept for backwards compatibility only.
 */

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/**
 * Gets the appropriate backend base URL for the current runtime context.
 *
 * Server-side (SSR):
 *   - Requires SITE_BACKEND environment variable (from .env)
 *   - Docker: http://backend:4000 for container-to-container communication
 *   - Local: http://localhost:4000 for local development
 *
 * Client-side (browser):
 *   - Dynamically detects from window.location (no NEXT_PUBLIC_* variables)
 *   - This ensures browsers connect to the publicly accessible backend URL
 *
 * @returns The base backend URL without trailing /api path
 */
function getBackendBaseUrl(): string {
  // Server-side (SSR): SITE_BACKEND is required
  if (typeof window === 'undefined') {
    if (!process.env.SITE_BACKEND) {
      throw new Error('SITE_BACKEND environment variable is required for server-side rendering');
    }
    return process.env.SITE_BACKEND;
  }

  // Client-side: Dynamically detect from current page (no build-time variables)
  const protocol = window.location.protocol;
  const hostname = window.location.hostname;
  const port = window.location.port;

  if (LOCAL_HOSTNAMES.has(hostname)) {
    return `${protocol}//${hostname}:4000`;
  }

  if (port) {
    return `${protocol}//${hostname}:${port}`;
  }

  return `${protocol}//${hostname}`;
}

/**
 * Gets the site URL dynamically from window.location (client-side only).
 *
 * @returns The site URL (e.g., "https://tronrelic.com" or "http://localhost:3000")
 */
function getSiteUrl(): string {
  if (typeof window === 'undefined') {
    // Server-side: use SITE_BACKEND minus port
    if (!process.env.SITE_BACKEND) {
      throw new Error('SITE_BACKEND environment variable is required');
    }
    return process.env.SITE_BACKEND.replace(':4000', ':3000');
  }

  // Client-side: detect from window.location
  const protocol = window.location.protocol;
  const hostname = window.location.hostname;
  const port = window.location.port;

  if (port && port !== '80' && port !== '443') {
    return `${protocol}//${hostname}:${port}`;
  }

  return `${protocol}//${hostname}`;
}

/**
 * Configuration object for runtime URLs.
 * Uses getBackendBaseUrl() to ensure SSR and client-side contexts use the correct URLs.
 */
export const config = {
  apiBaseUrl: `${getBackendBaseUrl()}/api`,
  socketUrl: getBackendBaseUrl(),
  siteUrl: getSiteUrl()
};

/**
 * Gets the appropriate API URL for the current context (SSR vs client-side).
 *
 * For SSR (server-side rendering), returns absolute URL using internal Docker service name.
 * For client-side, returns relative URL which Next.js rewrites will proxy.
 *
 * @param path - The API path (e.g., '/markets/compare')
 * @returns The full URL to use for fetching
 */
export function getApiUrl(path: string): string {
  // Server-side (SSR) - need absolute URL with internal service name
  if (typeof window === 'undefined') {
    return `${getBackendBaseUrl()}/api${path}`;
  }

  // Client-side - use relative URL (Next.js rewrites handle it)
  return `/api${path}`;
}
