import type { IPluginContext } from '@tronrelic/types';
import type { MarketDocument } from '@tronrelic/shared';
import type { MarketFetcherRegistry } from '../fetchers/fetcher-registry.js';

/**
 * Affiliate configuration input for market admin operations.
 */
export interface AffiliateInput {
    link?: string | null;
    commission?: number | null;
    cookieDuration?: number | null;
}

/**
 * Market administration service for managing market configuration.
 *
 * Provides admin operations for:
 * - Setting market display priority (leaderboard ordering)
 * - Enabling/disabling individual markets
 * - Configuring affiliate links and commission tracking
 * - Triggering manual refreshes for specific markets
 *
 * All operations invalidate cached market data to ensure UI consistency.
 *
 * @param context - Plugin context with database and cache access
 * @param fetcherRegistry - Market fetcher registry for refresh operations
 */
export class MarketAdminService {
    constructor(
        private readonly context: IPluginContext,
        private readonly fetcherRegistry: MarketFetcherRegistry | null
    ) {}

    /**
     * Lists all markets (both active and inactive) sorted by priority.
     *
     * @returns Promise resolving to array of all market documents
     */
    async listAll(): Promise<MarketDocument[]> {
        const markets = await this.context.database.find<MarketDocument>(
            'markets',
            {},
            { sort: { priority: 1 } }
        );
        return markets;
    }

    /**
     * Updates the display priority for a market.
     *
     * Priority determines leaderboard ordering (lower numbers appear first).
     * Invalidates cache after update to ensure UI reflects new ordering.
     *
     * @param guid - Market identifier
     * @param priority - New priority value (0-9999)
     * @returns Updated market document
     * @throws Error if market not found
     */
    async setPriority(guid: string, priority: number): Promise<MarketDocument> {
        const collection = this.context.database.getCollection('markets');
        const result = await collection.findOneAndUpdate(
            { guid },
            { $set: { priority } },
            { returnDocument: 'after' }
        );

        if (!result) {
            throw new Error(`Market ${guid} not found`);
        }

        // Invalidate cache to reflect priority change
        await this.context.cache.del('markets:current');

        return result as unknown as MarketDocument;
    }

    /**
     * Enables or disables a market from public display.
     *
     * Inactive markets are excluded from API responses and leaderboard display.
     * Useful for temporarily hiding problematic providers without deleting data.
     *
     * @param guid - Market identifier
     * @param isActive - Active status (true = visible, false = hidden)
     * @returns Updated market document
     * @throws Error if market not found
     */
    async setActive(guid: string, isActive: boolean): Promise<MarketDocument> {
        const collection = this.context.database.getCollection('markets');
        const result = await collection.findOneAndUpdate(
            { guid },
            { $set: { isActive } },
            { returnDocument: 'after' }
        );

        if (!result) {
            throw new Error(`Market ${guid} not found`);
        }

        // Invalidate cache to reflect visibility change
        await this.context.cache.del('markets:current');

        return result as unknown as MarketDocument;
    }

    /**
     * Updates affiliate tracking configuration for a market.
     *
     * Configures affiliate links with optional commission rate and cookie duration.
     * If link is empty, removes affiliate configuration entirely.
     *
     * @param guid - Market identifier
     * @param affiliate - Affiliate configuration (link, commission, cookie duration)
     * @returns Updated market document
     * @throws Error if market not found
     */
    async updateAffiliate(guid: string, affiliate: AffiliateInput): Promise<MarketDocument> {
        const collection = this.context.database.getCollection('markets');
        let update: Record<string, unknown>;

        if (!affiliate.link) {
            // Remove affiliate configuration if link is empty
            update = { $unset: { affiliate: '' } };
        } else {
            // Build affiliate object with provided fields
            const payload: Record<string, unknown> = { link: affiliate.link };

            if (affiliate.commission !== undefined && affiliate.commission !== null) {
                payload.commission = affiliate.commission;
            }

            if (affiliate.cookieDuration !== undefined && affiliate.cookieDuration !== null) {
                payload.cookieDuration = affiliate.cookieDuration;
            }

            update = { $set: { affiliate: payload } };
        }

        const result = await collection.findOneAndUpdate(
            { guid },
            update,
            { returnDocument: 'after' }
        );

        if (!result) {
            throw new Error(`Market ${guid} not found`);
        }

        // Invalidate cache to reflect affiliate changes
        await this.context.cache.del('markets:current');

        return result as unknown as MarketDocument;
    }

    /**
     * Refreshes a single market or all markets.
     *
     * Triggers immediate data fetch from market platform(s). If guid is provided,
     * only that market is refreshed. Otherwise, all markets are refreshed.
     *
     * @param guid - Optional market identifier (omit to refresh all)
     * @param force - Force refresh even if cached data is recent
     * @returns Array of refreshed market documents
     * @throws Error if fetcher registry not initialized
     */
    async refresh(guid?: string, force = false): Promise<MarketDocument[]> {
        if (!this.fetcherRegistry) {
            throw new Error('Fetcher registry not initialized');
        }

        // Get target fetcher(s)
        const fetchers = guid
            ? this.fetcherRegistry.list().filter(f => f.guid === guid)
            : this.fetcherRegistry.list();

        if (!fetchers.length) {
            throw new Error(guid ? `Market fetcher ${guid} not found` : 'No market fetchers available');
        }

        // Import market service dynamically to avoid circular dependency
        const { createMarketService } = await import('./market.service.js');
        const marketService = createMarketService(this.context);

        // Trigger refresh
        await marketService.refreshAllMarkets(fetchers);

        // Return updated markets
        return marketService.listActiveMarkets();
    }
}
