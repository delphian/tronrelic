import type { Redis as RedisClient } from 'ioredis';
import type { FilterQuery } from 'mongoose';
import { TransactionModel, type TransactionDoc, type TransactionFields } from '../../database/models/transaction-model.js';
import { CacheService } from '../../services/cache.service.js';

const HIGH_AMOUNT_CACHE_TTL = 300;
const LATEST_BY_TYPE_CACHE_TTL = 60;

export interface SimplifiedTransaction {
  type: string;
  amount: number | null;
  timestamp: number;
  to: string;
  from: string;
}

export class TransactionAnalyticsService {
  private readonly cache: CacheService;

  constructor(redis: RedisClient) {
    this.cache = new CacheService(redis);
  }

  async getHighAmountTransactions(minAmountTRX: number, limit = 100) {
    const cacheKey = `analytics:high-amount:${minAmountTRX}:${limit}`;
    const cached = await this.cache.get(cacheKey) as TransactionFields[] | null;
    if (cached) {
      return cached;
    }

    const results = (await TransactionModel.find({ amountTRX: { $gte: minAmountTRX } })
      .sort({ amountTRX: -1 })
      .limit(limit)
      .lean()) as TransactionFields[];

    await this.cache.set(cacheKey, results as unknown, HIGH_AMOUNT_CACHE_TTL, ['transactions-high-amount']);
    return results;
  }

  async getAccountTransactions(address: string, skip = 0, limit = 50) {
    return TransactionModel.find({
      $or: [{ 'from.address': address }, { 'to.address': address }]
    })
      .sort({ timestamp: -1 })
      .skip(skip)
      .limit(limit)
      .lean();
  }

  async getTransactionsByIds(txIds: string[]) {
    return TransactionModel.find({ txId: { $in: txIds } }).lean();
  }

  async getLatestTransactionsByType(type: string, limit = 50) {
    const cacheKey = `analytics:latest-by-type:${type}:${limit}`;
    const cached = await this.cache.get<TransactionDoc[]>(cacheKey);
    if (cached) {
      return cached;
    }

    const results = (await TransactionModel.find({ type }).sort({ timestamp: -1 }).limit(limit).lean()) as TransactionFields[];
    await this.cache.set(cacheKey, results, LATEST_BY_TYPE_CACHE_TTL, ['transactions-latest']);
    return results;
  }

  async getSimplifiedAccountTransactions(
    address: string,
    limit: number,
    direction: 'incoming' | 'outgoing' | 'all'
  ): Promise<SimplifiedTransaction[]> {
    const sanitizedLimit = Math.min(Math.max(limit, 1), 200);

    let filter: FilterQuery<TransactionDoc>;
    if (direction === 'incoming') {
      filter = { 'to.address': address };
    } else if (direction === 'outgoing') {
      filter = { 'from.address': address };
    } else {
      filter = { $or: [{ 'from.address': address }, { 'to.address': address }] };
    }

    const documents = (await TransactionModel.find(filter)
      .sort({ timestamp: -1 })
      .limit(sanitizedLimit)
      .lean()) as TransactionFields[];

    return documents.map(doc => ({
      type: doc.type,
      amount: this.resolveAmountTrx(doc),
      timestamp: doc.timestamp instanceof Date ? doc.timestamp.getTime() : new Date(doc.timestamp).getTime(),
      to: doc.to?.address ?? 'unknown',
      from: doc.from?.address ?? 'unknown'
    }));
  }

  private resolveAmountTrx(doc: TransactionFields): number | null {
    if (typeof doc.amountTRX === 'number') {
      return doc.amountTRX;
    }
    if (typeof doc.amount === 'number') {
      return doc.amount / 1_000_000;
    }
    return null;
  }
}
