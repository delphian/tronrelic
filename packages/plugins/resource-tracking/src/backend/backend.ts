import {
    definePlugin,
    type IPluginContext,
    type IApiRouteConfig,
    type IHttpRequest,
    type IHttpResponse,
    type IHttpNext
} from '@tronrelic/types';
import { resourceTrackingManifest } from '../manifest.js';
import type { IResourceTrackingConfig, ISummationData } from '../shared/types/index.js';
import { createResourceTrackingIndexes } from './install-indexes.js';
import { runSummationJob } from './summation.job.js';
import { runPurgeJob } from './purge.job.js';

// Store context and intervals for API handlers and lifecycle management
let pluginContext: IPluginContext;
let summationInterval: NodeJS.Timeout | null = null;
let purgeInterval: NodeJS.Timeout | null = null;

/**
 * Resource Tracking backend plugin implementation.
 *
 * This plugin tracks TRON resource delegation and reclaim transactions, storing
 * individual transaction details with a 48-hour TTL and aggregating statistics
 * every 10 minutes for long-term trend analysis (6-month retention).
 *
 * The plugin implements:
 * - Delegation transaction observer for real-time data capture
 * - Summation job for periodic aggregation (every 10 minutes)
 * - Purge job for data cleanup (every hour)
 * - REST API for querying summations and managing settings
 */
export const resourceTrackingBackendPlugin = definePlugin({
    manifest: resourceTrackingManifest,

    /**
     * Install hook runs once when the plugin is first installed.
     *
     * Creates MongoDB indexes for optimal query performance and seeds default
     * configuration values. This hook is idempotent and safe to run multiple times.
     */
    install: async (context: IPluginContext) => {
        context.logger.info('Installing resource-tracking plugin');

        // Create database indexes
        await createResourceTrackingIndexes(context);

        // Seed default configuration
        const existingConfig = await context.database.get<IResourceTrackingConfig>('config');
        if (!existingConfig) {
            const defaultConfig: IResourceTrackingConfig = {
                detailsRetentionDays: 2, // 48 hours for transaction details
                summationRetentionMonths: 6, // 6 months for aggregated data
                purgeFrequencyHours: 1 // Run purge job every hour
            };
            await context.database.set('config', defaultConfig);
            context.logger.info({ config: defaultConfig }, 'Created default resource tracking configuration');
        }

        context.logger.info('Resource-tracking plugin installed successfully');
    },

    /**
     * Uninstall hook runs when the plugin is uninstalled.
     *
     * Cleans up all plugin data including transaction details, summation records,
     * and configuration. This is a destructive operation that cannot be undone.
     */
    uninstall: async (context: IPluginContext) => {
        context.logger.info('Uninstalling resource-tracking plugin');

        try {
            const transactionsCollection = context.database.getCollection('transactions');
            await transactionsCollection.drop();
            context.logger.info('Dropped delegation transactions collection');
        } catch (error) {
            context.logger.warn({ error }, 'Failed to drop transactions collection (may not exist)');
        }

        try {
            const summationsCollection = context.database.getCollection('summations');
            await summationsCollection.drop();
            context.logger.info('Dropped summations collection');
        } catch (error) {
            context.logger.warn({ error }, 'Failed to drop summations collection (may not exist)');
        }

        try {
            await context.database.delete('config');
            context.logger.info('Deleted resource tracking configuration');
        } catch (error) {
            context.logger.warn({ error }, 'Failed to delete configuration');
        }

        context.logger.info('Resource-tracking plugin uninstalled');
    },

    /**
     * Enable hook runs when the plugin is enabled.
     *
     * Starts scheduled jobs for data aggregation and cleanup based on
     * configuration settings loaded from the database.
     */
    enable: async (context: IPluginContext) => {
        context.logger.info('Resource tracking plugin enabled');

        // Load configuration to determine job intervals
        const config = await context.database.get<IResourceTrackingConfig>('config');
        if (!config) {
            context.logger.warn('No configuration found, using defaults');
            return;
        }

        // Start summation job (every 10 minutes)
        const summationIntervalMs = 10 * 60 * 1000; // 10 minutes
        summationInterval = setInterval(async () => {
            try {
                await runSummationJob(context.database, context.logger, context.websocket);
            } catch (error) {
                context.logger.error({ error }, 'Summation job failed');
            }
        }, summationIntervalMs);

        context.logger.info({ intervalMinutes: 10 }, 'Summation job started');

        // Start purge job (configurable frequency, default 1 hour)
        const purgeIntervalMs = config.purgeFrequencyHours * 60 * 60 * 1000;
        purgeInterval = setInterval(async () => {
            try {
                await runPurgeJob(context.database, context.logger);
            } catch (error) {
                context.logger.error({ error }, 'Purge job failed');
            }
        }, purgeIntervalMs);

        context.logger.info({ intervalHours: config.purgeFrequencyHours }, 'Purge job started');
    },

    /**
     * Disable hook runs when the plugin is disabled.
     *
     * Stops all scheduled jobs and cleans up background processes.
     * Plugin data is preserved for potential re-enabling.
     */
    disable: async (context: IPluginContext) => {
        context.logger.info('Resource tracking plugin disabled');

        // Stop scheduled jobs
        if (summationInterval) {
            clearInterval(summationInterval);
            summationInterval = null;
            context.logger.info('Summation job stopped');
        }

        if (purgeInterval) {
            clearInterval(purgeInterval);
            purgeInterval = null;
            context.logger.info('Purge job stopped');
        }
    },

    /**
     * Init hook runs on every application startup for enabled plugins.
     *
     * Registers the delegation transaction observer to capture real-time
     * blockchain data, stores plugin context for API handlers, and sets up
     * WebSocket subscription handlers for real-time chart updates.
     */
    init: async (context: IPluginContext) => {
        pluginContext = context;

        // Import and register the delegation transaction observer
        const { createDelegationTrackerObserver } = await import('./delegation-tracker.observer.js');

        createDelegationTrackerObserver(
            context.BaseObserver,
            context.observerRegistry,
            context.database,
            context.logger
        );

        context.logger.info('Delegation tracker observer initialized');

        // Register WebSocket subscription handler for real-time summation updates
        // Clients subscribe to this room to receive notifications when new summation data is created
        context.websocket.onSubscribe(async (socket, roomName, payload) => {
            // Simple subscription with no payload validation required
            // Room name is typically 'summation-updates'
            context.logger.debug({ socketId: socket.id, roomName }, 'Client subscribed to resource tracking updates');

            // Client is auto-joined to 'plugin:resource-tracking:{roomName}' before this handler runs
            // Send confirmation event back to client
            context.websocket.emitToSocket(socket, 'subscribed', { roomName });
        });

        // Register unsubscribe handler for cleanup
        context.websocket.onUnsubscribe(async (socket, roomName, payload) => {
            // Client is auto-left from room after this handler completes
            context.logger.debug({ socketId: socket.id, roomName }, 'Client unsubscribed from resource tracking updates');
        });

        context.logger.info('WebSocket subscription handlers registered');
    },

    /**
     * Public API routes for querying summation data and configuration.
     *
     * These endpoints are accessible at /api/plugins/resource-tracking/*
     */
    routes: [
        {
            method: 'GET',
            path: '/summations',
            handler: async (req: IHttpRequest, res: IHttpResponse, next: IHttpNext) => {
                try {
                    const period = (req.query.period as string) || '7d';

                    // Parse period into days
                    const periodMap: Record<string, number> = {
                        '1d': 1,
                        '7d': 7,
                        '30d': 30,
                        '6m': 180
                    };

                    const days = periodMap[period] || 7;
                    const startDate = new Date();
                    startDate.setDate(startDate.getDate() - days);

                    // Query summations within time range
                    const summations = await pluginContext.database.find<ISummationData>(
                        'summations',
                        { timestamp: { $gte: startDate } },
                        { sort: { timestamp: 1 } }
                    );

                    // Format response
                    const data = summations.map(s => ({
                        timestamp: s.timestamp.toISOString(),
                        energyDelegated: s.energyDelegated,
                        energyReclaimed: s.energyReclaimed,
                        bandwidthDelegated: s.bandwidthDelegated,
                        bandwidthReclaimed: s.bandwidthReclaimed,
                        netEnergy: s.netEnergy,
                        netBandwidth: s.netBandwidth
                    }));

                    res.json({ success: true, data });
                } catch (error) {
                    next(error);
                }
            },
            description: 'Get resource delegation summation data for a time period'
        },
        {
            method: 'GET',
            path: '/settings',
            handler: async (req: IHttpRequest, res: IHttpResponse, next: IHttpNext) => {
                try {
                    const config = await pluginContext.database.get<IResourceTrackingConfig>('config');
                    res.json({ success: true, settings: config });
                } catch (error) {
                    next(error);
                }
            },
            description: 'Get resource tracking configuration'
        },
        {
            method: 'POST',
            path: '/settings',
            handler: async (req: IHttpRequest, res: IHttpResponse, next: IHttpNext) => {
                try {
                    const {
                        detailsRetentionDays,
                        summationRetentionMonths,
                        purgeFrequencyHours
                    } = req.body;

                    // Validate and sanitize settings
                    const config: IResourceTrackingConfig = {
                        detailsRetentionDays: Math.max(Number(detailsRetentionDays) || 2, 1),
                        summationRetentionMonths: Math.max(Number(summationRetentionMonths) || 6, 1),
                        purgeFrequencyHours: Math.max(Number(purgeFrequencyHours) || 1, 1)
                    };

                    await pluginContext.database.set('config', config);

                    // Restart purge job with new frequency
                    if (purgeInterval) {
                        clearInterval(purgeInterval);
                        const purgeIntervalMs = config.purgeFrequencyHours * 60 * 60 * 1000;
                        purgeInterval = setInterval(async () => {
                            try {
                                await runPurgeJob(pluginContext.database, pluginContext.logger);
                            } catch (error) {
                                pluginContext.logger.error({ error }, 'Purge job failed');
                            }
                        }, purgeIntervalMs);

                        pluginContext.logger.info(
                            { intervalHours: config.purgeFrequencyHours },
                            'Purge job restarted with new frequency'
                        );
                    }

                    res.json({ success: true, settings: config });
                } catch (error) {
                    next(error);
                }
            },
            description: 'Update resource tracking configuration'
        }
    ] as IApiRouteConfig[],

    adminRoutes: []
});
