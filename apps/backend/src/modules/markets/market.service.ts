import type { Redis as RedisClient } from 'ioredis';
import type {
  MarketAffiliateTracking,
  MarketComparisonResult,
  MarketDocument,
  MarketPriceHistoryEntry
} from '@tronrelic/shared';
import { MarketModel } from '../../database/models/market-model.js';
import { MarketPriceHistoryModel } from '../../database/models/market-price-history-model.js';
import { CacheService } from '../../services/cache.service.js';
import { MarketAggregator } from './market-aggregator.js';
import { mapLeanMarketDoc, type LeanMarketDoc } from './market-mapper.js';
import { MarketAffiliateService } from './market-affiliate.service.js';

export class MarketService {
  private readonly cache: CacheService;
  private readonly aggregator: MarketAggregator;
  private readonly affiliate: MarketAffiliateService;

  constructor(redis: RedisClient) {
    this.cache = new CacheService(redis);
    this.aggregator = new MarketAggregator(redis);
    this.affiliate = new MarketAffiliateService();
  }

  /**
   * Lists all active markets from the database.
   *
   * If no markets exist in the database, triggers a background refresh and returns
   * an empty array immediately rather than blocking. This ensures API endpoints
   * remain responsive during initial market fetching.
   *
   * @returns Promise resolving to array of active market documents
   */
  async listActiveMarkets(): Promise<MarketDocument[]> {
    const cached = await this.cache.get<MarketDocument[]>('markets:current');
    if (cached) {
      return cached;
    }

    const docs = await MarketModel.find({ isActive: true }).sort({ priority: 1 }).lean<LeanMarketDoc[]>();
    if (!docs.length) {
      // Trigger background refresh without blocking
      this.refreshMarkets().catch(err => {
        console.error('Background market refresh failed:', err);
      });
      return [];
    }

    const markets = docs.map(doc => mapLeanMarketDoc(doc));

    await this.cache.set('markets:current', markets, 60 * 5, ['markets']);
    return markets;
  }

  async refreshMarkets(force = false) {
    if (force) {
      await this.cache.invalidate('markets');
    }
    await this.aggregator.run();
  }

  async getComparison(limit = 25): Promise<MarketComparisonResult> {
    const markets = await this.listActiveMarkets();
    const sorted = [...markets].sort((a, b) => {
      const priceA = a.pricing?.effectivePrice ?? a.effectivePrice ?? Number.POSITIVE_INFINITY;
      const priceB = b.pricing?.effectivePrice ?? b.effectivePrice ?? Number.POSITIVE_INFINITY;
      return priceA - priceB;
    });

    const limited = sorted.slice(0, Math.max(1, limit));
    const prices = sorted
      .map(market => market.pricing?.effectivePrice ?? market.effectivePrice)
      .filter((price): price is number => typeof price === 'number' && Number.isFinite(price));

    const averagePrice = prices.length
      ? Number((prices.reduce((sum, price) => sum + price, 0) / prices.length).toFixed(4))
      : undefined;
    const medianPrice = prices.length
      ? (() => {
          const sortedPrices = [...prices].sort((a, b) => a - b);
          const mid = Math.floor(sortedPrices.length / 2);
          if (sortedPrices.length % 2 === 0) {
            return Number(((sortedPrices[mid - 1] + sortedPrices[mid]) / 2).toFixed(4));
          }
          return Number(sortedPrices[mid].toFixed(4));
        })()
      : undefined;
    const bestPrice = prices.length ? Number(Math.min(...prices).toFixed(4)) : undefined;
    const worstPrice = prices.length ? Number(Math.max(...prices).toFixed(4)) : undefined;

    return {
      markets: limited,
      stats: {
        totalMarkets: markets.length,
        averagePrice,
        medianPrice,
        bestPrice,
        worstPrice
      }
    };
  }

  /**
   * Retrieves market pricing history with optional time-bucket aggregation.
   *
   * When `bucketHours` is provided, aggregates raw data points (recorded every 10 minutes)
   * into time buckets of the specified size (e.g., 6 hours), computing the average
   * minUsdtTransferCost for each bucket. This reduces payload size from 4,320 records
   * to ~120 buckets for 30-day queries, while preserving trend accuracy.
   *
   * @param guid - Market identifier to query
   * @param limit - Maximum number of raw records to retrieve (default: 168 for 7 days, max: 5000)
   * @param bucketHours - Optional aggregation bucket size in hours (1-24)
   * @returns Array of market history entries (raw or aggregated)
   */
  async getPriceHistory(guid: string, limit = 168, bucketHours?: number): Promise<MarketPriceHistoryEntry[]> {
    const rawEntries = await MarketPriceHistoryModel.find({ guid })
      .sort({ recordedAt: -1 })
      .limit(Math.max(1, Math.min(limit, 5000)))
      .lean();

    // If no bucketing requested, return raw data
    if (!bucketHours) {
      return rawEntries
        .map(entry => ({
          recordedAt: entry.recordedAt instanceof Date ? entry.recordedAt.toISOString() : new Date(entry.recordedAt).toISOString(),
          effectivePrice: entry.effectivePrice ?? undefined,
          bestPrice: entry.bestPrice ?? undefined,
          averagePrice: entry.averagePrice ?? undefined,
          minUsdtTransferCost: entry.minUsdtTransferCost ?? undefined,
          availabilityPercent: entry.availabilityPercent ?? undefined,
          availabilityConfidence: entry.availabilityConfidence ?? undefined,
          sampleSize: entry.sampleSize ?? undefined
        }))
        .reverse();
    }

    // Aggregate into time buckets
    const bucketSizeMs = bucketHours * 60 * 60 * 1000;
    const buckets = new Map<number, typeof rawEntries>();

    rawEntries.forEach(entry => {
      const timestamp = new Date(entry.recordedAt).getTime();
      const bucketKey = Math.floor(timestamp / bucketSizeMs) * bucketSizeMs;

      if (!buckets.has(bucketKey)) {
        buckets.set(bucketKey, []);
      }
      buckets.get(bucketKey)!.push(entry);
    });

    // Calculate aggregated values for each bucket
    const aggregated = Array.from(buckets.entries())
      .map(([bucketTimestamp, entries]) => {
        // Filter and aggregate minUsdtTransferCost
        const validCosts = entries
          .map(e => e.minUsdtTransferCost)
          .filter((cost): cost is number => typeof cost === 'number' && cost > 0);

        const avgCost = validCosts.length > 0
          ? validCosts.reduce((sum, cost) => sum + cost, 0) / validCosts.length
          : undefined;

        return {
          recordedAt: new Date(bucketTimestamp).toISOString(),
          minUsdtTransferCost: avgCost,
          effectivePrice: undefined,
          bestPrice: undefined,
          averagePrice: undefined,
          availabilityPercent: undefined,
          availabilityConfidence: undefined,
          sampleSize: entries.length
        };
      })
      .sort((a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime());

    return aggregated;
  }

  async recordAffiliateImpression(guid: string, trackingCode: string): Promise<MarketAffiliateTracking | null> {
    return this.affiliate.recordImpression(guid, trackingCode);
  }

  async recordAffiliateClick(guid: string, trackingCode: string): Promise<MarketAffiliateTracking | null> {
    return this.affiliate.recordClick(guid, trackingCode);
  }
}
