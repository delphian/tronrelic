import type { IPluginContext, IApiRouteConfig } from '@tronrelic/types';
import type { MarketFetcherRegistry } from '../fetchers/fetcher-registry.js';
import { MarketAdminService, type AffiliateInput } from '../services/market-admin.service.js';

/**
 * Creates market administration API routes.
 *
 * Provides admin endpoints for:
 * - Updating market display priority (leaderboard ordering)
 * - Enabling/disabling individual markets
 * - Configuring affiliate links and commission tracking
 * - Refreshing specific markets on demand
 *
 * **Admin Endpoints (auto-prefixed with `/system/`):**
 * - `GET /plugins/resource-markets/system/markets` - List all markets
 * - `PATCH /plugins/resource-markets/system/markets/:guid/priority` - Update priority
 * - `PATCH /plugins/resource-markets/system/markets/:guid/status` - Enable/disable market
 * - `PATCH /plugins/resource-markets/system/markets/:guid/affiliate` - Configure affiliate
 * - `POST /plugins/resource-markets/system/markets/:guid/refresh` - Refresh single market
 *
 * @param context - Plugin context with database, logger, and cache access
 * @param fetcherRegistry - Market fetcher registry for refresh operations
 * @returns Array of API route configurations
 */
export function createAdminRoutes(
    context: IPluginContext,
    fetcherRegistry: MarketFetcherRegistry | null
): IApiRouteConfig[] {
    const adminService = new MarketAdminService(context, fetcherRegistry);

    return [
        /**
         * GET /plugins/resource-markets/system/markets
         *
         * Lists all markets (active and inactive) sorted by priority.
         * Useful for admin UI to show complete market configuration.
         */
        {
            method: 'GET',
            path: '/markets',
            handler: async (req, res, next) => {
                try {
                    const markets = await adminService.listAll();
                    res.json({
                        success: true,
                        markets,
                        timestamp: Date.now()
                    });
                } catch (error) {
                    context.logger.error({ error }, 'Failed to list all markets');
                    next(error);
                }
            }
        },

        /**
         * PATCH /plugins/resource-markets/system/markets/:guid/priority
         *
         * Updates market display priority.
         *
         * Request body:
         * - `priority` (number, 0-9999) - New priority value
         *
         * Lower priority values appear first in leaderboard.
         */
        {
            method: 'PATCH',
            path: '/markets/:guid/priority',
            handler: async (req, res, next) => {
                try {
                    const { guid } = req.params;
                    const { priority } = req.body;

                    if (typeof priority !== 'number' || priority < 0 || priority > 9999) {
                        res.status(400).json({
                            success: false,
                            error: 'Priority must be a number between 0 and 9999'
                        });
                        return;
                    }

                    const market = await adminService.setPriority(guid, priority);

                    context.logger.info({ guid, priority }, 'Market priority updated');

                    res.json({
                        success: true,
                        market
                    });
                } catch (error) {
                    context.logger.error({ error, guid: req.params.guid }, 'Failed to update market priority');
                    next(error);
                }
            }
        },

        /**
         * PATCH /plugins/resource-markets/system/markets/:guid/status
         *
         * Enables or disables a market from public display.
         *
         * Request body:
         * - `isActive` (boolean) - Active status (true = visible, false = hidden)
         */
        {
            method: 'PATCH',
            path: '/markets/:guid/status',
            handler: async (req, res, next) => {
                try {
                    const { guid } = req.params;
                    const { isActive } = req.body;

                    if (typeof isActive !== 'boolean') {
                        res.status(400).json({
                            success: false,
                            error: 'isActive must be a boolean'
                        });
                        return;
                    }

                    const market = await adminService.setActive(guid, isActive);

                    context.logger.info({ guid, isActive }, 'Market status updated');

                    res.json({
                        success: true,
                        market
                    });
                } catch (error) {
                    context.logger.error({ error, guid: req.params.guid }, 'Failed to update market status');
                    next(error);
                }
            }
        },

        /**
         * PATCH /plugins/resource-markets/system/markets/:guid/affiliate
         *
         * Configures affiliate tracking for a market.
         *
         * Request body:
         * - `link` (string, optional) - Affiliate link URL (empty to remove)
         * - `commission` (number, optional) - Commission rate percentage (0-100)
         * - `cookieDuration` (number, optional) - Cookie duration in days
         */
        {
            method: 'PATCH',
            path: '/markets/:guid/affiliate',
            handler: async (req, res, next) => {
                try {
                    const { guid } = req.params;
                    const { link, commission, cookieDuration } = req.body as AffiliateInput;

                    // Validate commission if provided
                    if (commission !== undefined && commission !== null) {
                        if (typeof commission !== 'number' || commission < 0 || commission > 100) {
                            res.status(400).json({
                                success: false,
                                error: 'Commission must be a number between 0 and 100'
                            });
                            return;
                        }
                    }

                    // Validate cookieDuration if provided
                    if (cookieDuration !== undefined && cookieDuration !== null) {
                        if (typeof cookieDuration !== 'number' || cookieDuration < 1) {
                            res.status(400).json({
                                success: false,
                                error: 'cookieDuration must be a positive number'
                            });
                            return;
                        }
                    }

                    const market = await adminService.updateAffiliate(guid, {
                        link,
                        commission,
                        cookieDuration
                    });

                    context.logger.info({ guid, link }, 'Market affiliate configuration updated');

                    res.json({
                        success: true,
                        market
                    });
                } catch (error) {
                    context.logger.error({ error, guid: req.params.guid }, 'Failed to update market affiliate');
                    next(error);
                }
            }
        },

        /**
         * POST /plugins/resource-markets/system/markets/:guid/refresh
         *
         * Triggers manual refresh for a specific market.
         *
         * Request body:
         * - `force` (boolean, optional) - Force refresh even if cached data is recent
         *
         * Initiates background refresh and returns immediately. Poll market
         * endpoints to see updated data.
         */
        {
            method: 'POST',
            path: '/markets/:guid/refresh',
            handler: async (req, res, next) => {
                try {
                    const { guid } = req.params;
                    const { force = false } = req.body || {};

                    // Trigger refresh in background
                    adminService.refresh(guid, Boolean(force)).catch(error => {
                        context.logger.error({ error, guid }, 'Market refresh failed');
                    });

                    context.logger.info({ guid, force }, 'Market refresh triggered');

                    res.json({
                        success: true,
                        message: `Market ${guid} refresh triggered`,
                        force: Boolean(force)
                    });
                } catch (error) {
                    context.logger.error({ error, guid: req.params.guid }, 'Failed to trigger market refresh');
                    next(error);
                }
            }
        }
    ];
}
