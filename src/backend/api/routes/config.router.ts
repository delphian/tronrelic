import { Router } from 'express';
import type { IBrandingConfig } from '@/types';
import { SystemConfigService } from '../../services/system-config/index.js';
import { ChainParametersService } from '../../modules/chain-parameters/index.js';

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
     *   siteUrl: string,          // Public site URL (e.g., "https://tronrelic.com")
     *   apiUrl: string,           // API base URL (e.g., "https://tronrelic.com/api")
     *   socketUrl: string,        // WebSocket URL (e.g., "https://tronrelic.com")
     *   chainParameters: {        // TRON blockchain parameters for energy/TRX conversions
     *     totalEnergyLimit: number,
     *     totalEnergyCurrentLimit: number,
     *     totalFrozenForEnergy: number,
     *     energyPerTrx: number,
     *     energyFee: number
     *   },
     *   isUsingFallback: boolean  // false when live data, true if frontend falls back to hardcoded values
     * }
     *
     * Caching:
     * - SystemConfigService caches config in memory (1 minute TTL)
     * - ChainParametersService caches parameters in memory (1 minute TTL)
     * - Frontend SSR caches response for container lifetime
     * - Client receives config injected in HTML (no separate fetch needed)
     *
     * Security:
     * No authentication required - exposes only public configuration URLs and chain parameters.
     * Administrators control these values via /system/config admin UI.
     */
    router.get('/public', async (_req, res, next) => {
        try {
            const configService = SystemConfigService.getInstance();
            const chainParamsService = ChainParametersService.getInstance();

            const [siteUrl, apiUrl, socketUrl, chainParams] = await Promise.all([
                configService.getSiteUrl(),
                configService.getApiUrl(),
                configService.getSocketUrl(),
                chainParamsService.getParameters()
            ]);

            res.json({
                success: true,
                config: {
                    siteUrl,
                    apiUrl,
                    socketUrl,
                    chainParameters: chainParams.parameters,
                    isUsingFallback: false // Live data from backend
                }
            });
        } catch (error) {
            next(error);
        }
    });

    /**
     * GET /api/config/branding
     *
     * Returns the settings that change how the site looks to visitors, currently
     * just the image the header shows in place of the sign-in button.
     *
     * Why a separate endpoint from /public:
     * The frontend keeps the /public response for the life of its container,
     * which suits URLs that only change on a redeploy. An administrator edits
     * branding from /system/system and expects the next page load to show it,
     * so the header reads this endpoint on every server render instead. The
     * read is cheap: SystemConfigService answers from memory and drops its
     * cache on every save, so a change is visible straight away.
     *
     * Response format:
     * {
     *   success: true,
     *   branding: { authButtonImageUrl: string | null }
     * }
     *
     * Security:
     * No authentication required. The image URL is already rendered in public
     * HTML, and it was validated when an administrator saved it.
     */
    router.get('/branding', async (_req, res, next) => {
        try {
            const config = await SystemConfigService.getInstance().getConfig();

            // Documents written before the field existed read back without it,
            // so undefined is normalized to null for the frontend.
            const branding: IBrandingConfig = {
                authButtonImageUrl: config.authButtonImageUrl ?? null
            };

            res.json({ success: true, branding });
        } catch (error) {
            next(error);
        }
    });

    return router;
}
