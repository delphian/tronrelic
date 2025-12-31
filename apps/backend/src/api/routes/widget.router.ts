import { Router, type Request, type Response, type NextFunction } from 'express';
import { WidgetService } from '../../services/widget/widget.service.js';
import { logger } from '../../lib/logger.js';
import { requireAdmin } from '../middleware/admin-auth.js';

/**
 * Widget API router.
 *
 * Provides endpoints for fetching widget data during SSR. The primary endpoint
 * accepts a route parameter and returns all widgets that should render on that
 * route with their pre-fetched data.
 *
 * This router follows the SSR data-fetching pattern used by themes and user data,
 * where the frontend makes server-side requests to fetch structured data before
 * rendering.
 */
export function widgetRouter(): Router {
    const router = Router();
    const widgetService = WidgetService.getInstance(logger);

    /**
     * GET /api/widgets?route=<path>&params=<json>
     *
     * Fetch widgets for a specific route with pre-fetched data.
     *
     * Query params:
     * - route: URL path to match against widget routes (e.g., '/', '/u/TXyz...')
     * - params: Optional JSON-encoded route parameters (e.g., '{"address":"TXyz..."}')
     *
     * Returns:
     * {
     *   widgets: [
     *     {
     *       id: 'widget-id',
     *       zone: 'main-after',
     *       pluginId: 'plugin-id',
     *       order: 10,
     *       title: 'Widget Title',
     *       data: { ... }
     *     }
     *   ]
     * }
     *
     * @example
     * GET /api/widgets?route=/
     * Returns widgets registered for the homepage
     *
     * @example
     * GET /api/widgets?route=/u/TXyz123&params={"address":"TXyz123"}
     * Returns widgets for profile page with address context
     */
    router.get('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const { route, params: paramsJson } = req.query;

            if (typeof route !== 'string' || !route) {
                res.status(400).json({
                    error: 'A single string `route` query parameter is required.'
                });
                return;
            }

            // Parse optional params from JSON
            let params: Record<string, string> = {};
            if (typeof paramsJson === 'string' && paramsJson) {
                try {
                    params = JSON.parse(paramsJson);
                } catch {
                    res.status(400).json({
                        error: 'Invalid JSON in `params` query parameter.'
                    });
                    return;
                }
            }

            const widgets = await widgetService.fetchWidgetsForRoute(route, params);

            res.json({ widgets });
        } catch (error) {
            logger.error('Error fetching widgets', {
                error: error instanceof Error ? error.message : String(error),
                route: req.query.route
            });
            next(error);
        }
    });

    /**
     * GET /api/widgets/all
     *
     * Get all registered widgets (without data fetching).
     *
     * Requires admin authentication. Useful for admin interfaces that need
     * to display the widget registry. This endpoint does not execute
     * fetchData() functions.
     *
     * Returns:
     * {
     *   widgets: [
     *     {
     *       id: 'widget-id',
     *       zone: 'main-after',
     *       routes: ['/'],
     *       order: 10,
     *       title: 'Widget Title',
     *       pluginId: 'plugin-id'
     *     }
     *   ]
     * }
     */
    router.get('/all', requireAdmin, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const widgets = widgetService.getAllWidgets();
            res.json({ widgets });
        } catch (error) {
            logger.error('Error fetching all widgets', {
                error: error instanceof Error ? error.message : String(error)
            });
            next(error);
        }
    });

    /**
     * GET /api/widgets/zones/:zone
     *
     * Get widgets for a specific zone (without data fetching).
     *
     * Requires admin authentication. Useful for admin interfaces that need
     * to show which widgets are in each zone. This endpoint does not execute
     * fetchData() functions.
     *
     * Returns:
     * {
     *   zone: 'main-after',
     *   widgets: [
     *     {
     *       id: 'widget-id',
     *       zone: 'main-after',
     *       routes: ['/'],
     *       order: 10,
     *       title: 'Widget Title',
     *       pluginId: 'plugin-id'
     *     }
     *   ]
     * }
     */
    router.get('/zones/:zone', requireAdmin, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const { zone } = req.params;
            const widgets = widgetService.getWidgetsByZone(zone);

            res.json({
                zone,
                widgets
            });
        } catch (error) {
            logger.error('Error fetching widgets by zone', {
                error: error instanceof Error ? error.message : String(error),
                zone: req.params.zone
            });
            next(error);
        }
    });

    return router;
}
