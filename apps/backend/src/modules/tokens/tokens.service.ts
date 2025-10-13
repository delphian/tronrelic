import type { Redis as RedisClient } from 'ioredis';
import { CacheService } from '../../services/cache.service.js';
import { SunPumpTokenModel } from '../../database/models/sunpump-token-model.js';

const CACHE_TTL_SECONDS = 60 * 5;

interface SunPumpCachePayload {
  cache: number;
  tokens: SunPumpTokenResponse[];
}

export interface SunPumpTokenResponse {
  transaction_timestamp: number;
  transaction_id: string;
  token_owner: string;
  token_name: string;
  token_symbol: string;
  token_contract: string;
}

export class TokensService {
  private readonly cache: CacheService;

  constructor(redis: RedisClient) {
    this.cache = new CacheService(redis);
  }

  async getRecentSunPumpTokens(limit: number): Promise<SunPumpCachePayload> {
    const sanitizedLimit = Math.min(Math.max(limit ?? 10, 1), 200);
    const cacheKey = `tokens:sunpump-recent:${sanitizedLimit}`;
    const cached = await this.cache.get<SunPumpCachePayload>(cacheKey);
    if (cached) {
      return cached;
    }

    const documents = await SunPumpTokenModel.find()
      .sort({ timestamp: -1 })
      .limit(sanitizedLimit)
      .lean();

    const tokens: SunPumpTokenResponse[] = documents.map(doc => ({
      transaction_timestamp: doc.timestamp instanceof Date ? doc.timestamp.getTime() : new Date(doc.timestamp).getTime(),
      transaction_id: doc.txId,
      token_owner: doc.ownerAddress,
      token_name: doc.tokenName,
      token_symbol: doc.tokenSymbol,
      token_contract: doc.tokenContract
    }));

    const payload: SunPumpCachePayload = {
      cache: Date.now(),
      tokens
    };

    await this.cache.set(cacheKey, payload, CACHE_TTL_SECONDS, ['tokens:sunpump']);
    return payload;
  }
}
