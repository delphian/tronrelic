import type { Redis as RedisClient } from 'ioredis';
import type { MarketDocument } from '@tronrelic/shared';
import { MarketModel } from '../../database/models/market-model.js';
import { CacheService } from '../../services/cache.service.js';
import { MarketService } from './market.service.js';
import { mapLeanMarketDoc, type LeanMarketDoc } from './market-mapper.js';
import { NotFoundError } from '../../lib/errors.js';

interface AffiliateInput {
  link?: string | null;
  commission?: number | null;
  cookieDuration?: number | null;
}

export class MarketAdminService {
  private readonly cache: CacheService;
  private readonly markets: MarketService;

  constructor(redis: RedisClient) {
    this.cache = new CacheService(redis);
    this.markets = new MarketService(redis);
  }

  async listAll(): Promise<MarketDocument[]> {
    const docs = await MarketModel.find().sort({ priority: 1 }).lean<LeanMarketDoc[]>();
    return docs.map(mapLeanMarketDoc);
  }

  async setPriority(guid: string, priority: number): Promise<MarketDocument> {
    const doc = await MarketModel.findOneAndUpdate(
      { guid },
      { $set: { priority } },
      { new: true }
    ).lean<LeanMarketDoc | null>();

    if (!doc) {
      throw new NotFoundError(`Market ${guid} not found`);
    }

    await this.cache.invalidate('markets');
    return mapLeanMarketDoc(doc);
  }

  async setActive(guid: string, isActive: boolean): Promise<MarketDocument> {
    const doc = await MarketModel.findOneAndUpdate(
      { guid },
      { $set: { isActive } },
      { new: true }
    ).lean<LeanMarketDoc | null>();

    if (!doc) {
      throw new NotFoundError(`Market ${guid} not found`);
    }

    await this.cache.invalidate('markets');
    return mapLeanMarketDoc(doc);
  }

  async updateAffiliate(guid: string, affiliate: AffiliateInput): Promise<MarketDocument> {
    let update: Record<string, unknown>;

    if (!affiliate.link) {
      update = { $unset: { affiliate: '' } };
    } else {
      const payload: Record<string, unknown> = { link: affiliate.link };
      if (affiliate.commission !== undefined && affiliate.commission !== null) {
        payload.commission = affiliate.commission;
      }
      if (affiliate.cookieDuration !== undefined && affiliate.cookieDuration !== null) {
        payload.cookieDuration = affiliate.cookieDuration;
      }
      update = { $set: { affiliate: payload } };
    }

    const doc = await MarketModel.findOneAndUpdate({ guid }, update, { new: true }).lean<LeanMarketDoc | null>();

    if (!doc) {
      throw new NotFoundError(`Market ${guid} not found`);
    }

    await this.cache.invalidate('markets');
    return mapLeanMarketDoc(doc);
  }

  async refresh(guid?: string, force = false): Promise<MarketDocument[]> {
    const shouldForce = force || Boolean(guid);
    await this.markets.refreshMarkets(shouldForce);
    return this.markets.listActiveMarkets();
  }
}
