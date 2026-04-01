/**
 * @file cors.ts
 *
 * Shared CORS origin configuration used by both the Express HTTP layer and
 * the Socket.IO WebSocket layer. Centralising the allowed-origins list here
 * prevents the two transports from drifting apart.
 */
import { env } from './env.js';

/**
 * Build the list of allowed CORS origins from the environment.
 *
 * Always includes localhost development ports. Adds the configured SITE_URL
 * and its www variant (for bare-domain production URLs) when present.
 *
 * @returns Array of origin strings permitted by CORS policy
 */
export function getAllowedOrigins(): string[] {
    const origins: string[] = [
        'http://localhost:3000',
        'http://localhost:4000'
    ];

    if (env.SITE_URL) {
        try {
            const parsed = new URL(env.SITE_URL.trim());
            const baseOrigin = parsed.origin;
            origins.push(baseOrigin);

            // Add www variant for production domains
            if (parsed.protocol === 'https:' && !parsed.hostname.startsWith('www.')) {
                origins.push(`${parsed.protocol}//www.${parsed.hostname}${parsed.port ? `:${parsed.port}` : ''}`);
            }
        } catch {
            // Invalid SITE_URL — skip rather than crash at startup
        }
    }

    return origins;
}

/** Cached allowed origins — computed once at module load from environment. */
const allowedOrigins = getAllowedOrigins();

/**
 * CORS origin callback compatible with both the `cors` npm package and
 * Socket.IO's `cors.origin` option.
 *
 * Allows requests with no Origin header (curl, Postman, server-to-server)
 * and rejects browser requests from origins not in the allowed list.
 *
 * @param origin - The Origin header value (undefined when absent)
 * @param callback - Node-style callback: (error, allow)
 */
export function corsOriginCallback(
    origin: string | undefined,
    callback: (err: Error | null, allow?: boolean) => void
): void {
    // Allow requests with no origin (mobile apps, curl, Postman, server-to-server)
    if (!origin) {
        callback(null, true);
        return;
    }

    if (allowedOrigins.includes(origin)) {
        callback(null, true);
    } else {
        callback(new Error('CORS policy: Origin not allowed'));
    }
}
