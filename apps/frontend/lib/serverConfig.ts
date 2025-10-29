/**
 * Runtime Configuration for Server-Side Rendering
 *
 * This module provides the SINGLE SOURCE OF TRUTH for all URL configuration used by SSR code.
 * It fetches configuration from the backend's SystemConfigService once at container startup
 * and caches it in memory for the lifetime of the container.
 *
 * Why this exists:
 * Next.js production builds inline NEXT_PUBLIC_* environment variables at build time,
 * making Docker images domain-specific. By fetching configuration at runtime from the backend,
 * we enable universal Docker images that work on any domain without rebuilding.
 *
 * Architecture:
 * - Backend stores siteUrl in MongoDB (editable via /system/config admin UI)
 * - This module fetches /api/config/public once when first called
 * - Result is cached in memory for container lifetime (no database overhead)
 * - SSR components and metadata generators use this cached config
 *
 * Usage pattern:
 * ```typescript
 * // In layout.tsx, generateMetadata(), or any server component
 * import { getServerConfig } from '@/lib/serverConfig';
 *
 * export async function generateMetadata(): Promise<Metadata> {
 *   const { siteUrl } = await getServerConfig();
 *   return {
 *     metadataBase: new URL(siteUrl),
 *     // ... rest of metadata
 *   };
 * }
 * ```
 *
 * IMPORTANT:
 * - ONLY call this from server-side code (server components, SSR functions)
 * - DO NOT call from client components (use getRuntimeConfig() instead)
 * - DO NOT import lib/config.ts in new code (deprecated, uses build-time values)
 */

/**
 * Runtime configuration shape returned by backend.
 * Must match the response structure from /api/config/public.
 */
export interface RuntimeConfig {
    /** Public site URL (e.g., "https://tronrelic.com") */
    siteUrl: string;
    /** API base URL (e.g., "https://tronrelic.com/api") */
    apiUrl: string;
    /** WebSocket connection URL (e.g., "https://tronrelic.com") */
    socketUrl: string;
}

/**
 * In-memory cache for runtime configuration.
 * Null until first fetch, then cached for container lifetime.
 */
let cachedConfig: RuntimeConfig | null = null;

/**
 * Resolves the backend URL for SSR-to-backend communication.
 *
 * Why different from client URLs:
 * - In Docker, SSR runs in the frontend container and needs to reach the backend container
 * - Uses Docker service name "backend:4000" for container-to-container communication
 * - In local npm mode, uses localhost for direct connection
 *
 * @returns Backend URL for SSR fetch calls (e.g., "http://backend:4000")
 */
function getBackendUrl(): string {
    // Docker mode: Use internal service name for container-to-container communication
    if (process.env.API_URL) {
        return process.env.API_URL.replace(/\/$/, '');
    }

    // npm mode: Use localhost for local development
    if (process.env.NEXT_PUBLIC_API_URL) {
        return process.env.NEXT_PUBLIC_API_URL.replace(/\/api$/, '').replace(/\/$/, '');
    }

    // Fallback for npm mode when .env isn't loaded
    return 'http://localhost:4000';
}

/**
 * Fetches runtime configuration from backend and caches it.
 *
 * Flow:
 * 1. First call: Fetches from backend /api/config/public
 * 2. Subsequent calls: Returns cached value (no fetch)
 * 3. On error: Falls back to environment variables (local dev safety)
 *
 * Fetch timing:
 * - Typically called during first SSR request (when layout.tsx renders)
 * - Happens once per container lifetime (not per request)
 * - Zero overhead after initial fetch
 *
 * Error handling:
 * If backend is unavailable or returns an error, falls back to environment variables.
 * This ensures local development works even if backend isn't running yet,
 * and provides graceful degradation in production if the backend config endpoint fails.
 *
 * @returns Runtime configuration with siteUrl, apiUrl, and socketUrl
 */
export async function getServerConfig(): Promise<RuntimeConfig> {
    // Return cached value if already fetched
    if (cachedConfig) {
        return cachedConfig;
    }

    try {
        const backendUrl = getBackendUrl();
        const response = await fetch(`${backendUrl}/api/config/public`, {
            cache: 'no-store', // Don't let Next.js cache this (we cache manually)
            signal: AbortSignal.timeout(5000) // 5 second timeout
        });

        if (!response.ok) {
            throw new Error(`Config fetch failed: ${response.status}`);
        }

        const data = await response.json();

        if (!data.success || !data.config) {
            throw new Error('Invalid config response format');
        }

        // Cache the config for container lifetime
        cachedConfig = data.config;
        console.log('[ServerConfig] Fetched and cached runtime config from backend:', cachedConfig.siteUrl);

        return cachedConfig;
    } catch (error) {
        // Fallback to environment variables (local dev safety)
        console.warn('[ServerConfig] Failed to fetch runtime config, using environment fallback:', error);

        const fallbackConfig: RuntimeConfig = {
            siteUrl: process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000',
            apiUrl: (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api').replace(/\/$/, ''),
            socketUrl: (process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:4000').replace(/\/$/, '')
        };

        // Cache the fallback config (don't retry every request)
        cachedConfig = fallbackConfig;

        return fallbackConfig;
    }
}

/**
 * Clears the cached configuration.
 *
 * Useful for testing scenarios where you want to force a fresh fetch.
 * Not typically needed in production since config doesn't change during container lifetime.
 *
 * @internal
 */
export function clearServerConfigCache(): void {
    cachedConfig = null;
}
