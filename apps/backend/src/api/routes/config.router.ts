import { Router } from 'express';
import { SystemConfigService } from '../../services/system-config/index.js';

/**
 * Creates the public configuration router.
 *
 * This router exposes runtime configuration that the frontend needs to operate correctly.
 * Unlike admin endpoints, these routes are unauthenticated because they provide non-sensitive
 * configuration data that the browser needs before it can authenticate.
 *
 * Why this exists:
 * Next.js production builds inline NEXT_PUBLIC_* environment variables at build time,
 * making Docker images domain-specific. By exposing runtime configuration through an API,
 * we enable universal Docker images that work on any domain (tronrelic.com, dev.tronrelic.com, etc.)
 * without rebuilding. Administrators configure the domain via /system/config admin UI,
 * and this endpoint exposes that configuration to both SSR and client-side code.
 *
 * @returns Express router with public configuration endpoints
 */
export function configRouter() {
    const router = Router();

    /**
     * GET /api/config/public
     *
     * Returns runtime configuration for the frontend application.
     * Used by both SSR (during server startup) and client-side code (injected via HTML).
     *
     * Response format:
     * {
     *   siteUrl: string,    // Public site URL (e.g., "https://tronrelic.com")
     *   apiUrl: string,     // API base URL (e.g., "https://tronrelic.com/api")
     *   socketUrl: string   // WebSocket URL (e.g., "https://tronrelic.com")
     * }
     *
     * Caching:
     * - SystemConfigService caches config in memory (1 minute TTL)
     * - Frontend SSR caches response for container lifetime
     * - Client receives config injected in HTML (no separate fetch needed)
     *
     * Security:
     * No authentication required - exposes only public configuration URLs.
     * Administrators control these values via /system/config admin UI.
     */
    router.get('/public', async (_req, res, next) => {
        try {
            const configService = SystemConfigService.getInstance();
            const siteUrl = await configService.getSiteUrl();
            const apiUrl = await configService.getApiUrl();
            const socketUrl = await configService.getSocketUrl();

            res.json({
                success: true,
                config: {
                    siteUrl,
                    apiUrl,
                    socketUrl
                }
            });
        } catch (error) {
            next(error);
        }
    });

    return router;
}
