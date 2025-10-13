import crypto from 'node:crypto';
import type { Redis as RedisClient } from 'ioredis';
import type { PipelineStage } from 'mongoose';
import { MarketBillingModel } from '../../database/models/market-billing-model.js';
import { CacheService } from '../../services/cache.service.js';
import { normalizeAddress } from '../../lib/tron-address.js';
import { ValidationError } from '../../lib/errors.js';

interface BillingRecentPayload {
  cache: number;
  transfers: BillingTransfer[];
}

interface BillingTotalsPayload {
  cache: number;
  totals: BillingTotal[];
}

export interface BillingTransfer {
  transaction_timestamp: number;
  transaction_id: string;
  address_from: string;
  address_to: string;
  amount_trx: number;
}

export interface BillingTotal {
  address_to: string;
  total: number;
}

const RECENT_CACHE_TTL = 60 * 5;
const TOTALS_CACHE_TTL = 60 * 10;

export class MarketBillingService {
  private readonly cache: CacheService;

  constructor(redis: RedisClient) {
    this.cache = new CacheService(redis);
  }

  async getRecentBilling(addresses: string[], limit: number, minimum: number): Promise<BillingRecentPayload> {
    const normalized = this.normalizeAddressList(addresses);
    const sanitizedLimit = Math.min(Math.max(limit, 1), 200);
    const minAmount = Number.isFinite(minimum) && minimum > 0 ? minimum : 0;

    const hashSource = [
      `addresses:${normalized.join('|')}`,
      `limit:${sanitizedLimit}`,
      `minimum:${minAmount}`
    ].join(';');
    const cacheKey = `resource:market:billing-recent:${crypto.createHash('sha256').update(hashSource).digest('hex')}`;

    const cached = await this.cache.get<BillingRecentPayload>(cacheKey);
    if (cached) {
      return cached;
    }

    if (!normalized.length) {
      throw new ValidationError('At least one address is required');
    }

    const query: Record<string, unknown> = {
      amountTRX: { $gte: minAmount }
    };
    if (normalized.length) {
      query.addressTo = { $in: normalized };
    }

    const documents = await MarketBillingModel.find(query)
      .sort({ transactionTimestamp: -1 })
      .limit(sanitizedLimit)
      .lean();

    const transfers: BillingTransfer[] = documents.map(doc => ({
      transaction_timestamp: doc.transactionTimestamp instanceof Date
        ? doc.transactionTimestamp.getTime()
        : new Date(doc.transactionTimestamp).getTime(),
      transaction_id: doc.transactionId,
      address_from: doc.addressFrom,
      address_to: doc.addressTo,
      amount_trx: doc.amountTRX
    }));

    const payload: BillingRecentPayload = {
      cache: Date.now(),
      transfers
    };

    await this.cache.set(cacheKey, payload, RECENT_CACHE_TTL, ['market-billing:recent']);
    return payload;
  }

  async getBillingTotals(addresses: string[], hours: number, minimum: number): Promise<BillingTotalsPayload> {
    const normalized = this.normalizeAddressList(addresses);
    const lookbackHours = Math.min(Math.max(hours, 1), 24 * 30);
    const minAmount = Number.isFinite(minimum) && minimum > 0 ? minimum : 0;

    const hashSource = [
      `addresses:${normalized.join('|')}`,
      `hours:${lookbackHours}`,
      `minimum:${minAmount}`
    ].join(';');
    const cacheKey = `resource:market:billing-totals:${crypto.createHash('sha256').update(hashSource).digest('hex')}`;

    const cached = await this.cache.get<BillingTotalsPayload>(cacheKey);
    if (cached) {
      return cached;
    }

    const since = new Date(Date.now() - lookbackHours * 60 * 60 * 1000);

    const pipeline: PipelineStage[] = [
      {
        $match: {
          transactionTimestamp: { $gte: since },
          amountTRX: { $gte: minAmount },
          ...(normalized.length ? { addressTo: { $in: normalized } } : {})
        }
      },
      {
        $group: {
          _id: '$addressTo',
          total: { $sum: '$amountTRX' }
        }
      },
      { $sort: { total: -1 } }
    ];

    const rows = await MarketBillingModel.aggregate<{ _id: string; total: number }>(pipeline);

    const totals: BillingTotal[] = rows.map(row => ({
      address_to: row._id,
      total: Number(row.total.toFixed(6))
    }));

    const payload: BillingTotalsPayload = {
      cache: Date.now(),
      totals
    };

    await this.cache.set(cacheKey, payload, TOTALS_CACHE_TTL, ['market-billing:totals']);
    return payload;
  }

  private normalizeAddressList(addresses: string[]): string[] {
    return addresses
      .map(address => {
        try {
          return normalizeAddress(address).base58;
        } catch (error) {
          return null;
        }
      })
      .filter((value): value is string => Boolean(value))
      .map(address => address.trim())
      .filter((value, index, array) => value.length > 0 && array.indexOf(value) === index)
      .sort();
  }
}
