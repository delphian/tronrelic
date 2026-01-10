/**
 * Runtime Configuration for Client-Side Code
 *
 * This module provides the SINGLE SOURCE OF TRUTH for all URL configuration used by client-side code.
 * It reads configuration from window.__RUNTIME_CONFIG__ which is injected into the HTML by SSR.
 *
 * Why this exists:
 * Next.js production builds inline NEXT_PUBLIC_* environment variables at build time,
 * making Docker images domain-specific. By injecting configuration from SSR into the HTML,
 * we enable universal Docker images that work on any domain without rebuilding.
 *
 * Architecture:
 * - Backend stores siteUrl in MongoDB (editable via /system/config admin UI)
 * - SSR fetches config from backend once at container startup (see lib/serverConfig.ts)
 * - SSR injects config into HTML as <script>window.__RUNTIME_CONFIG__ = {...}</script>
 * - Client code reads from window.__RUNTIME_CONFIG__ (this module)
 * - No client-side HTTP fetch needed (config already in DOM)
 *
 * Usage pattern:
 * ```typescript
 * // In client components, hooks, event handlers
 * import { getRuntimeConfig } from '@/lib/runtimeConfig';
 *
 * export function MyClientComponent() {
 *   const config = getRuntimeConfig(); // Synchronous!
 *   const socket = io(config.socketUrl);
 *   // ... rest of component
 * }
 * ```
 *
 * IMPORTANT:
 * - ONLY call this from client-side code (client components, hooks, event handlers)
 * - DO NOT call from server components (use getServerConfig() instead)
 * - DO NOT import lib/config.ts in new code (deprecated, uses build-time values)
 * - This function is SYNCHRONOUS (no await needed)
 */

'use client';

/**
 * TRON blockchain chain parameters for frontend calculations.
 * Must match ChainParametersConfig from lib/serverConfig.ts.
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
 * Runtime configuration shape injected by SSR.
 * Must match RuntimeConfig from lib/serverConfig.ts.
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
 * Global window type extension for TypeScript.
 * Declares that window may have __RUNTIME_CONFIG__ injected by SSR.
 */
declare global {
    interface Window {
        __RUNTIME_CONFIG__?: RuntimeConfig;
    }
}

/**
 * Gets runtime configuration from SSR-injected global variable.
 *
 * Flow:
 * 1. SSR fetches config from backend during layout.tsx render
 * 2. SSR injects <script>window.__RUNTIME_CONFIG__ = {...}</script> into HTML
 * 3. Browser loads page with config already in window object
 * 4. This function reads from window.__RUNTIME_CONFIG__ (synchronous, instant)
 *
 * Fallback behavior:
 * If window.__RUNTIME_CONFIG__ is undefined (shouldn't happen in production),
 * falls back to environment variables for local development safety.
 *
 * Why synchronous:
 * Config is already in the DOM from SSR injection, no async fetch needed.
 * This allows WebSocket initialization and other client code to be synchronous,
 * simplifying component logic and avoiding loading states.
 *
 * Error handling:
 * - Throws if called server-side (enforces client-only usage)
 * - Falls back to env vars if __RUNTIME_CONFIG__ is missing
 * - Logs warning if fallback is used (indicates SSR injection failed)
 *
 * @returns Runtime configuration with siteUrl, apiUrl, and socketUrl
 * @throws Error if called server-side (use getServerConfig() instead)
 */
export function getRuntimeConfig(): RuntimeConfig {
    // Enforce client-only usage
    if (typeof window === 'undefined') {
        throw new Error(
            'getRuntimeConfig() can only be called client-side. ' +
            'For server-side code, use getServerConfig() from lib/serverConfig.ts'
        );
    }

    // Read from SSR-injected global variable
    if (window.__RUNTIME_CONFIG__) {
        return window.__RUNTIME_CONFIG__;
    }

    // Fallback to dynamic detection (shouldn't happen in production)
    console.warn(
        '[RuntimeConfig] window.__RUNTIME_CONFIG__ is undefined, using dynamic fallback. ' +
        'This indicates SSR config injection failed. Check layout.tsx and backend /api/config/public.'
    );

    // Dynamically construct config from window.location
    const protocol = window.location.protocol;
    const hostname = window.location.hostname;
    const isLocalhost = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(hostname);

    const siteUrl = isLocalhost
        ? `${protocol}//${hostname}:3000`
        : `${protocol}//${hostname}`;

    const backendUrl = isLocalhost
        ? `${protocol}//${hostname}:4000`
        : `${protocol}//${hostname}`;

    const fallbackConfig: RuntimeConfig = {
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

    // Cache the fallback in window for consistency
    window.__RUNTIME_CONFIG__ = fallbackConfig;

    return fallbackConfig;
}
