/**
 * GeoIP service for deriving country from IP address.
 *
 * Uses geoip-lite for local lookups (no external API calls).
 * IP addresses are never stored - only the derived country code.
 *
 * ## Privacy Design
 *
 * - IP addresses are processed in-memory only, never persisted
 * - Only ISO 3166-1 alpha-2 country codes are stored (e.g., 'US', 'DE')
 * - Country-level geolocation is coarse enough to be privacy-respecting
 * - Compliant with GDPR/CCPA when not combined with other identifiers
 *
 * ## Installation
 *
 * Requires geoip-lite package:
 * ```bash
 * npm install geoip-lite
 * npm install -D @types/geoip-lite
 * ```
 */

import type { DeviceCategory } from '../database/index.js';
import type geoipLite from 'geoip-lite';

// Dynamic import for geoip-lite (optional dependency)
let geoip: typeof geoipLite | null = null;

/**
 * Initialize the GeoIP lookup module.
 * Call this during application bootstrap.
 */
export async function initGeoIP(): Promise<void> {
    try {
        const module = await import('geoip-lite');
        geoip = module.default || module;
    } catch {
        console.error('[GeoService] Failed to load geoip-lite. Country detection disabled.');
    }
}

/**
 * Look up country code from IP address.
 *
 * @param ip - IPv4 or IPv6 address
 * @returns ISO 3166-1 alpha-2 country code (e.g., 'US') or null if not found
 */
export function getCountryFromIP(ip: string | undefined): string | null {
    if (!ip || !geoip) {
        return null;
    }

    try {
        // Handle IPv6-mapped IPv4 addresses
        const cleanIP = ip.replace(/^::ffff:/, '');
        const lookup = geoip.lookup(cleanIP);
        return lookup?.country || null;
    } catch {
        return null;
    }
}

/**
 * Extract domain from referrer URL.
 *
 * Only stores the domain, never the full URL (privacy).
 *
 * @param referrer - Full referrer URL
 * @returns Domain only (e.g., 'twitter.com') or null if invalid/empty
 */
export function extractReferrerDomain(referrer: string | undefined): string | null {
    if (!referrer) {
        return null;
    }

    try {
        const url = new URL(referrer);
        // Remove 'www.' prefix for consistency
        return url.hostname.replace(/^www\./, '');
    } catch {
        return null;
    }
}

/**
 * Derive device category from user-agent string.
 *
 * Uses simple pattern matching - no fingerprinting, no full UA storage.
 * Input is truncated to prevent ReDoS attacks from malicious user-agents.
 *
 * @param userAgent - User-agent header value
 * @returns Coarse device category
 */
export function getDeviceCategory(userAgent: string | undefined): DeviceCategory {
    if (!userAgent) {
        return 'unknown';
    }

    // Truncate to prevent ReDoS attacks (500 chars is plenty for device detection)
    const ua = userAgent.slice(0, 500).toLowerCase();

    // Check for Android mobile (avoid ReDoS-prone `android.*mobile` pattern)
    const isAndroid = ua.includes('android');
    const hasMobile = ua.includes('mobile');

    // Check mobile first (most specific patterns)
    if (
        /mobile|iphone|ipod|windows phone|blackberry|opera mini|iemobile/.test(ua) ||
        (isAndroid && hasMobile)
    ) {
        return 'mobile';
    }

    // Check tablet (Android without 'mobile' keyword is typically tablet)
    if (
        /tablet|ipad|kindle|silk/.test(ua) ||
        (isAndroid && !hasMobile)
    ) {
        return 'tablet';
    }

    // Default to desktop for other browsers
    if (
        /mozilla|chrome|safari|firefox|edge|opera|msie|trident/.test(ua)
    ) {
        return 'desktop';
    }

    return 'unknown';
}

/**
 * Extract client IP from Express request.
 *
 * Handles X-Forwarded-For header for reverse proxy setups.
 * IP is used for lookup only, never stored.
 *
 * @param req - Express request object
 * @returns Client IP address
 */
export function getClientIP(req: { ip?: string; headers: Record<string, string | string[] | undefined> }): string | undefined {
    // Check X-Forwarded-For header (from reverse proxy)
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) {
        const ips = Array.isArray(forwarded) ? forwarded[0] : forwarded;
        // Take the first IP (original client)
        return ips.split(',')[0].trim();
    }

    // Fall back to direct connection IP
    return req.ip;
}
