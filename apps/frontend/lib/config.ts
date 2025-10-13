const defaultSiteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://tronrelic.com';

/**
 * Gets the runtime base URL for API and WebSocket connections.
 * In browser, uses window.location to dynamically determine the backend URL.
 * In SSR, falls back to environment variables.
 *
 * @returns The base URL (protocol + hostname + port) for backend connections
 */
function getRuntimeBackendUrl(): string {
  // Client-side: Use current hostname and port 4000
  if (typeof window !== 'undefined') {
    const protocol = window.location.protocol;
    const hostname = window.location.hostname;
    return `${protocol}//${hostname}:4000`;
  }

  // Server-side: Use environment variable or default
  return process.env.NEXT_PUBLIC_SOCKET_URL ?? 'http://localhost:4000';
}

export const config = {
  apiBaseUrl: typeof window !== 'undefined'
    ? `${getRuntimeBackendUrl()}/api`
    : (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api'),
  socketUrl: getRuntimeBackendUrl(),
  siteUrl: defaultSiteUrl.replace(/\/$/, '') || 'https://tronrelic.com'
};

/**
 * Gets the appropriate API URL for the current context (SSR vs client-side).
 *
 * For SSR (server-side rendering), uses the full API_URL from environment.
 * For client-side, uses relative URLs which get rewritten by Next.js.
 *
 * @param path - The API path (e.g., '/markets/compare')
 * @returns The full URL to use for fetching
 */
export function getApiUrl(path: string): string {
  // Server-side (SSR) - need absolute URL
  if (typeof window === 'undefined') {
    const baseUrl = process.env.API_URL || 'http://localhost:4000';
    return `${baseUrl}/api${path}`;
  }

  // Client-side - use relative URL (Next.js rewrites handle it)
  return `/api${path}`;
}
