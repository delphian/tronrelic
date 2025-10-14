const defaultSiteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://tronrelic.com';
const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/**
 * Normalizes client-provided backend URLs while avoiding localhost defaults in production.
 *
 * @param rawUrl - The raw environment URL to normalize
 * @returns A normalized origin string or null when the URL should be ignored
 */
function normalizeClientEnvUrl(rawUrl: string | undefined): string | null {
    if (!rawUrl) {
        return null;
    }

    try {
        const trimmed = rawUrl.replace(/\/api$/, '').replace(/\/$/, '');
        const resolved = new URL(trimmed, window.location.origin);
        const targetHost = resolved.hostname;
        const currentHost = window.location.hostname;
        const targetIsLocal = LOCAL_HOSTNAMES.has(targetHost);
        const currentIsLocal = LOCAL_HOSTNAMES.has(currentHost);

        if (targetIsLocal && !currentIsLocal) {
            return null;
        }

        return `${resolved.protocol}//${resolved.host}`;
    } catch {
        return null;
    }
}

/**
 * Gets the appropriate backend base URL for the current runtime context.
 *
 * Server-side (SSR within Docker):
 *   - Uses API_URL environment variable (e.g., http://backend:4000)
 *   - This allows the Next.js server to communicate with the backend container via Docker networking
 *
 * Client-side (browser):
 *   - Uses NEXT_PUBLIC_SOCKET_URL or NEXT_PUBLIC_API_URL from environment
 *   - Falls back to dynamically detecting current hostname with port 4000
 *   - This ensures browsers connect to the publicly accessible backend URL
 *
 * Historical context:
 *   - Docker Compose supplies API_URL=http://backend:4000 inside the running container, but our GitHub build runs without it
 *   - Previous code defaulted to http://localhost:4000 whenever API_URL was missing, so the compiled bundle baked in the wrong host
 *   - This helper now falls back to the backend service name instead, keeping both the build output and SSR aligned without touching environment files
 *
 * @returns The base backend URL without trailing /api path
 */
function getBackendBaseUrl(): string {
  // Server-side (SSR): Use internal Docker service name
  if (typeof window === 'undefined') {
    if (process.env.API_URL) {
        return process.env.API_URL;
    }

    if (process.env.NEXT_PUBLIC_API_URL) {
        return process.env.NEXT_PUBLIC_API_URL.replace(/\/api$/, '');
    }

    return 'http://backend:4000';
  }

  // Client-side: Use public URL or detect from window.location
  const envUrl =
    normalizeClientEnvUrl(process.env.NEXT_PUBLIC_SOCKET_URL) ??
    normalizeClientEnvUrl(process.env.NEXT_PUBLIC_API_URL);
  if (envUrl) {
    return envUrl;
  }

  // Fallback: dynamically detect from current page (distinguish local dev vs production)
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
 * Configuration object for runtime URLs.
 * Uses getBackendBaseUrl() to ensure SSR and client-side contexts use the correct URLs.
 */
export const config = {
  apiBaseUrl: `${getBackendBaseUrl()}/api`,
  socketUrl: getBackendBaseUrl(),
  siteUrl: defaultSiteUrl.replace(/\/$/, '') || 'https://tronrelic.com'
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
