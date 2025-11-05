import type { IPluginContext, IApiRouteConfig } from '@tronrelic/types';
import type { MarketDocument } from '@tronrelic/shared';
import { createMarketService } from '../services/market.service.js';
import type { MarketFetcherRegistry } from '../fetchers/fetcher-registry.js';

/**
 * Creates monitoring API routes for resource-markets plugin.
 *
 * Provides admin endpoints for platform health tracking, data freshness analysis,
 * and manual market refresh triggering.
 *
 * **Admin Endpoints:**
 * - `GET /plugins/resource-markets/system/platforms` - Platform status and reliability
 * - `GET /plugins/resource-markets/system/freshness` - Data age and staleness metrics
 * - `POST /plugins/resource-markets/system/refresh` - Manual market refresh trigger
 *
 * @param context - Plugin context with database, logger, and cache access
 * @param fetcherRegistry - Market fetcher registry for triggering refreshes
 * @returns Array of API route configurations
 */
export function createMonitoringRoutes(
    context: IPluginContext,
    fetcherRegistry: MarketFetcherRegistry | null
): IApiRouteConfig[] {
    const { database, logger } = context;

    return [
        /**
         * GET /plugins/resource-markets/system/platforms
         *
         * Returns health status and reliability metrics for all market platforms.
         *
         * Response includes:
         * - Platform name and GUID
         * - Last fetch timestamp
         * - Status (online/stale/failed/disabled)
         * - Response time
         * - Reliability score (0-100%)
         * - Consecutive failure count
         * - Active/inactive state
         */
        {
            method: 'GET',
            path: '/platforms',
            handler: async (req, res, next) => {
                try {
                    const markets = await database.find<MarketDocument>('markets', {});

                    const platforms = markets.map(market => {
                        const lastFetchedAt = market.lastUpdated;
                        const now = new Date();
                        const ageMinutes = lastFetchedAt
                            ? (now.getTime() - new Date(lastFetchedAt).getTime()) / 1000 / 60
                            : null;

                        // Determine status based on data age and reliability
                        let status: 'online' | 'stale' | 'failed' | 'disabled' = 'online';
                        if (!market.isActive) {
                            status = 'disabled';
                        } else if (ageMinutes === null) {
                            status = 'failed';
                        } else if (ageMinutes > 60) {
                            status = 'stale';
                        } else if (market.reliability !== undefined && market.reliability < 0.5) {
                            status = 'failed';
                        }

                        // Convert reliability from 0-1 to 0-100%
                        const reliabilityScore = market.reliability !== undefined
                            ? market.reliability * 100
                            : 100;

                        return {
                            guid: market.guid,
                            name: market.name,
                            lastFetchedAt: market.lastUpdated,
                            status,
                            responseTime: null, // Not currently tracked
                            reliabilityScore,
                            consecutiveFailures: 0, // Not currently tracked
                            isActive: market.isActive ?? true
                        };
                    });

                    res.json({
                        success: true,
                        platforms
                    });
                } catch (error) {
                    logger.error({ error }, 'Failed to retrieve platform status');
                    next(error);
                }
            }
        },

        /**
         * GET /plugins/resource-markets/system/freshness
         *
         * Returns data freshness metrics across all market platforms.
         *
         * Response includes:
         * - Oldest data age in minutes
         * - Number of stale platforms (data older than 1 hour)
         * - Average data age across all platforms
         * - List of platform names with old data
         */
        {
            method: 'GET',
            path: '/freshness',
            handler: async (req, res, next) => {
                try {
                    const markets = await database.find<MarketDocument>('markets', { isActive: true });
                    const now = new Date();

                    const dataAges = markets
                        .filter(market => market.lastUpdated)
                        .map(market => ({
                            name: market.name,
                            ageMinutes: (now.getTime() - new Date(market.lastUpdated).getTime()) / 1000 / 60
                        }));

                    const stalePlatforms = dataAges.filter(item => item.ageMinutes > 60);
                    const averageDataAge = dataAges.length
                        ? dataAges.reduce((sum, item) => sum + item.ageMinutes, 0) / dataAges.length
                        : 0;

                    const oldestDataAge = dataAges.length
                        ? Math.max(...dataAges.map(item => item.ageMinutes))
                        : null;

                    res.json({
                        success: true,
                        freshness: {
                            oldestDataAge,
                            stalePlatformCount: stalePlatforms.length,
                            averageDataAge,
                            platformsWithOldData: stalePlatforms.map(item => item.name)
                        }
                    });
                } catch (error) {
                    logger.error({ error }, 'Failed to calculate data freshness');
                    next(error);
                }
            }
        },

        /**
         * POST /plugins/resource-markets/system/refresh
         *
         * Triggers a manual refresh of market data for all platforms.
         *
         * Request body:
         * - `force` (optional boolean) - If true, bypasses cache and forces fresh API calls
         *
         * Initiates background refresh job and returns immediately without waiting
         * for completion. Clients should poll the platforms endpoint to see updated data.
         */
        {
            method: 'POST',
            path: '/refresh',
            handler: async (req, res, next) => {
                try {
                    if (!fetcherRegistry) {
                        res.status(503).json({
                            success: false,
                            error: 'Fetcher registry not initialized'
                        });
                        return;
                    }

                    const { force = false } = req.body || {};

                    // Trigger refresh in background (don't await)
                    const marketService = createMarketService(context);
                    const fetchers = fetcherRegistry.list();

                    marketService.refreshAllMarkets(fetchers).catch(error => {
                        logger.error({ error }, 'Manual market refresh failed');
                    });

                    logger.info({ force }, 'Manual market refresh triggered');

                    res.json({
                        success: true,
                        message: 'Market refresh triggered',
                        force
                    });
                } catch (error) {
                    logger.error({ error }, 'Failed to trigger market refresh');
                    next(error);
                }
            }
        }
    ];
}
