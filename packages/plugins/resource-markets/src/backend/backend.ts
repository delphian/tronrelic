import {
    definePlugin,
    type IPluginContext,
    type IHttpRequest,
    type IHttpResponse,
    type IHttpNext
} from '@tronrelic/types';
import { resourceMarketsManifest } from '../manifest.js';
import { MarketFetcherRegistry } from './fetchers/fetcher-registry.js';
import { refreshMarketsJob } from './jobs/refresh-markets.job.js';
import { createMarketService } from './services/market.service.js';

// Module-level variables for route handlers and lifecycle
let pluginContext: IPluginContext;
let fetcherRegistry: MarketFetcherRegistry | null = null;

export const resourceMarketsBackendPlugin = definePlugin({
    manifest: resourceMarketsManifest,

    /**
     * Install hook - runs once when plugin is installed.
     *
     * Creates database indexes for:
     * - markets collection (query by guid, sort by priority)
     * - price_history collection (query by market and timestamp)
     */
    install: async (context: IPluginContext) => {
        context.logger.info('Installing resource-markets plugin');

        // Create indexes for markets collection
        await context.database.createIndex('markets', {
            guid: 1
        }, { unique: true });

        await context.database.createIndex('markets', {
            priority: 1,
            isActive: 1
        });

        // Create indexes for price history collection
        await context.database.createIndex('price_history', {
            marketGuid: 1,
            timestamp: -1
        });

        context.logger.info('Resource-markets plugin installed successfully');
    },

    /**
     * Uninstall hook - runs when plugin is uninstalled.
     *
     * Collections are automatically deleted by the plugin system (plugin_resource-markets_* prefix).
     */
    uninstall: async (context: IPluginContext) => {
        context.logger.info('Uninstalling resource-markets plugin');
        // Collections auto-deleted by plugin system
    },

    /**
     * Init hook - runs when plugin is enabled.
     *
     * Registers:
     * 1. Market fetchers (14 total)
     * 2. Scheduler job (refreshes markets every 10 minutes)
     * 3. WebSocket subscription handlers (real-time market updates)
     */
    init: async (context: IPluginContext) => {
        context.logger.info('Initializing resource-markets plugin');

        // Store context for route handlers
        pluginContext = context;

        // Initialize fetcher registry with dependency-injected context
        fetcherRegistry = new MarketFetcherRegistry(context);
        fetcherRegistry.initialize();

        // Register scheduler job (every 10 minutes)
        context.scheduler.register(
            'resource-markets:refresh',
            '*/10 * * * *',
            async () => {
                if (!fetcherRegistry) {
                    context.logger.error('Fetcher registry not initialized');
                    return;
                }
                await refreshMarketsJob(context, fetcherRegistry);
            }
        );

        context.logger.info('Registered scheduler job: resource-markets:refresh');

        // Register WebSocket subscription handler
        context.websocket.onSubscribe(async (socket, roomName, payload) => {
            if (roomName === 'market-updates') {
                context.logger.info({ socketId: socket.id }, 'Client subscribed to market updates');

                // Send initial market data
                const marketService = createMarketService(context);
                const markets = await marketService.listActiveMarkets();

                // Emit to specific socket (event auto-prefixed: plugin:resource-markets:initial)
                context.websocket.emitToSocket(socket, 'initial', {
                    markets,
                    timestamp: new Date().toISOString()
                });
            }
        });

        context.logger.info('Registered WebSocket subscription handler');

        // Trigger initial market refresh (don't await - runs in background)
        if (fetcherRegistry) {
            refreshMarketsJob(context, fetcherRegistry).catch(err => {
                context.logger.error({ error: err }, 'Initial market refresh failed');
            });
        }

        context.logger.info('Resource-markets plugin initialized successfully');
    },

    /**
     * Disable hook - runs when plugin is disabled.
     *
     * Cleanup:
     * - Scheduler job is automatically stopped by platform
     * - WebSocket subscriptions automatically cleaned up
     * - API routes automatically unmounted
     * - Data remains in database for future enable
     */
    disable: async (context: IPluginContext) => {
        context.logger.info('Disabling resource-markets plugin');
        fetcherRegistry = null;
    },

    /**
     * Public API routes accessible at /api/plugins/resource-markets/*
     */
    routes: [
        {
            method: 'GET',
            path: '/markets',
            handler: async (_req: IHttpRequest, res: IHttpResponse, next: IHttpNext) => {
                try {
                    const marketService = createMarketService(pluginContext);
                    const markets = await marketService.listActiveMarkets();
                    res.json({
                        success: true,
                        markets,
                        timestamp: new Date().toISOString()
                    });
                } catch (error) {
                    next(error);
                }
            }
        },

        {
            method: 'GET',
            path: '/markets/:guid',
            handler: async (req: IHttpRequest, res: IHttpResponse, next: IHttpNext) => {
                try {
                    const marketService = createMarketService(pluginContext);
                    const market = await marketService.getMarket(req.params.guid);
                    if (!market) {
                        res.status(404).json({
                            success: false,
                            error: 'Market not found'
                        });
                        return;
                    }
                    res.json({
                        success: true,
                        market
                    });
                } catch (error) {
                    next(error);
                }
            }
        },

        {
            method: 'GET',
            path: '/markets/:guid/history',
            handler: async (req: IHttpRequest, res: IHttpResponse, next: IHttpNext) => {
                try {
                    const marketService = createMarketService(pluginContext);
                    const limit = req.query?.limit ? parseInt(req.query.limit as string, 10) : 30;
                    const history = await marketService.getMarketHistory(req.params.guid, limit);
                    res.json({
                        success: true,
                        history
                    });
                } catch (error) {
                    next(error);
                }
            }
        }
    ]
});
