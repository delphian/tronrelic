import type { Redis as RedisClient } from 'ioredis';
import { MarketModel } from '../../database/models/market-model.js';
import { MarketPriceHistoryModel } from '../../database/models/market-price-history-model.js';
import type { MarketDocument } from '@tronrelic/shared';
import { logger } from '../../lib/logger.js';
import { WebSocketService } from '../../services/websocket.service.js';
import { getMarketFetcherContext, initializeMarketFetchers, marketFetcherRegistry } from './fetchers/index.js';
import { MarketNormalizer } from './market-normalizer.js';
import { MarketChangeDetector } from './market-change-detector.js';
import { MarketReliabilityService } from './market-reliability.service.js';
import { marketMetrics } from './market-metrics.service.js';
import { mapLeanMarketDoc, type LeanMarketDoc } from './market-mapper.js';
import { MarketAnalytics } from './market-analytics.js';
import { MarketAffiliateService } from './market-affiliate.service.js';
import { ChainParametersService } from '../chain-parameters/chain-parameters.service.js';

export class MarketAggregator {
    private fetchersInitialised = false;
    private readonly reliabilityService = new MarketReliabilityService();
    private readonly affiliateService = new MarketAffiliateService();
    private readonly chainParamsService = new ChainParametersService();

    constructor(private readonly redis: RedisClient, private readonly websocket = WebSocketService.getInstance()) {}

    private ensureFetchersRegistered() {
        if (!this.fetchersInitialised) {
            initializeMarketFetchers();
            this.fetchersInitialised = true;
        }
    }

    async run() {
        this.ensureFetchersRegistered();
        logger.info('Starting market aggregator run');

        // Load chain parameters (will use cache if fresh, database updated every 10 min)
        await this.chainParamsService.getParameters();

        const context = getMarketFetcherContext();
        context.chainParameters = this.chainParamsService;
    const fetchers = marketFetcherRegistry.list();
    const changedGuids = new Set<string>();

    await Promise.all(
      fetchers.map(async fetcher => {
        const startedAt = process.hrtime.bigint();
        const recordDuration = () => {
          const durationNs = process.hrtime.bigint() - startedAt;
          const durationSeconds = Number(durationNs) / 1_000_000_000;
          marketMetrics.observeDuration(fetcher.guid, durationSeconds);
        };

        try {
          const snapshot = await fetcher.fetch(context);
          if (!snapshot) {
            await this.reliabilityService.recordFailure(fetcher.guid, 'empty_snapshot');
            marketMetrics.incrementFailure(fetcher.guid);
            return null;
          }

          const normalized = await MarketNormalizer.normalize(snapshot);
          const analytics = MarketAnalytics.computePricing(snapshot);

          if (analytics.pricing) {
            normalized.pricing = analytics.pricing;
            normalized.effectivePrice = analytics.pricing.effectivePrice;
          } else {
            normalized.pricing = undefined;
          }

          const bulkDiscount = MarketAnalytics.detectBulkDiscount(analytics.pricePoints);
          if (bulkDiscount) {
            normalized.bulkDiscount = bulkDiscount;
          }

          const primaryAffiliateLink = normalized.affiliate?.link ?? normalized.siteLinks?.[0]?.link ?? null;
          const conversionCode = normalized.siteLinks?.find(link => link.conversion)?.conversion ?? undefined;
          const affiliateTracking = await this.affiliateService.ensureTracking(
            normalized.guid,
            primaryAffiliateLink,
            conversionCode
          );
          if (affiliateTracking) {
            normalized.affiliateTracking = affiliateTracking;
          }

          const reliability = await this.reliabilityService.recordSuccess(
            fetcher.guid,
            normalized.availabilityPercent,
            normalized.effectivePrice
          );
          normalized.reliability = reliability;
          normalized.availabilityConfidence = MarketAnalytics.computeAvailabilityConfidence({
            snapshot,
            pricing: normalized.pricing,
            reliability
          });
          const previousDoc = await MarketModel.findOne({ guid: normalized.guid }).lean<LeanMarketDoc | null>();
          const previous = previousDoc ? mapLeanMarketDoc(previousDoc) : null;

          const { hasChanged } = MarketChangeDetector.evaluate(previous, normalized);

          await MarketModel.updateOne(
            { guid: normalized.guid },
            {
              $set: {
                ...normalized,
                lastUpdated: new Date().toISOString()
              }
            },
            { upsert: true }
          );

          marketMetrics.incrementSuccess(fetcher.guid);
          marketMetrics.setAvailability(fetcher.guid, normalized.availabilityPercent);
          marketMetrics.setReliability(fetcher.guid, normalized.reliability);
          marketMetrics.setEffectivePrice(fetcher.guid, normalized.effectivePrice);

          if (hasChanged || !previous) {
            changedGuids.add(normalized.guid);
          }
          return normalized;
        } catch (error) {
          await this.reliabilityService.recordFailure(fetcher.guid, error);
          marketMetrics.incrementFailure(fetcher.guid);
          logger.error({ error, fetcher: fetcher.name }, 'Market fetch failed');
          return null;
        } finally {
          recordDuration();
        }
      })
    );

    const activeMarkets = await MarketModel.find({ isActive: true }).lean<LeanMarketDoc[]>();

    if (!activeMarkets.length) {
      return;
    }

    const sorted: MarketDocument[] = activeMarkets
      .map(doc => mapLeanMarketDoc(doc))
      .sort((a, b) => {
        // Sort by minUsdtTransferCost (cost for 65k energy = 1 USDT transfer)
        // This matches the frontend sorting and represents real-world usage
        const priceA = a.pricingDetail?.minUsdtTransferCost ?? Number.POSITIVE_INFINITY;
        const priceB = b.pricingDetail?.minUsdtTransferCost ?? Number.POSITIVE_INFINITY;

        if (priceA !== priceB) {
          return priceA - priceB;
        }

        // If minUsdtTransferCost is equal, use order count as tiebreaker (higher is better)
        const ordersA = a.orders?.length ?? 0;
        const ordersB = b.orders?.length ?? 0;
        return ordersB - ordersA;
      });

    sorted.forEach((market, index) => {
      market.isBestDeal = index === 0;
    });

    await Promise.all(
      sorted.map(market =>
        MarketModel.updateOne(
          { guid: market.guid },
          {
            $set: {
              isBestDeal: market.isBestDeal,
              reliability: market.reliability,
              availabilityPercent: market.availabilityPercent,
              effectivePrice: market.effectivePrice
            }
          }
        )
      )
    );

    await Promise.all(
      sorted.map(async market => {
        if (!market.pricing?.sampleSize) {
          return;
        }

        try {
          await MarketPriceHistoryModel.create({
            guid: market.guid,
            name: market.name,
            effectivePrice: market.pricing.effectivePrice,
            bestPrice: market.pricing.bestPrice,
            averagePrice: market.pricing.averagePrice,
            minUsdtTransferCost: market.pricingDetail?.minUsdtTransferCost,
            availabilityPercent: market.availabilityPercent,
            availabilityConfidence: market.availabilityConfidence,
            sampleSize: market.pricing.sampleSize
          });
        } catch (error) {
          logger.warn({ error, guid: market.guid }, 'Failed to persist market price history');
        }
      })
    );

    await this.redis.set('markets:current', JSON.stringify(sorted), 'EX', 60 * 5);

    sorted.forEach(market => {
      if (changedGuids.has(market.guid)) {
        this.websocket.emit({ event: 'market:update', payload: market });
      }
    });

    logger.info({ markets: sorted.length }, 'Market aggregator complete');
  }
}
