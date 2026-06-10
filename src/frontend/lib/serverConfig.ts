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
 * - Backend stores siteUrl in MongoDB (editable via /system/system admin UI)
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
 * - The legacy lib/config.ts module was removed; this and lib/runtimeConfig.ts are the only config sources
 */

import { getServerSideApiUrl } from './api-url';

/**
 * TRON blockchain chain parameters for frontend calculations.
 * Subset of IChainParameters containing only the parameters object.
 */
export interface ChainParametersConfig {
    /** Total energy available per day across the network */
    totalEnergyLimit: number;
    /** Current energy limit (may differ from total during adjustments) */
    totalEnergyCurrentLimit: number;
    /** Total TRX frozen/staked for energy across network (in SUN) */
    totalFrozenForEnergy: number;
    /** Derived ratio: energy units per TRX when staking */
    energyPerTrx: number;
    /** Cost to burn energy (SUN per energy unit) */
    energyFee: number;
    /** Total bandwidth available per day across the network */
    totalBandwidthLimit: number;
    /** Total TRX frozen/staked for bandwidth across network (in SUN) */
    totalFrozenForBandwidth: number;
    /** Derived ratio: bandwidth units per TRX when staking */
    bandwidthPerTrx: number;
}

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
    /** TRON blockchain chain parameters for energy/TRX conversions */
    chainParameters: ChainParametersConfig;
    /**
     * Indicates whether this config is using fallback values instead of live data.
     * When true, chain parameters may be stale/approximate.
     * UI should display a warning when this is true.
     */
    isUsingFallback: boolean;
}

/**
 * In-memory cache for a *successful* runtime configuration fetch.
 * Null until the first good fetch, then cached for the container lifetime.
 * Only live config (isUsingFallback: false) is ever stored here.
 */
let cachedConfig: RuntimeConfig | null = null;

/**
 * Short-lived cache for the degraded fallback config.
 *
 * The degraded fallback points the client at the internal backend URL
 * (e.g. http://backend:4000), which the browser cannot reach. If we latched
 * it for the container lifetime, a single transient backend blip during a
 * lazy first fetch would poison every client with mixed-content/unreachable
 * URLs until someone manually restarted the frontend. Instead we cache the
 * fallback for only FALLBACK_RETRY_MS and retry on the next request, so the
 * frontend self-heals within seconds of the backend recovering.
 */
let fallbackConfig: RuntimeConfig | null = null;

/**
 * Timestamp (ms) after which the cached fallback is considered stale and the
 * backend is retried on the next call to getServerConfig().
 */
let fallbackRetryAt = 0;

/**
 * How long to serve the degraded fallback before retrying the backend. Bounds
 * backend load during an outage (at most one retry per window) while keeping
 * recovery fast once the backend is healthy again.
 */
const FALLBACK_RETRY_MS = 10_000;

/**
 * Fetches runtime configuration from backend and caches it.
 *
 * Flow:
 * 1. First call: Fetches from backend /api/config/public
 * 2. After a successful fetch: Returns the cached live config (no fetch)
 * 3. On error: Serves a degraded fallback, cached only briefly, then retries
 *
 * Fetch timing:
 * - Typically called during the first SSR request (when layout.tsx renders)
 * - A successful fetch happens once per container lifetime (zero overhead after)
 * - While degraded, retries at most once per FALLBACK_RETRY_MS until success
 *
 * Error handling:
 * A missing SITE_BACKEND is a deployment error and throws — it is not
 * caught by the fallback below. If the backend is unreachable or returns
 * an error, serves a degraded config (isUsingFallback: true) so SSR keeps
 * rendering, but caches it only briefly (FALLBACK_RETRY_MS) and retries the
 * backend on the next request — the fallback is never latched for the
 * container lifetime, so the frontend self-heals once the backend recovers.
 *
 * @returns Runtime configuration with siteUrl, apiUrl, and socketUrl
 */
export async function getServerConfig(): Promise<RuntimeConfig> {
    // Return the live config if we have one (latched for container lifetime).
    if (cachedConfig) {
        return cachedConfig;
    }

    // Serve the degraded fallback only inside its short retry window. Past it,
    // fall through and re-attempt the backend so recovery is automatic.
    if (fallbackConfig && Date.now() < fallbackRetryAt) {
        return fallbackConfig;
    }

    // Resolved outside the try: a missing SITE_BACKEND must surface as a
    // deployment error, not degrade into the unreachable-backend fallback.
    // Trailing-slash normalization happens inside getServerSideApiUrl().
    const backendUrl = getServerSideApiUrl();

    try {
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

        // Cache the live config for container lifetime and clear any prior
        // degraded fallback so subsequent requests stop serving it.
        cachedConfig = data.config;
        fallbackConfig = null;
        fallbackRetryAt = 0;
        console.log('[ServerConfig] Fetched and cached runtime config from backend:', data.config.siteUrl);

        return data.config;
    } catch (error) {
        // Backend unreachable — degrade so SSR keeps rendering.
        console.warn('[ServerConfig] Failed to fetch runtime config, using fallback:', error);

        const siteUrl = process.env.SITE_URL || 'http://localhost:3000';

        const degraded: RuntimeConfig = {
            siteUrl: siteUrl.replace(/\/$/, ''),
            apiUrl: `${backendUrl}/api`.replace(/\/$/, ''),
            socketUrl: backendUrl.replace(/\/$/, ''),
            chainParameters: {
                totalEnergyLimit: 180_000_000_000,
                totalEnergyCurrentLimit: 180_000_000_000,
                totalFrozenForEnergy: 19_000_000_000_000_000, // ~19B TRX staked for energy (network average)
                energyPerTrx: 9.5, // 180B / 19B TRX (live network ratio)
                energyFee: 100,
                totalBandwidthLimit: 43_200_000_000,
                totalFrozenForBandwidth: 27_000_000_000_000_000, // ~27B TRX staked for bandwidth (network average)
                bandwidthPerTrx: 1.6 // 43.2B / 27B TRX (live network ratio)
            },
            isUsingFallback: true
        };

        // Cache the fallback ONLY briefly. Unlike the live config it is never
        // latched for the container lifetime — once the window elapses the
        // next request retries the backend, so a transient blip cannot poison
        // the frontend until a manual restart.
        fallbackConfig = degraded;
        fallbackRetryAt = Date.now() + FALLBACK_RETRY_MS;

        return degraded;
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
    fallbackConfig = null;
    fallbackRetryAt = 0;
}
