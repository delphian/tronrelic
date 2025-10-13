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

  async listActiveMarkets(): Promise<MarketDocument[]> {
    const cached = await this.cache.get<MarketDocument[]>('markets:current');
    if (cached) {
      return cached;
    }

    const docs = await MarketModel.find({ isActive: true }).sort({ priority: 1 }).lean<LeanMarketDoc[]>();
    if (!docs.length) {
      await this.refreshMarkets();
      return this.listActiveMarkets();
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

  async getPriceHistory(guid: string, limit = 168): Promise<MarketPriceHistoryEntry[]> {
    const entries = await MarketPriceHistoryModel.find({ guid })
      .sort({ recordedAt: -1 })
      .limit(Math.max(1, limit))
      .lean();

    return entries
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

  async recordAffiliateImpression(guid: string, trackingCode: string): Promise<MarketAffiliateTracking | null> {
    return this.affiliate.recordImpression(guid, trackingCode);
  }

  async recordAffiliateClick(guid: string, trackingCode: string): Promise<MarketAffiliateTracking | null> {
    return this.affiliate.recordClick(guid, trackingCode);
  }
}
