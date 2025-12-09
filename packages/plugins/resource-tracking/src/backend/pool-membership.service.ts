/**
 * Pool Membership Discovery Service.
 *
 * Discovers which energy rental pools control delegator addresses by fetching
 * account permissions from TronGrid. When a delegation with Permission_id >= 3
 * is observed, this service checks if the controlling pool is known. If not,
 * it queues a TronGrid API call to discover the pool-to-account mapping.
 *
 * The discovery process is asynchronous to avoid blocking transaction processing.
 * Pool memberships are cached in the database and rarely change, so lookups are
 * typically fast cache hits.
 */

import type { IPluginDatabase, ISystemLogService } from '@tronrelic/types';
import type { IPoolMember } from '../shared/types/index.js';

/**
 * TronGrid account response structure for permission discovery.
 */
interface ITronGridAccountResponse {
    address?: string;
    active_permission?: Array<{
        id: number;
        permission_name?: string;
        threshold?: number;
        keys?: Array<{
            address: string;
            weight: number;
        }>;
    }>;
}

/**
 * Queued permission lookup item.
 */
interface IPermissionLookupItem {
    account: string;
    permissionId: number;
    queuedAt: Date;
}

/**
 * Pool Membership Discovery Service manages the discovery and caching of
 * pool-to-account relationships for energy rental tracking.
 */
export class PoolMembershipService {
    private readonly database: IPluginDatabase;
    private readonly logger: ISystemLogService;
    private readonly tronGridBaseUrl = 'https://api.trongrid.io';

    /** Queue of accounts needing permission lookup */
    private lookupQueue: IPermissionLookupItem[] = [];

    /** In-memory cache of known pool memberships (account -> pool) */
    private membershipCache: Map<string, string | null> = new Map();

    /** Flag to prevent concurrent queue processing */
    private processingQueue = false;

    /** Interval handle for periodic queue processing */
    private processInterval: NodeJS.Timeout | null = null;

    constructor(database: IPluginDatabase, logger: ISystemLogService) {
        this.database = database;
        this.logger = logger.child({ service: 'PoolMembershipService' });
    }

    /**
     * Start the background queue processor.
     *
     * Runs every 30 seconds to batch process permission lookups without
     * blocking transaction processing.
     */
    start(): void {
        if (this.processInterval) {
            return; // Already running
        }

        this.processInterval = setInterval(() => {
            void this.processQueue();
        }, 30_000); // Every 30 seconds

        this.logger.info('Pool membership discovery service started');
    }

    /**
     * Stop the background queue processor.
     */
    stop(): void {
        if (this.processInterval) {
            clearInterval(this.processInterval);
            this.processInterval = null;
            this.logger.info('Pool membership discovery service stopped');
        }
    }

    /**
     * Get the controlling pool for an account, checking cache first.
     *
     * Returns immediately with cached value if known. If unknown, queues
     * a permission lookup and returns null. The pool will be discovered
     * asynchronously and cached for future lookups.
     *
     * @param account - Delegator address to look up
     * @param permissionId - Permission ID used in the delegation transaction
     * @returns Pool address if known, null if unknown or not a pool-controlled account
     */
    async getPoolForAccount(account: string, permissionId: number): Promise<string | null> {
        if (!account || account === 'unknown') {
            return null;
        }

        // Check in-memory cache first
        const cacheKey = `${account}:${permissionId}`;
        if (this.membershipCache.has(cacheKey)) {
            return this.membershipCache.get(cacheKey) ?? null;
        }

        // Check database
        const existing = await this.database.findOne<IPoolMember>('pool-members', {
            account,
            permissionId
        });

        if (existing) {
            // Cache and update lastSeenAt
            this.membershipCache.set(cacheKey, existing.pool);
            void this.database.updateMany(
                'pool-members',
                { account, permissionId },
                { $set: { lastSeenAt: new Date() } }
            );
            return existing.pool;
        }

        // Queue for discovery if not already queued
        this.queuePermissionLookup(account, permissionId);
        return null;
    }

    /**
     * Queue an account for permission lookup.
     *
     * Deduplicates requests to avoid redundant API calls.
     */
    private queuePermissionLookup(account: string, permissionId: number): void {
        const exists = this.lookupQueue.some(
            item => item.account === account && item.permissionId === permissionId
        );

        if (!exists) {
            this.lookupQueue.push({
                account,
                permissionId,
                queuedAt: new Date()
            });

            this.logger.debug({ account, permissionId }, 'Queued account for permission lookup');
        }
    }

    /**
     * Process the permission lookup queue.
     *
     * Batches lookups to avoid overwhelming TronGrid API. Processes up to
     * 10 accounts per cycle with 200ms delay between calls.
     */
    private async processQueue(): Promise<void> {
        if (this.processingQueue || this.lookupQueue.length === 0) {
            return;
        }

        this.processingQueue = true;
        const batch = this.lookupQueue.splice(0, 10); // Process 10 at a time

        this.logger.info({ count: batch.length }, 'Processing permission lookup queue');

        for (const item of batch) {
            try {
                await this.discoverPoolsForAccount(item.account);
                // Rate limit: 200ms between calls
                await this.delay(200);
            } catch (error) {
                this.logger.error({ error, account: item.account }, 'Failed to discover pools for account');
            }
        }

        this.processingQueue = false;
    }

    /**
     * Discover pool memberships for a single account.
     *
     * Calls TronGrid /wallet/getaccount to fetch permissions, then extracts
     * pool addresses from active_permission[].keys[].address fields.
     *
     * @param account - Account address to discover pools for
     * @returns Array of discovered pool memberships
     */
    async discoverPoolsForAccount(account: string): Promise<IPoolMember[]> {
        const members: IPoolMember[] = [];

        try {
            const apiKey = process.env.TRONGRID_API_KEY ?? '';
            const headers: Record<string, string> = {
                'Content-Type': 'application/json'
            };

            if (apiKey) {
                headers['TRON-PRO-API-KEY'] = apiKey;
            }

            const response = await fetch(`${this.tronGridBaseUrl}/wallet/getaccount`, {
                method: 'POST',
                headers,
                body: JSON.stringify({ address: account, visible: true })
            });

            if (!response.ok) {
                this.logger.warn({ account, status: response.status }, 'TronGrid request failed');
                return members;
            }

            const data = await response.json() as ITronGridAccountResponse;
            const activePermissions = data.active_permission ?? [];

            for (const permission of activePermissions) {
                // Only process custom permissions (id >= 2)
                // id 0 = owner, id 1 = witness, id 2 = default active
                if (permission.id < 2) continue;

                for (const key of permission.keys ?? []) {
                    // Skip if key is the account itself (self-signing)
                    if (key.address === account) continue;

                    const member: IPoolMember = {
                        account,
                        pool: key.address,
                        permissionId: permission.id,
                        permissionName: permission.permission_name ?? `Permission ${permission.id}`,
                        discoveredAt: new Date(),
                        lastSeenAt: new Date()
                    };

                    members.push(member);

                    // Persist to database
                    try {
                        await this.database.insertOne('pool-members', member);
                        this.logger.info(
                            { account: member.account, pool: member.pool, permissionName: member.permissionName },
                            'Discovered pool membership'
                        );

                        // Update cache
                        const cacheKey = `${member.account}:${member.permissionId}`;
                        this.membershipCache.set(cacheKey, member.pool);
                    } catch (error) {
                        // Handle duplicate gracefully (another process may have inserted)
                        if (this.isDuplicateError(error)) {
                            await this.database.updateMany(
                                'pool-members',
                                { account: member.account, pool: member.pool },
                                { $set: { lastSeenAt: new Date() } }
                            );
                        } else {
                            throw error;
                        }
                    }
                }
            }
        } catch (error) {
            this.logger.error({ error, account }, 'Failed to discover pool membership');
        }

        return members;
    }

    /**
     * Check if error is a MongoDB duplicate key error.
     */
    private isDuplicateError(error: unknown): boolean {
        if (!error || typeof error !== 'object') return false;
        if ('code' in error && error.code === 11000) return true;
        if ('error' in error && typeof error.error === 'object' && error.error) {
            if ('code' in error.error && error.error.code === 11000) return true;
        }
        return false;
    }

    /**
     * Helper to delay execution.
     */
    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Get queue length for monitoring.
     */
    getQueueLength(): number {
        return this.lookupQueue.length;
    }

    /**
     * Get cache size for monitoring.
     */
    getCacheSize(): number {
        return this.membershipCache.size;
    }
}
