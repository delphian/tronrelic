import {
    definePlugin,
    type IPluginContext,
    type IApiRouteConfig,
    type IHttpRequest,
    type IHttpResponse,
    type IHttpNext
} from '@tronrelic/types';
import { resourceTrackingManifest } from '../manifest.js';
import type { IResourceTrackingConfig, ISummationData, IWhaleDelegation, IPoolDelegation, IPoolDelegationHourly, IAddressBookEntry } from '../shared/types/index.js';
import type { ISummationResponse } from '../shared/types/api.js';
import { createResourceTrackingIndexes } from './install-indexes.js';
import { runSummationJob } from './summation.job.js';
import { runPurgeJob } from './purge.job.js';
import { sampleSummations } from './utils/sampleSummations.js';
import { getSummationCacheKey, getSummationCachePattern } from './utils/cacheKeys.js';
import { PoolMembershipService } from './pool-membership.service.js';
import { ADDRESS_BOOK_SEED_DATA } from './address-book-seed.js';

// Store context and intervals for API handlers and lifecycle management
let pluginContext: IPluginContext;
let summationInterval: NodeJS.Timeout | null = null;
let purgeInterval: NodeJS.Timeout | null = null;
let poolMembershipService: PoolMembershipService | null = null;

/**
 * Resource Explorer backend plugin implementation.
 *
 * This plugin tracks TRON resource delegation and reclaim transactions, storing
 * individual transaction details with a 48-hour TTL and aggregating statistics
 * every 5 minutes for long-term trend analysis (6-month retention).
 *
 * The plugin implements:
 * - Delegation transaction observer for real-time data capture
 * - Summation job for periodic aggregation (every 5 minutes)
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
                purgeFrequencyHours: 1, // Run purge job every hour
                blocksPerInterval: 100, // 100 blocks = ~5 minutes at 20 blocks/minute (3-second block time)
                whaleDetectionEnabled: false, // Whale detection disabled by default
                whaleThresholdTrx: 2_000_000 // 2M TRX minimum for whale detection
            };
            await context.database.set('config', defaultConfig);
            context.logger.info({ config: defaultConfig }, 'Created default resource tracking configuration');
        }

        // Seed address book with known pool/exchange names
        const existingAddressBook = await context.database.find<IAddressBookEntry>('address-book', {}, { limit: 1 });
        if (existingAddressBook.length === 0) {
            context.logger.info({ count: ADDRESS_BOOK_SEED_DATA.length }, 'Seeding address book with known addresses');
            for (const entry of ADDRESS_BOOK_SEED_DATA) {
                try {
                    await context.database.insertOne('address-book', {
                        ...entry,
                        createdAt: new Date(),
                        updatedAt: new Date()
                    });
                } catch (error) {
                    // Ignore duplicates
                    context.logger.debug({ address: entry.address }, 'Address already exists in address book');
                }
            }
            context.logger.info('Address book seeded successfully');
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

        // Drop pool tracking collections
        try {
            const poolDelegationsCollection = context.database.getCollection('pool-delegations');
            await poolDelegationsCollection.drop();
            context.logger.info('Dropped pool-delegations collection');
        } catch (error) {
            context.logger.warn({ error }, 'Failed to drop pool-delegations collection (may not exist)');
        }

        try {
            const poolMembersCollection = context.database.getCollection('pool-members');
            await poolMembersCollection.drop();
            context.logger.info('Dropped pool-members collection');
        } catch (error) {
            context.logger.warn({ error }, 'Failed to drop pool-members collection (may not exist)');
        }

        try {
            const addressBookCollection = context.database.getCollection('address-book');
            await addressBookCollection.drop();
            context.logger.info('Dropped address-book collection');
        } catch (error) {
            context.logger.warn({ error }, 'Failed to drop address-book collection (may not exist)');
        }

        try {
            const poolDelegationsHourlyCollection = context.database.getCollection('pool-delegations-hourly');
            await poolDelegationsHourlyCollection.drop();
            context.logger.info('Dropped pool-delegations-hourly collection');
        } catch (error) {
            context.logger.warn({ error }, 'Failed to drop pool-delegations-hourly collection (may not exist)');
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

        // Start summation job (every 5 minutes)
        const summationIntervalMs = 5 * 60 * 1000; // 5 minutes
        summationInterval = setInterval(async () => {
            try {
                await runSummationJob(context.database, context.logger, context.websocket);
            } catch (error) {
                context.logger.error({ error }, 'Summation job failed');
            }
        }, summationIntervalMs);

        context.logger.info({ intervalMinutes: 5 }, 'Summation job started');

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

        // Note: poolMembershipService is created in init(), which runs after enable()
        // The service is started in init() after creation
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

        // Stop pool membership discovery service
        if (poolMembershipService) {
            poolMembershipService.stop();
            context.logger.info('Pool membership discovery service stopped');
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

        // Create pool membership discovery service
        poolMembershipService = new PoolMembershipService(context.database, context.logger);

        // Import and register the delegation transaction observer
        const { createDelegationTrackerObserver } = await import('./delegation-tracker.observer.js');

        const observer = createDelegationTrackerObserver(
            context.BaseObserver,
            context.observerRegistry,
            context.database,
            context.websocket,
            context.logger,
            poolMembershipService
        );

        context.logger.info({ observerName: observer.getName() }, 'Delegation tracker observer initialized');

        // Log subscription stats to verify registration
        const stats = context.observerRegistry.getSubscriptionStats();
        context.logger.info({ subscriptionStats: stats }, 'Observer registry subscription stats');

        // Register WebSocket subscription handler for real-time summation updates
        // Clients subscribe to this room to receive notifications when new summation data is created
        context.websocket.onSubscribe(async (socket, roomName, payload) => {
            // Simple subscription with no payload validation required
            // Room name can be 'summation-updates' or 'pool-updates'
            context.logger.info({ socketId: socket.id, roomName }, 'CLIENT SUBSCRIBED to resource tracking room');

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

        // Register navigation menu items (memory-only, recreated on each startup)
        // First, ensure Analytics category container exists
        const analyticsCategory = await context.menuService.create({
            namespace: 'main',
            label: 'Analytics',
            icon: 'BarChart3',
            order: 30,
            parent: null,
            enabled: true
            // No url - this is a container/category node
        });

        // Register Resource Explorer under Analytics category
        await context.menuService.create({
            namespace: 'main',
            label: 'Resource Explorer',
            url: '/tron-resource-explorer',
            icon: 'Activity',
            order: 10,
            parent: analyticsCategory._id!,
            enabled: true
        });

        // Register Energy Pools under Analytics category
        await context.menuService.create({
            namespace: 'main',
            label: 'Energy Pools',
            url: '/energy-pools',
            icon: 'Users',
            order: 11,
            parent: analyticsCategory._id!,
            enabled: true
        });

        context.logger.info('Navigation menu items registered (Analytics category, Resource Explorer, and Energy Pools)');

        // Start pool membership discovery service (must be after creation above)
        poolMembershipService.start();
        context.logger.info('Pool membership discovery service started');
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
                    const requestedPoints = Math.max(Number(req.query.points) || 288, 1);

                    // Build cache key for this query
                    const cacheKey = getSummationCacheKey(period, requestedPoints);

                    // Try Redis cache first
                    const cached = await pluginContext.cache.get<ISummationResponse>(cacheKey);
                    if (cached) {
                        pluginContext.logger.debug(
                            { period, points: requestedPoints, cacheKey },
                            'Summation cache hit'
                        );
                        return res.json(cached);
                    }

                    pluginContext.logger.debug(
                        { period, points: requestedPoints, cacheKey },
                        'Summation cache miss - fetching from database'
                    );

                    // Parse period into days
                    const periodMap: Record<string, number> = {
                        '1d': 1,
                        '7d': 7,
                        '30d': 30,
                        '6m': 180
                    };

                    const days = periodMap[period] || 7;
                    const endDate = new Date();
                    const startDate = new Date();
                    startDate.setDate(startDate.getDate() - days);

                    // Query summations within time range
                    const summations = await pluginContext.database.find<ISummationData>(
                        'summations',
                        { timestamp: { $gte: startDate } },
                        { sort: { startBlock: 1 } }
                    );

                    // Apply time-based bucketing with fixed date range
                    const sampledResult = sampleSummations(summations, requestedPoints, startDate, endDate);

                    // Format response - convert SUN to millions of TRX with 1 decimal precision
                    // 1 TRX = 1,000,000 SUN, so 1M TRX = 1,000,000,000,000 SUN (1e12)
                    // Preserve null values for empty buckets (creates gaps in chart)
                    const formattedData = sampledResult.data.map(s => {
                        if (s === null) {
                            return null;
                        }
                        return {
                            timestamp: s.timestamp.toISOString(),
                            startBlock: s.startBlock,
                            endBlock: s.endBlock,
                            energyDelegated: Number((s.energyDelegated / 1e12).toFixed(1)),
                            energyReclaimed: Number((s.energyReclaimed / 1e12).toFixed(1)),
                            bandwidthDelegated: Number((s.bandwidthDelegated / 1e12).toFixed(1)),
                            bandwidthReclaimed: Number((s.bandwidthReclaimed / 1e12).toFixed(1)),
                            netEnergy: Number((s.netEnergy / 1e12).toFixed(1)),
                            netBandwidth: Number((s.netBandwidth / 1e12).toFixed(1)),
                            transactionCount: s.transactionCount,
                            totalTransactionsDelegated: s.totalTransactionsDelegated,
                            totalTransactionsUndelegated: s.totalTransactionsUndelegated,
                            totalTransactionsNet: s.totalTransactionsNet
                        };
                    });

                    const response: ISummationResponse = {
                        success: true,
                        data: formattedData as any, // Formatted for frontend (Date → ISO string, SUN → TRX)
                        metadata: sampledResult.metadata
                    };

                    // Cache for 5 minutes (300 seconds) - matches summation job interval
                    await pluginContext.cache.set(cacheKey, response, 300);

                    pluginContext.logger.debug(
                        {
                            period,
                            points: requestedPoints,
                            actualPoints: sampledResult.metadata.actualPoints,
                            samplingApplied: sampledResult.metadata.samplingApplied,
                            cacheKey
                        },
                        'Cached summation result'
                    );

                    res.json(response);
                } catch (error) {
                    next(error);
                }
            },
            description: 'Get resource delegation summation data for a time period with optional sampling'
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
                        purgeFrequencyHours,
                        blocksPerInterval,
                        whaleDetectionEnabled,
                        whaleThresholdTrx
                    } = req.body;

                    // Validate and sanitize settings
                    const config: IResourceTrackingConfig = {
                        detailsRetentionDays: Math.max(Number(detailsRetentionDays) || 2, 1),
                        summationRetentionMonths: Math.max(Number(summationRetentionMonths) || 6, 1),
                        purgeFrequencyHours: Math.max(Number(purgeFrequencyHours) || 1, 1),
                        blocksPerInterval: Math.max(Number(blocksPerInterval) || 300, 100),
                        whaleDetectionEnabled: Boolean(whaleDetectionEnabled),
                        whaleThresholdTrx: Math.max(Number(whaleThresholdTrx) || 2_000_000, 100_000) // Min 100k TRX
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
        },
        {
            method: 'GET',
            path: '/whales/recent',
            handler: async (req: IHttpRequest, res: IHttpResponse, next: IHttpNext) => {
                try {
                    const limit = Math.min(Number(req.query.limit) || 50, 100); // Max 100 whales
                    const resourceType = req.query.resourceType ? Number(req.query.resourceType) : undefined;

                    // Build query filter
                    const filter: Record<string, unknown> = {};
                    if (resourceType !== undefined && (resourceType === 0 || resourceType === 1)) {
                        filter.resourceType = resourceType;
                    }

                    // Query whale delegations sorted by timestamp descending (most recent first)
                    const whales = await pluginContext.database.find<IWhaleDelegation>(
                        'whale-delegations',
                        filter,
                        {
                            sort: { timestamp: -1 },
                            limit
                        }
                    );

                    // Format response with ISO timestamps
                    const formattedWhales = whales.map(whale => ({
                        txId: whale.txId,
                        timestamp: whale.timestamp.toISOString(),
                        fromAddress: whale.fromAddress,
                        toAddress: whale.toAddress,
                        resourceType: whale.resourceType,
                        amountTrx: whale.amountTrx,
                        blockNumber: whale.blockNumber
                    }));

                    res.json({
                        success: true,
                        whales: formattedWhales,
                        count: formattedWhales.length
                    });
                } catch (error) {
                    next(error);
                }
            },
            description: 'Get recent whale delegations (high-value resource delegations)'
        },
        // Pool tracking API routes
        {
            method: 'GET',
            path: '/pools',
            handler: async (req: IHttpRequest, res: IHttpResponse, next: IHttpNext) => {
                try {
                    const hours = Math.min(Number(req.query.hours) || 24, 168); // Max 7 days
                    const since = new Date(Date.now() - hours * 60 * 60 * 1000);

                    // Aggregate delegations by pool using $lookup join with pool-members
                    // This matches the old system's approach: JOIN rm_delegation with rm_multisig at query time
                    const collection = pluginContext.database.getCollection('pool-delegations');
                    const membersCollectionName = pluginContext.database.getCollection('pool-members').collectionName;

                    const pools = await collection.aggregate([
                        // Filter to recent energy delegations
                        { $match: { timestamp: { $gte: since }, resourceType: 1 } },

                        // Join with pool-members to discover the controlling pool
                        // Matches: pool-members.account = pool-delegations.fromAddress
                        //      AND pool-members.permissionId = pool-delegations.permissionId
                        {
                            $lookup: {
                                from: membersCollectionName,
                                let: { fromAddr: '$fromAddress', permId: '$permissionId' },
                                pipeline: [
                                    {
                                        $match: {
                                            $expr: {
                                                $and: [
                                                    { $eq: ['$account', '$$fromAddr'] },
                                                    { $eq: ['$permissionId', '$$permId'] }
                                                ]
                                            }
                                        }
                                    }
                                ],
                                as: 'poolMembership'
                            }
                        },

                        // Extract pool address from lookup result (first match or null)
                        {
                            $addFields: {
                                resolvedPool: { $arrayElemAt: ['$poolMembership.pool', 0] }
                            }
                        },

                        // Group by resolved pool address
                        {
                            $group: {
                                _id: '$resolvedPool',
                                totalAmountSun: { $sum: { $abs: '$amountSun' } },
                                delegationCount: { $sum: 1 },
                                uniqueDelegators: { $addToSet: '$fromAddress' },
                                uniqueRecipients: { $addToSet: '$toAddress' }
                            }
                        },

                        // Project final fields
                        {
                            $project: {
                                poolAddress: '$_id',
                                totalAmountTrx: { $divide: ['$totalAmountSun', 1_000_000] },
                                delegationCount: 1,
                                delegatorCount: { $size: '$uniqueDelegators' },
                                recipientCount: { $size: '$uniqueRecipients' }
                            }
                        },
                        { $sort: { totalAmountTrx: -1 } },
                        { $limit: 50 }
                    ]).toArray();

                    // Enrich with address book names
                    const addressBook = await pluginContext.database.find<IAddressBookEntry>('address-book', {});
                    const addressMap = new Map(addressBook.map(e => [e.address, e.name]));

                    const enrichedPools = pools.map(pool => ({
                        ...pool,
                        poolName: pool.poolAddress ? addressMap.get(pool.poolAddress) ?? null : null
                    }));

                    res.json({ success: true, pools: enrichedPools, hours });
                } catch (error) {
                    next(error);
                }
            },
            description: 'Get all pools with aggregated delegation stats'
        },
        {
            method: 'GET',
            path: '/pools/:address',
            handler: async (req: IHttpRequest, res: IHttpResponse, next: IHttpNext) => {
                try {
                    const { address } = req.params;
                    const hours = Math.min(Number(req.query.hours) || 24, 168);
                    const since = new Date(Date.now() - hours * 60 * 60 * 1000);

                    // Get pool stats
                    const collection = pluginContext.database.getCollection('pool-delegations');
                    const [stats] = await collection.aggregate([
                        { $match: { poolAddress: address, timestamp: { $gte: since } } },
                        {
                            $group: {
                                _id: null,
                                totalAmountSun: { $sum: { $abs: '$amountSun' } },
                                delegationCount: { $sum: 1 },
                                uniqueDelegators: { $addToSet: '$fromAddress' },
                                uniqueRecipients: { $addToSet: '$toAddress' }
                            }
                        }
                    ]).toArray();

                    // Get pool members (delegator accounts)
                    const members = await pluginContext.database.find(
                        'pool-members',
                        { pool: address },
                        { sort: { lastSeenAt: -1 }, limit: 100 }
                    );

                    // Get pool name from address book
                    const addressEntry = await pluginContext.database.findOne<IAddressBookEntry>(
                        'address-book',
                        { address }
                    );

                    res.json({
                        success: true,
                        pool: {
                            address,
                            name: addressEntry?.name ?? null,
                            totalAmountTrx: stats ? stats.totalAmountSun / 1_000_000 : 0,
                            delegationCount: stats?.delegationCount ?? 0,
                            delegatorCount: stats?.uniqueDelegators?.length ?? 0,
                            recipientCount: stats?.uniqueRecipients?.length ?? 0
                        },
                        members,
                        hours
                    });
                } catch (error) {
                    next(error);
                }
            },
            description: 'Get pool details and stats'
        },
        {
            method: 'GET',
            path: '/pools/:address/delegations',
            handler: async (req: IHttpRequest, res: IHttpResponse, next: IHttpNext) => {
                try {
                    const { address } = req.params;
                    const limit = Math.min(Number(req.query.limit) || 50, 200);
                    const skip = Number(req.query.skip) || 0;

                    const delegations = await pluginContext.database.find<IPoolDelegation>(
                        'pool-delegations',
                        { poolAddress: address },
                        { sort: { timestamp: -1 }, limit, skip }
                    );

                    // Enrich with address book names
                    const addressBook = await pluginContext.database.find<IAddressBookEntry>('address-book', {});
                    const addressMap = new Map(addressBook.map(e => [e.address, e.name]));

                    const enrichedDelegations = delegations.map(d => ({
                        txId: d.txId,
                        timestamp: d.timestamp,
                        fromAddress: d.fromAddress,
                        fromName: addressMap.get(d.fromAddress) ?? null,
                        toAddress: d.toAddress,
                        toName: addressMap.get(d.toAddress) ?? null,
                        resourceType: d.resourceType === 1 ? 'ENERGY' : 'BANDWIDTH',
                        amountTrx: Math.abs(d.amountSun) / 1_000_000,
                        rentalPeriodMinutes: d.rentalPeriodMinutes,
                        normalizedAmountTrx: d.normalizedAmountTrx
                    }));

                    res.json({ success: true, delegations: enrichedDelegations });
                } catch (error) {
                    next(error);
                }
            },
            description: 'Get recent delegations for a pool'
        },
        {
            method: 'GET',
            path: '/pools/:address/members',
            handler: async (req: IHttpRequest, res: IHttpResponse, next: IHttpNext) => {
                try {
                    const { address } = req.params;
                    const limit = Math.min(Number(req.query.limit) || 100, 500);

                    const members = await pluginContext.database.find(
                        'pool-members',
                        { pool: address },
                        { sort: { lastSeenAt: -1 }, limit }
                    );

                    // Enrich with address book names
                    const addressBook = await pluginContext.database.find<IAddressBookEntry>('address-book', {});
                    const addressMap = new Map(addressBook.map(e => [e.address, e.name]));

                    const enrichedMembers = members.map((m: any) => ({
                        account: m.account,
                        accountName: addressMap.get(m.account) ?? null,
                        pool: m.pool,
                        poolName: addressMap.get(m.pool) ?? null,
                        permissionId: m.permissionId,
                        permissionName: m.permissionName,
                        discoveredAt: m.discoveredAt,
                        lastSeenAt: m.lastSeenAt
                    }));

                    res.json({ success: true, members: enrichedMembers, count: enrichedMembers.length });
                } catch (error) {
                    next(error);
                }
            },
            description: 'Get members (delegator accounts) for a pool'
        },
        {
            method: 'GET',
            path: '/pools/hourly-volume',
            handler: async (req: IHttpRequest, res: IHttpResponse, next: IHttpNext) => {
                try {
                    const hours = Math.min(Number(req.query.hours) || 168, 720); // Default 7 days, max 30 days
                    const poolAddress = req.query.pool as string | undefined;
                    const resourceType = req.query.resourceType !== undefined
                        ? Number(req.query.resourceType)
                        : 1; // Default to ENERGY

                    const since = Math.floor((Date.now() - hours * 60 * 60 * 1000) / 1000);

                    // Build query filter
                    const filter: Record<string, unknown> = {
                        timestamp: { $gte: since },
                        resourceType
                    };

                    if (poolAddress) {
                        filter.poolAddress = poolAddress;
                    }

                    // Query hourly aggregates
                    const hourlyData = await pluginContext.database.find<IPoolDelegationHourly>(
                        'pool-delegations-hourly',
                        filter,
                        { sort: { timestamp: 1 } }
                    );

                    // Format response
                    const formattedData = hourlyData.map(h => ({
                        dateHour: h.dateHour,
                        timestamp: h.timestamp,
                        poolAddress: h.poolAddress,
                        resourceType: h.resourceType === 1 ? 'ENERGY' : 'BANDWIDTH',
                        totalAmountTrx: h.totalAmountTrx,
                        totalNormalizedAmountTrx: h.totalNormalizedAmountTrx,
                        delegationCount: h.delegationCount,
                        uniqueDelegators: h.uniqueDelegators,
                        uniqueRecipients: h.uniqueRecipients
                    }));

                    // Enrich with pool names if data includes pool addresses
                    const addressBook = await pluginContext.database.find<IAddressBookEntry>('address-book', {});
                    const addressMap = new Map(addressBook.map(e => [e.address, e.name]));

                    const enrichedData = formattedData.map(h => ({
                        ...h,
                        poolName: h.poolAddress ? addressMap.get(h.poolAddress) ?? null : null
                    }));

                    res.json({
                        success: true,
                        data: enrichedData,
                        hours,
                        poolAddress: poolAddress ?? null,
                        resourceType: resourceType === 1 ? 'ENERGY' : 'BANDWIDTH'
                    });
                } catch (error) {
                    next(error);
                }
            },
            description: 'Get hourly pool delegation volume data for historical charts'
        },
        {
            method: 'GET',
            path: '/address-book',
            handler: async (req: IHttpRequest, res: IHttpResponse, next: IHttpNext) => {
                try {
                    const category = req.query.category as string | undefined;
                    const filter: Record<string, unknown> = {};
                    if (category && ['pool', 'exchange', 'notable', 'other'].includes(category)) {
                        filter.category = category;
                    }

                    const entries = await pluginContext.database.find<IAddressBookEntry>(
                        'address-book',
                        filter,
                        { sort: { name: 1 } }
                    );

                    res.json({ success: true, entries, count: entries.length });
                } catch (error) {
                    next(error);
                }
            },
            description: 'Get address book entries with optional category filter'
        },
        {
            method: 'GET',
            path: '/address-book/:address',
            handler: async (req: IHttpRequest, res: IHttpResponse, next: IHttpNext) => {
                try {
                    const { address } = req.params;
                    const entry = await pluginContext.database.findOne<IAddressBookEntry>(
                        'address-book',
                        { address }
                    );

                    if (!entry) {
                        res.status(404).json({ success: false, error: 'Address not found in address book' });
                        return;
                    }

                    res.json({ success: true, entry });
                } catch (error) {
                    next(error);
                }
            },
            description: 'Get address book entry by address'
        }
    ] as IApiRouteConfig[],

    /**
     * Admin API routes for cache management and debugging.
     *
     * These endpoints are accessible at /api/plugins/resource-tracking/system/*
     * and require admin authentication.
     */
    adminRoutes: [
        {
            method: 'POST',
            path: '/cache/clear',
            handler: async (req: IHttpRequest, res: IHttpResponse, next: IHttpNext) => {
                try {
                    pluginContext.logger.info('Admin requested summation cache clear');

                    // Get all cache keys matching the summation pattern
                    const pattern = getSummationCachePattern();
                    const keys = await pluginContext.cache.keys(pattern);

                    if (keys.length === 0) {
                        pluginContext.logger.info('No summation cache keys found to clear');
                        return res.json({
                            success: true,
                            message: 'No cache entries found',
                            keysCleared: 0
                        });
                    }

                    // Delete all matching keys
                    await Promise.all(keys.map((key: string) => pluginContext.cache.del(key)));

                    pluginContext.logger.info(
                        { keysCleared: keys.length, pattern },
                        'Summation cache cleared successfully'
                    );

                    res.json({
                        success: true,
                        message: `Cleared ${keys.length} cache entries`,
                        keysCleared: keys.length,
                        pattern
                    });
                } catch (error) {
                    pluginContext.logger.error({ error }, 'Failed to clear summation cache');
                    next(error);
                }
            },
            description: 'Clear all cached summation data (admin only)'
        }
    ] as IApiRouteConfig[]
});
