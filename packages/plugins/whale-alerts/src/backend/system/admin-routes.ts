import type { IPluginContext, IApiRouteConfig, IHttpRequest, IHttpResponse, IHttpNext } from '@tronrelic/types';
import type { IWhaleAlertsConfig } from '../../shared/types/index.js';

/**
 * Create admin API route handlers for whale-alerts plugin.
 *
 * These handlers provide administrative endpoints for configuring the whale-alerts
 * plugin. They are automatically mounted under /api/plugins/whale-alerts/system/
 * and require admin authentication.
 *
 * @param context - Plugin context with database access
 * @returns Array of admin route configurations
 */
export function createAdminRoutes(context: IPluginContext): IApiRouteConfig[] {
    return [
        {
            method: 'GET',
            path: '/config',
            handler: async (req: IHttpRequest, res: IHttpResponse, next: IHttpNext) => {
                try {
                    const config = await context.database.get<IWhaleAlertsConfig>('config');

                    if (!config) {
                        // Return default config if none exists
                        const defaultConfig: IWhaleAlertsConfig = {
                            thresholdTRX: 1_000_000,
                            telegramEnabled: false
                        };
                        res.json({ success: true, config: defaultConfig });
                        return;
                    }

                    res.json({ success: true, config });
                } catch (error) {
                    context.logger.error({ error }, 'Failed to fetch whale alerts config');
                    next(error);
                }
            },
            description: 'Get whale alerts configuration (admin only)'
        },
        {
            method: 'PUT',
            path: '/config',
            handler: async (req: IHttpRequest, res: IHttpResponse, next: IHttpNext) => {
                try {
                    const { thresholdTRX, telegramEnabled, telegramChannelId, telegramThreadId } = req.body;

                    // Validate threshold
                    if (typeof thresholdTRX !== 'number' || thresholdTRX < 0) {
                        res.status(400).json({
                            success: false,
                            error: 'Invalid threshold: must be a positive number'
                        });
                        return;
                    }

                    // Build config object
                    const config: IWhaleAlertsConfig = {
                        thresholdTRX,
                        telegramEnabled: Boolean(telegramEnabled),
                        telegramChannelId: telegramChannelId || undefined,
                        telegramThreadId: telegramThreadId ? Number(telegramThreadId) : undefined
                    };

                    // Validate Telegram settings if enabled
                    if (config.telegramEnabled && !config.telegramChannelId) {
                        res.status(400).json({
                            success: false,
                            error: 'Telegram channel ID required when Telegram notifications are enabled'
                        });
                        return;
                    }

                    // Save configuration
                    await context.database.set('config', config);

                    context.logger.info(
                        { config },
                        'Whale alerts configuration updated'
                    );

                    // Broadcast config update to all connected clients
                    // This allows frontends to immediately reflect the new threshold
                    // without needing to poll or refresh the page
                    context.websocket.emitToRoom('config-updates', 'config-updated', {
                        thresholdTRX: config.thresholdTRX,
                        telegramEnabled: config.telegramEnabled,
                        updatedAt: new Date().toISOString()
                    });

                    context.logger.debug(
                        { thresholdTRX: config.thresholdTRX },
                        'Broadcasted config update to all clients'
                    );

                    res.json({ success: true, config });
                } catch (error) {
                    context.logger.error({ error }, 'Failed to update whale alerts config');
                    next(error);
                }
            },
            description: 'Update whale alerts configuration (admin only)'
        }
    ];
}
