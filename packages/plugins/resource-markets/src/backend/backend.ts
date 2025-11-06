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
import { createConfigRoutes } from './api/config.routes.js';
import { createMonitoringRoutes } from './api/monitoring.routes.js';
import { createAdminRoutes } from './api/admin.routes.js';
import { createAffiliateRoutes } from './api/affiliate.routes.js';
import { DEFAULT_CONFIG, type IResourceMarketsConfig } from '../shared/types/config.js';

// Module-level variables for route handlers and lifecycle
let pluginContext: IPluginContext;
let fetcherRegistry: MarketFetcherRegistry | null = null;

export const resourceMarketsBackendPlugin = definePlugin({
    manifest: resourceMarketsManifest,

    /**
     * Install hook - runs once when plugin is installed.
     *
     * Creates database indexes for all plugin collections:
     * - markets: Query by guid, sort by priority
     * - price_history: Query by market and timestamp
     * - reliability: Query by guid for reliability tracking
     * - reliability_history: Query by guid and timestamp for trend analysis
     * - affiliate_tracking: Query by guid and trackingCode for impressions/clicks
     *
     * Seeds default configuration for public page URL and menu settings.
     */
    install: async (context: IPluginContext) => {
        context.logger.info('Installing resource-markets plugin');

        // Markets collection indexes
        await context.database.createIndex('markets', {
            guid: 1
        }, { unique: true });

        await context.database.createIndex('markets', {
            priority: 1,
            isActive: 1
        });

        // Price history collection indexes
        await context.database.createIndex('price_history', {
            marketGuid: 1,
            timestamp: -1
        });

        // Reliability collection indexes
        await context.database.createIndex('reliability', {
            guid: 1
        }, { unique: true });

        // Reliability history collection indexes
        await context.database.createIndex('reliability_history', {
            guid: 1,
            recordedAt: -1
        });

        // Affiliate tracking collection indexes
        await context.database.createIndex('affiliate_tracking', {
            guid: 1
        }, { unique: true });

        await context.database.createIndex('affiliate_tracking', {
            guid: 1,
            trackingCode: 1
        });

        // Seed default configuration
        await context.database.set('config', DEFAULT_CONFIG);
        context.logger.info({ config: DEFAULT_CONFIG }, 'Seeded default configuration');

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
     * 1. Navigation menu item (using configured URL and settings)
     * 2. Market fetchers (14 total)
     * 3. Scheduler job (refreshes markets every 10 minutes)
     * 4. WebSocket subscription handlers (real-time market updates)
     */
    init: async (context: IPluginContext) => {
        context.logger.info('Initializing resource-markets plugin');

        // Store context for route handlers
        pluginContext = context;

        // Load configuration from database
        let config = await context.database.get<IResourceMarketsConfig>('config');
        if (!config) {
            // Fallback to defaults if config missing
            config = DEFAULT_CONFIG;
            await context.database.set('config', config);
            context.logger.warn('Config not found, using defaults');
        }

        // Register navigation menu item with configured values
        const menuItem = await context.menuService.create({
            namespace: 'main',
            label: config.menuLabel,
            url: config.publicPageUrl,
            icon: config.menuIcon,
            order: config.menuOrder,
            parent: null,
            enabled: true
        });

        // Store menu item ID in config for easy updates
        const menuNodeId = menuItem && ('_id' in menuItem ? menuItem._id : (menuItem as any).id);
        if (menuNodeId && !config.menuItemId) {
            config.menuItemId = menuNodeId as string;
            await context.database.set('config', config);
            context.logger.info({ menuItemId: menuNodeId }, 'Stored menu item ID in config');
        }

        context.logger.info({ config }, 'Registered navigation menu item');

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
    get routes() {
        if (pluginContext) {
            return [
                // Market data endpoints
                {
                    method: 'GET' as const,
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
                    method: 'GET' as const,
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
                    method: 'GET' as const,
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
                },
                // Affiliate tracking endpoints
                ...createAffiliateRoutes(pluginContext)
            ];
        }
        return [];
    },

    /**
     * Admin API routes accessible at /api/plugins/resource-markets/system/*
     *
     * These routes are automatically protected with requireAdmin middleware
     * and prefixed with /system/ by the plugin API service.
     *
     * Provides:
     * - Config routes: GET/PUT /config for plugin configuration
     * - Monitoring routes: GET /platforms, GET /freshness, POST /refresh
     * - Admin routes: PATCH /markets/:guid/priority, PATCH /markets/:guid/status, etc.
     */
    get adminRoutes() {
        // Return combined admin routes using stored context
        // This ensures context is available when routes are registered
        if (pluginContext) {
            return [
                ...createConfigRoutes(pluginContext),
                ...createMonitoringRoutes(pluginContext, fetcherRegistry),
                ...createAdminRoutes(pluginContext, fetcherRegistry)
            ];
        }
        return [];
    }
});
