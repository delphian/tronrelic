import { definePlugin, type IPluginContext, type IApiRouteConfig, type IHttpRequest, type IHttpResponse, type IHttpNext } from '@tronrelic/types';
import { whaleAlertsManifest } from '../manifest.js';
import type { IWhaleAlertsConfig, IWhaleTransaction, IWhaleTimeseriesPoint, IWhaleHighlight } from '../shared/types/index.js';
import { createWhaleIndexes } from './install-indexes.js';
import { createAdminRoutes } from './system/admin-routes.js';

// Store context for API handlers
let pluginContext: IPluginContext;

export const whaleAlertsBackendPlugin = definePlugin({
    manifest: whaleAlertsManifest,

    install: async (context: IPluginContext) => {
        context.logger.info('Installing whale-alerts plugin');

        // Create indexes
        await createWhaleIndexes(context);

        // Seed default configuration
        const existingConfig = await context.database.get<IWhaleAlertsConfig>('config');
        if (!existingConfig) {
            const defaultConfig: IWhaleAlertsConfig = {
                thresholdTRX: 1_000_000,
                telegramEnabled: false
            };
            await context.database.set('config', defaultConfig);
            context.logger.info({ config: defaultConfig }, 'Created default whale alerts configuration');
        }

        context.logger.info('Whale-alerts plugin installed successfully');
    },

    uninstall: async (context: IPluginContext) => {
        context.logger.info('Uninstalling whale-alerts plugin');

        try {
            const collection = context.database.getCollection('transactions');
            await collection.drop();
            context.logger.info('Dropped whale transactions collection');
        } catch (error) {
            context.logger.warn({ error }, 'Failed to drop transactions collection (may not exist)');
        }

        try {
            await context.database.delete('config');
            context.logger.info('Deleted whale alerts configuration');
        } catch (error) {
            context.logger.warn({ error }, 'Failed to delete configuration');
        }

        context.logger.info('Whale-alerts plugin uninstalled');
    },

    enable: async (context: IPluginContext) => {
        context.logger.info('Whale alerts plugin enabled');
    },

    disable: async (context: IPluginContext) => {
        // Clean up Telegram notification interval
        const interval = (global as any).__whaleAlertsTelegramInterval;
        if (interval) {
            clearInterval(interval);
            delete (global as any).__whaleAlertsTelegramInterval;
            context.logger.info('Telegram notification service stopped');
        }
        context.logger.info('Whale alerts plugin disabled');
    },

    init: async (context: IPluginContext) => {
        pluginContext = context;

        // Register admin routes dynamically with context
        whaleAlertsBackendPlugin.adminRoutes = createAdminRoutes(context);

        // Register WebSocket subscription handler
        context.websocket.onSubscribe(async (socket, roomName, payload) => {
            // roomName is already provided by the client (e.g., 'large-transfer', 'config-updates')
            // Room is already auto-joined by the manager as 'plugin:whale-alerts:{roomName}'
            // No need to manually call joinRoom

            context.logger.debug(
                { socketId: socket.id, roomName, payload },
                'Client subscribed to whale alerts'
            );

            // Send confirmation event to client
            context.websocket.emitToSocket(socket, 'subscribed', {
                room: roomName,
                status: 'subscribed'
            });

            // If subscribing to config-updates, send current config immediately
            if (roomName === 'config-updates') {
                const config = await context.database.get<IWhaleAlertsConfig>('config');
                if (config) {
                    context.websocket.emitToSocket(socket, 'config-updated', {
                        thresholdTRX: config.thresholdTRX,
                        telegramEnabled: config.telegramEnabled,
                        updatedAt: new Date().toISOString()
                    });
                }
            }
        });

        // Register WebSocket unsubscribe handler
        context.websocket.onUnsubscribe(async (socket, roomName, payload) => {
            // Room is already auto-left by the manager
            // Just clean up any socket-specific data if needed

            context.logger.debug(
                { socketId: socket.id, roomName },
                'Client unsubscribed from whale alerts'
            );
        });

        const { createWhaleDetectionObserver } = await import('./whale-detection.observer.js');
        const { TelegramNotifier } = await import('./telegram-notifier.js');

        createWhaleDetectionObserver(
            context.BaseObserver,
            context.observerRegistry,
            context.websocket,
            context.database,
            context.logger
        );

        context.logger.info('Whale detection observer initialized');

        /**
         * DEPRECATED: Direct Telegram integration in whale-alerts plugin.
         *
         * This functionality will be removed in a future version. The telegram-bot plugin
         * now provides a centralized Telegram service that other plugins should use.
         *
         * Future implementation:
         * - The telegram-bot plugin will expose ITelegramBotService via IPluginContext
         * - whale-alerts will consume that service instead of direct Telegram API calls
         * - Configuration will move to telegram-bot plugin settings
         *
         * For now, this code remains functional but is disabled by default (no TELEGRAM_TOKEN).
         * See telegram-bot plugin for the recommended Telegram integration approach.
         */
        const telegramToken = process.env.TELEGRAM_TOKEN;
        if (telegramToken) {
            context.logger.warn(
                'DEPRECATED: whale-alerts uses legacy Telegram integration. ' +
                'Please migrate to telegram-bot plugin service when available.'
            );

            const notifier = new TelegramNotifier(context.database, context.logger, telegramToken);

            // Send notifications every 30 seconds
            const notificationInterval = setInterval(async () => {
                try {
                    await notifier.sendPendingNotifications();
                } catch (error) {
                    context.logger.error({ error }, 'Failed to process Telegram notifications');
                }
            }, 30000);

            context.logger.info('Telegram notification service started (legacy mode)');

            // Store interval for cleanup in disable hook
            (global as any).__whaleAlertsTelegramInterval = notificationInterval;
        } else {
            context.logger.debug('TELEGRAM_TOKEN not set, Telegram notifications disabled (use telegram-bot plugin instead)');
        }
    },

    routes: [
        {
            method: 'GET',
            path: '/highlights',
            handler: async (req: IHttpRequest, res: IHttpResponse, next: IHttpNext) => {
                try {
                    const limit = Math.min(Number(req.query.limit) || 10, 50);

                    const transactions = await pluginContext.database.find<IWhaleTransaction>(
                        'transactions',
                        {},
                        {
                            sort: { timestamp: -1 },
                            limit
                        }
                    );

                    const highlights: IWhaleHighlight[] = transactions.map(tx => ({
                        txId: tx.txId,
                        timestamp: tx.timestamp,
                        amountTRX: tx.amountTRX,
                        fromAddress: tx.fromAddress,
                        toAddress: tx.toAddress
                    }));

                    res.json({ success: true, highlights });
                } catch (error) {
                    next(error);
                }
            },
            description: 'Get recent whale transaction highlights'
        },
        {
            method: 'GET',
            path: '/timeseries',
            handler: async (req: IHttpRequest, res: IHttpResponse, next: IHttpNext) => {
                try {
                    const days = Math.min(Number(req.query.days) || 14, 90);
                    const startDate = new Date();
                    startDate.setDate(startDate.getDate() - days);

                    const collection = pluginContext.database.getCollection('transactions');

                    const aggregationResult = await collection.aggregate<IWhaleTimeseriesPoint>([
                        {
                            $match: {
                                timestamp: { $gte: startDate }
                            }
                        },
                        {
                            $group: {
                                _id: {
                                    $dateToString: { format: '%Y-%m-%d', date: '$timestamp' }
                                },
                                volume: { $sum: '$amountTRX' },
                                max: { $max: '$amountTRX' },
                                count: { $sum: 1 }
                            }
                        },
                        {
                            $sort: { _id: 1 }
                        },
                        {
                            $project: {
                                _id: 0,
                                date: '$_id',
                                volume: 1,
                                max: 1,
                                count: 1
                            }
                        }
                    ]).toArray();

                    res.json({ success: true, series: aggregationResult });
                } catch (error) {
                    next(error);
                }
            },
            description: 'Get whale transaction timeseries data'
        },
        {
            method: 'GET',
            path: '/config',
            handler: async (req: IHttpRequest, res: IHttpResponse, next: IHttpNext) => {
                try {
                    const config = await pluginContext.database.get<IWhaleAlertsConfig>('config');
                    res.json({ success: true, config });
                } catch (error) {
                    next(error);
                }
            },
            description: 'Get whale alerts configuration'
        },
        {
            method: 'PUT',
            path: '/config',
            handler: async (req: IHttpRequest, res: IHttpResponse, next: IHttpNext) => {
                try {
                    const { thresholdTRX, telegramEnabled, telegramChannelId, telegramThreadId } = req.body;

                    const config: IWhaleAlertsConfig = {
                        thresholdTRX: Number(thresholdTRX) || 250_000,
                        telegramEnabled: Boolean(telegramEnabled),
                        telegramChannelId,
                        telegramThreadId: telegramThreadId ? Number(telegramThreadId) : undefined
                    };

                    await pluginContext.database.set('config', config);

                    res.json({ success: true, config });
                } catch (error) {
                    next(error);
                }
            },
            description: 'Update whale alerts configuration (public)'
        }
    ] as IApiRouteConfig[],

    adminRoutes: [] // Populated dynamically in init hook
});
