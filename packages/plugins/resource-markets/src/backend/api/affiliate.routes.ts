import type { IPluginContext, IApiRouteConfig } from '@tronrelic/types';
import { MarketAffiliateService } from '../services/market-affiliate.service.js';

/**
 * Creates affiliate tracking API routes.
 *
 * Provides public endpoints for tracking affiliate link impressions and clicks.
 * These endpoints are called by the frontend when users view or click affiliate
 * links, enabling commission attribution and click-through rate analysis.
 *
 * **Public Endpoints:**
 * - `POST /plugins/resource-markets/markets/:guid/affiliate/impression` - Record impression
 * - `POST /plugins/resource-markets/markets/:guid/affiliate/click` - Record click
 *
 * @param context - Plugin context with database and logger access
 * @returns Array of API route configurations
 */
export function createAffiliateRoutes(context: IPluginContext): IApiRouteConfig[] {
    const affiliateService = new MarketAffiliateService(context);

    return [
        /**
         * POST /plugins/resource-markets/markets/:guid/affiliate/impression
         *
         * Records an affiliate link impression.
         *
         * Request body:
         * - `trackingCode` (string, required) - Affiliate tracking code for validation
         *
         * Called when an affiliate link is displayed to a user. Used for tracking
         * affiliate link visibility and calculating click-through rates.
         */
        {
            method: 'POST',
            path: '/markets/:guid/affiliate/impression',
            handler: async (req, res, next) => {
                try {
                    const { guid } = req.params;
                    const { trackingCode } = req.body;

                    if (!trackingCode || typeof trackingCode !== 'string') {
                        res.status(400).json({
                            success: false,
                            error: 'trackingCode is required'
                        });
                        return;
                    }

                    const tracking = await affiliateService.recordImpression(guid, trackingCode);

                    if (!tracking) {
                        res.status(404).json({
                            success: false,
                            error: 'Affiliate tracking not found'
                        });
                        return;
                    }

                    res.json({
                        success: true,
                        tracking
                    });
                } catch (error) {
                    context.logger.error(
                        { error, guid: req.params.guid },
                        'Failed to record affiliate impression'
                    );
                    next(error);
                }
            }
        },

        /**
         * POST /plugins/resource-markets/markets/:guid/affiliate/click
         *
         * Records an affiliate link click.
         *
         * Request body:
         * - `trackingCode` (string, required) - Affiliate tracking code for validation
         *
         * Called when a user clicks an affiliate link. Used for tracking conversion
         * attribution and calculating click-through rates. Updates last click timestamp.
         */
        {
            method: 'POST',
            path: '/markets/:guid/affiliate/click',
            handler: async (req, res, next) => {
                try {
                    const { guid } = req.params;
                    const { trackingCode } = req.body;

                    if (!trackingCode || typeof trackingCode !== 'string') {
                        res.status(400).json({
                            success: false,
                            error: 'trackingCode is required'
                        });
                        return;
                    }

                    const tracking = await affiliateService.recordClick(guid, trackingCode);

                    if (!tracking) {
                        res.status(404).json({
                            success: false,
                            error: 'Affiliate tracking not found'
                        });
                        return;
                    }

                    context.logger.info(
                        { guid, trackingCode, clicks: tracking.clicks },
                        'Affiliate click recorded'
                    );

                    res.json({
                        success: true,
                        tracking
                    });
                } catch (error) {
                    context.logger.error(
                        { error, guid: req.params.guid },
                        'Failed to record affiliate click'
                    );
                    next(error);
                }
            }
        }
    ];
}
