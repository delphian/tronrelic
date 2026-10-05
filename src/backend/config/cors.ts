/**
 * @file cors.ts
 *
 * Shared CORS origin configuration used by both the Express HTTP layer and
 * the Socket.IO WebSocket layer. Centralising the allowed-origins list here
 * prevents the two transports from drifting apart.
 */
import { env } from './env.js';
import { CorsOriginRejectedError } from './CorsOriginRejectedError.js';

/**
 * Build the list of allowed CORS origins from the environment.
 *
 * Adds the configured SITE_URL and its www variant (for bare-domain production
 * URLs) when present. The localhost development ports are added only outside
 * production: in production they would let any page served from a visitor's
 * own machine make credentialed requests and open sockets as that visitor.
 * Production is detected with the same rule as elsewhere — either `NODE_ENV`
 * or `ENV` set to `production`.
 *
 * @param environment - The settings that decide the list; defaults to the
 *   loaded env, and is a parameter so tests can check both cases.
 * @returns Array of origin strings permitted by CORS policy
 */
export function getAllowedOrigins(
    environment: Pick<typeof env, 'SITE_URL' | 'NODE_ENV' | 'ENV'> = env
): string[] {
    const isProduction = environment.NODE_ENV === 'production' || environment.ENV === 'production';
    const origins: string[] = isProduction
        ? []
        : ['http://localhost:3000', 'http://localhost:4000'];

    if (environment.SITE_URL) {
        try {
            const parsed = new URL(environment.SITE_URL.trim());
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
 * and rejects browser requests from origins not in the allowed list with a
 * `CorsOriginRejectedError`, which the Express error handler answers as a 403
 * and logs as a warning naming the refused origin.
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
        callback(new CorsOriginRejectedError(origin));
    }
}
