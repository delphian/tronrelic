import { Router, type Request, type Response, type NextFunction } from 'express';
import type { IZoneLayoutConfig } from '@/types';
import { WidgetsService } from '../../modules/widgets/widgets.service.js';
import { logger } from '../../lib/logger.js';

/**
 * Widget SSR API router.
 *
 * Single endpoint: fetches the widgets matching a route with their
 * pre-fetched data, ready to be embedded in the SSR response. The
 * unified `IWidgetsService` (singleton, registered as `'widgets'` on
 * the service registry) is the only consumer entry point — the legacy
 * `/api/widgets/all` and `/api/widgets/zones/:zone` admin reads have
 * been retired; that surface lives at `/api/admin/system/widgets/*`
 * now.
 */
export function widgetRouter(): Router {
    const router = Router();

    /**
     * GET /api/widgets?route=<path>&params=<json>
     *
     * Fetch widgets for a specific route with pre-fetched data.
     *
     * Query params:
     * - route: URL path to match against placement routes (e.g., '/', '/u/TXyz...')
     * - params: Optional JSON-encoded route parameters (e.g., '{"address":"TXyz..."}')
     *
     * Returns:
     * {
     *   widgets: [
     *     {
     *       id: 'widget-type-id',
     *       zone: 'main-after',
     *       pluginId: 'plugin-id',
     *       order: 10,
     *       title: 'Widget Title',
     *       data: { ... }
     *     }
     *   ],
     *   // Effective flexbox layout per zone id, so the SSR renderer can
     *   // arrange each zone's widgets as flex items without a second call.
     *   zones: { 'main-after': { flexDirection: 'column', ... } }
     * }
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

            let params: Record<string, string> = {};
            if (typeof paramsJson === 'string' && paramsJson) {
                try {
                    const parsedParams = JSON.parse(paramsJson);
                    if (typeof parsedParams !== 'object' || parsedParams === null || Array.isArray(parsedParams)) {
                        res.status(400).json({
                            error: '`params` query parameter must be a JSON object.'
                        });
                        return;
                    }
                    params = parsedParams;
                } catch {
                    res.status(400).json({
                        error: 'Invalid JSON in `params` query parameter.'
                    });
                    return;
                }
            }

            // Lazy lookup — the service singleton is configured by
            // `WidgetsModule.init()`, which runs before the HTTP server
            // accepts connections.
            const service = WidgetsService.getInstance();
            const widgets = await service.fetchWidgetsForRoute(route, params);

            // Flatten the zone snapshot to a zoneId → layoutConfig map so
            // the frontend can apply each zone's flexbox layout to its
            // container without resolving the full snapshot client-side.
            const zones: Record<string, IZoneLayoutConfig> = {};
            for (const track of service.listZones().tracks) {
                for (const zone of track.zones) {
                    zones[zone.id] = zone.layoutConfig;
                }
            }

            res.json({ widgets, zones });
        } catch (error) {
            logger.error('Error fetching widgets', {
                error: error instanceof Error ? error.message : String(error),
                route: req.query.route
            });
            next(error);
        }
    });

    return router;
}
