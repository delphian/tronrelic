import type { IPluginContext } from '@tronrelic/types';
import type { MarketDocument } from '@tronrelic/shared';
import type { IMarketFetcher } from '../fetchers/types.js';
import { normalizeMarket } from './market-normalizer.js';
import { MarketReliabilityService } from './market-reliability.service.js';

/**
 * Creates a market service instance with injected dependencies.
 *
 * This factory function demonstrates the transformation from singleton to dependency injection:
 * - OLD: MarketService.getInstance() (global singleton)
 * - NEW: createMarketService(context) (factory with injected dependencies)
 *
 * @param context - Plugin context providing all required services
 * @returns Configured market service instance
 */
export function createMarketService(context: IPluginContext) {
    return new MarketService(context);
}

/**
 * Market service orchestrates all market operations.
 *
 * Responsibilities:
 * - Fetching market data from all registered fetchers
 * - Normalizing diverse API responses into standardized format
 * - Computing pricing details with energy regeneration accounting
 * - Tracking reliability metrics for each market platform
 * - Storing snapshots in plugin database (auto-prefixed collections)
 * - Saving price history for trend analysis
 * - Emitting WebSocket updates on market changes
 * - Caching current market state for fast API responses
 */
class MarketService {
    private readonly reliabilityService: MarketReliabilityService;

    constructor(private readonly context: IPluginContext) {
        this.reliabilityService = new MarketReliabilityService(context);
    }

    /**
     * Refreshes all markets by fetching data from all registered fetchers.
     *
     * Workflow:
     * 1. Fetch snapshots from all fetchers in parallel
     * 2. Track reliability (success/failure) for each fetcher
     * 3. Normalize each snapshot with pricing calculations and reliability score
     * 4. Store normalized documents in database (plugin_resource-markets_markets collection)
     * 5. Save price history snapshot for trend analysis
     * 6. Emit WebSocket update event (plugin:resource-markets:update)
     * 7. Cache results for fast API responses
     *
     * Called by scheduler job every 10 minutes.
     */
    async refreshAllMarkets(fetchers: IMarketFetcher[]): Promise<void> {
        this.context.logger.info({ count: fetchers.length }, 'Starting market refresh');

        const results = await Promise.allSettled(
            fetchers.map(async fetcher => {
                try {
                    const snapshot = await fetcher.fetch();
                    if (!snapshot) {
                        // Record failure for reliability tracking
                        await this.reliabilityService.recordFailure(fetcher.guid, 'No snapshot returned');
                        return null;
                    }

                    // Record success and get reliability score
                    const reliability = await this.reliabilityService.recordSuccess(
                        snapshot.guid,
                        snapshot.availabilityPercent,
                        snapshot.effectivePrice
                    );

                    // Normalize with dependency-injected services and reliability score
                    const normalized = await normalizeMarket(this.context.usdtParameters, snapshot, reliability);

                    // Store in plugin database (auto-prefixed collection)
                    const collection = this.context.database.getCollection('markets');
                    await collection.updateOne(
                        { guid: normalized.guid },
                        { $set: normalized },
                        { upsert: true }
                    );

                    // Save price history snapshot if pricing detail exists
                    if (normalized.pricingDetail?.minUsdtTransferCost !== undefined) {
                        await this.savePriceHistory(normalized);
                    }

                    return normalized;
                } catch (error) {
                    this.context.logger.error({ error, fetcher: fetcher.name }, 'Market fetch failed');
                    // Record failure for reliability tracking
                    await this.reliabilityService.recordFailure(fetcher.guid, error);
                    return null;
                }
            })
        );

        const markets = results
            .filter((r): r is PromiseFulfilledResult<MarketDocument | null> => r.status === 'fulfilled')
            .map(r => r.value)
            .filter((m): m is MarketDocument => m !== null);

        this.context.logger.info({ successful: markets.length, total: fetchers.length }, 'Market refresh complete');

        // Emit WebSocket update (auto-prefixed event: plugin:resource-markets:update)
        this.context.websocket.emitToRoom('market-updates', 'update', {
            markets,
            timestamp: new Date().toISOString()
        });

        // Cache for API endpoints
        await this.context.cache.set('markets:current', markets, 60 * 5);
    }

    /**
     * Lists all active markets from database.
     *
     * @returns Promise resolving to array of active market documents
     */
    async listActiveMarkets(): Promise<MarketDocument[]> {
        const cached = await this.context.cache.get<MarketDocument[]>('markets:current');
        if (cached) {
            return cached;
        }

        const markets = await this.context.database.find<MarketDocument>('markets', { isActive: true });
        if (!markets.length) {
            return [];
        }

        await this.context.cache.set('markets:current', markets, 60 * 5);
        return markets;
    }

    /**
     * Gets a single market by GUID.
     *
     * @param guid - Market identifier
     * @returns Promise resolving to market document or null if not found
     */
    async getMarket(guid: string): Promise<MarketDocument | null> {
        return this.context.database.findOne<MarketDocument>('markets', { guid });
    }

    /**
     * Gets pricing history for a specific market.
     *
     * Retrieves historical pricing data from the price_history collection,
     * sorted by timestamp descending (most recent first).
     *
     * @param guid - Market identifier
     * @param limit - Maximum number of history records to return (default: 30)
     * @returns Promise resolving to array of historical pricing records
     */
    async getMarketHistory(guid: string, limit = 30): Promise<Array<{
        timestamp: Date;
        minUsdtTransferCost?: number;
        fees?: Array<{ minutes: number; sun: number; apy?: number }>;
    }>> {
        const history = await this.context.database.find<{
            timestamp: Date;
            minUsdtTransferCost?: number;
            fees?: Array<{ minutes: number; sun: number; apy?: number }>;
        }>(
            'price_history',
            { marketGuid: guid },
            {
                sort: { timestamp: -1 },
                limit
            }
        );

        return history;
    }

    /**
     * Saves a price history snapshot for a market.
     *
     * Records the current pricing details to enable historical trend analysis.
     * Snapshots are saved every 10 minutes when markets refresh.
     *
     * @param market - Market document with pricing details
     */
    private async savePriceHistory(market: MarketDocument): Promise<void> {
        const historyEntry = {
            marketGuid: market.guid,
            marketName: market.name,
            timestamp: new Date(),
            minUsdtTransferCost: market.pricingDetail?.minUsdtTransferCost,
            fees: market.fees,
            availabilityPercent: market.availabilityPercent,
            effectivePrice: market.effectivePrice,
            reliability: market.reliability
        };

        const collection = this.context.database.getCollection('price_history');
        await collection.insertOne(historyEntry);
    }
}
