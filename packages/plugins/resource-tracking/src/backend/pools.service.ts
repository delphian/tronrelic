/**
 * Pool aggregation service for real-time WebSocket updates.
 *
 * Provides a shared function to aggregate pool delegation data that can be called
 * from both the API routes and the blockchain observer. The observer uses this to
 * push aggregated data via WebSocket once per block, eliminating the need for
 * frontend API polling.
 */

import type { IPluginDatabase, IBlockchainService } from '@tronrelic/types';
import type { IAddressBookEntry } from '../shared/types/index.js';

/**
 * Aggregated pool data returned by the pools query.
 */
export interface IPoolAggregate {
    poolAddress: string | null;
    totalAmountTrx: number;
    delegationCount: number;
    delegatorCount: number;
    recipientCount: number;
    poolName: string | null;
    /** True if this is an individual using their own custom permission (not a pool) */
    selfSigned: boolean;
}

/**
 * Result of pool aggregation including metadata.
 */
export interface IPoolsData {
    pools: IPoolAggregate[];
    addressBook: Record<string, IAddressBookEntry>;
    hours: number;
    timestamp: number;
}

/**
 * Aggregate pool delegation data for the specified time period.
 *
 * This function performs the same aggregation as the /pools API endpoint,
 * allowing it to be called from the observer to push data via WebSocket.
 *
 * The time window is calculated relative to the most recently processed block,
 * not wall-clock time. This ensures queries return consistent data aligned with
 * what the blockchain sync has actually indexed, rather than missing recent
 * activity when the sync is behind.
 *
 * @param database - Plugin database service
 * @param blockchainService - Blockchain service for sync state
 * @param hours - Number of hours to aggregate (default: 24)
 * @returns Aggregated pool data with address book for name resolution
 */
export async function aggregatePools(
    database: IPluginDatabase,
    blockchainService: IBlockchainService,
    hours: number = 24
): Promise<IPoolsData> {
    // Calculate time window relative to most recently processed block, not wall-clock time
    const latestBlock = await blockchainService.getLatestBlock();
    const referenceTime = latestBlock?.timestamp ?? new Date();
    const since = new Date(referenceTime.getTime() - hours * 60 * 60 * 1000);
    const collection = database.getCollection('pool-delegations');
    const membersCollectionName = database.getCollection('pool-members').collectionName;

    const pools = await collection.aggregate([
        // Filter to recent energy delegations
        { $match: { timestamp: { $gte: since }, resourceType: 1 } },

        // Join with pool-members to discover the controlling pool
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

        // Extract pool address and selfSigned flag from lookup result
        {
            $addFields: {
                resolvedPool: {
                    $ifNull: [
                        { $arrayElemAt: ['$poolMembership.pool', 0] },
                        '$fromAddress'
                    ]
                },
                isSelfSigned: {
                    $ifNull: [
                        { $arrayElemAt: ['$poolMembership.selfSigned', 0] },
                        false
                    ]
                }
            }
        },

        // Group by resolved pool address (or fromAddress when pool membership unknown)
        {
            $group: {
                _id: '$resolvedPool',
                totalAmountSun: { $sum: { $abs: '$amountSun' } },
                delegationCount: { $sum: 1 },
                uniqueDelegators: { $addToSet: '$fromAddress' },
                uniqueRecipients: { $addToSet: '$toAddress' },
                selfSigned: { $first: '$isSelfSigned' }
            }
        },

        // Project final fields
        {
            $project: {
                poolAddress: '$_id',
                totalAmountTrx: { $divide: ['$totalAmountSun', 1_000_000] },
                delegationCount: 1,
                delegatorCount: { $size: '$uniqueDelegators' },
                recipientCount: { $size: '$uniqueRecipients' },
                selfSigned: 1
            }
        },
        { $sort: { totalAmountTrx: -1 } },
        { $limit: 50 }
    ]).toArray();

    // Get address book for name resolution
    const addressBookEntries = await database.find<IAddressBookEntry>('address-book', {});

    const addressMap = new Map(addressBookEntries.map(e => [e.address, e.name]));
    const addressBook: Record<string, IAddressBookEntry> = {};
    for (const entry of addressBookEntries) {
        addressBook[entry.address] = entry;
    }

    // Enrich pools with names
    const enrichedPools: IPoolAggregate[] = pools.map(pool => ({
        poolAddress: pool.poolAddress as string | null,
        totalAmountTrx: pool.totalAmountTrx as number,
        delegationCount: pool.delegationCount as number,
        delegatorCount: pool.delegatorCount as number,
        recipientCount: pool.recipientCount as number,
        poolName: pool.poolAddress ? addressMap.get(pool.poolAddress as string) ?? null : null,
        selfSigned: Boolean(pool.selfSigned)
    }));

    return {
        pools: enrichedPools,
        addressBook,
        hours,
        timestamp: Date.now()
    };
}
