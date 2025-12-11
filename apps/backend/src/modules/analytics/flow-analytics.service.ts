import type { Redis as RedisClient } from 'ioredis';
import type { IDatabaseService } from '@tronrelic/types';
import type { Collection } from 'mongodb';
import { TransactionModel, type TransactionDoc } from '../../database/models/transaction-model.js';
import { CacheService } from '../../services/cache.service.js';
import { ValidationError } from '../../lib/errors.js';

export type FlowDirection = 'inflow' | 'outflow';

interface FlowTotalsResult {
  [address: string]: {
    amount: number;
    total: number;
  };
}

interface FlowSeriesEntry {
  date: string;
  totalAmount: number;
  transactions: Array<{ amount: number }>;
}

interface FlowSeriesResult {
  success: boolean;
  transactions: FlowSeriesEntry[];
}

interface TotalsResponse {
  success: boolean;
  inflows?: FlowTotalsResult;
  outflows?: FlowTotalsResult;
}

const CACHE_TTL_SECONDS = 600;
const MAX_SERIES_RESULTS = 5000;
const TRANSACTIONS_COLLECTION = 'transactions';

export class FlowAnalyticsService {
  private readonly cache: CacheService;
  private readonly database: IDatabaseService;

  constructor(redis: RedisClient, database: IDatabaseService) {
    this.cache = new CacheService(redis, database);
    this.database = database;
    this.database.registerModel(TRANSACTIONS_COLLECTION, TransactionModel);
  }

  /**
   * Get the transactions collection for aggregate operations.
   */
  private getTransactionsCollection(): Collection<TransactionDoc> {
    return this.database.getCollection<TransactionDoc>(TRANSACTIONS_COLLECTION);
  }

  /**
   * Get the registered Transaction model for database operations.
   */
  private getTransactionModel() {
    return this.database.getModel<TransactionDoc>(TRANSACTIONS_COLLECTION);
  }

  async getTotals(
    direction: FlowDirection,
    address: string,
    startDateMs: number,
    endDateMs: number,
    ignoreTrx: number
  ): Promise<TotalsResponse> {
    this.assertAddress(address);
    const { start, end } = this.normalizeRange(startDateMs, endDateMs);
    const ignoreSun = this.toSun(ignoreTrx);

    const cacheKey = `analytics:flow:${direction}:totals:${address}:${start.getTime()}:${end.getTime()}:${ignoreSun}`;
    const cached = await this.cache.get<TotalsResponse>(cacheKey);
    if (cached) {
      return cached;
    }

    const baseMatch: Record<string, unknown> = {
      type: 'TransferContract',
      timestamp: { $gte: start, $lte: end },
      amount: { $gt: ignoreSun }
    };

    if (direction === 'inflow') {
      baseMatch['to.address'] = address;
    } else {
      baseMatch['from.address'] = address;
    }

    const counterpartField = direction === 'inflow' ? '$from.address' : '$to.address';

    const aggregation = await this.getTransactionsCollection().aggregate<{
      _id: string | null;
      amount: number;
      total: number;
    }>([
      { $match: baseMatch },
      {
        $group: {
          _id: counterpartField,
          amount: { $sum: '$amount' },
          total: { $sum: 1 }
        }
      },
      { $match: { _id: { $nin: [null, address] } } },
      { $sort: { amount: -1 } }
    ]).toArray();

    const totals: FlowTotalsResult = {};
    for (const row of aggregation) {
      if (!row._id) {
        continue;
      }
      totals[row._id] = {
        amount: row.amount,
        total: row.total
      };
    }

    const result: TotalsResponse = direction === 'inflow' ? { success: true, inflows: totals } : { success: true, outflows: totals };

    await this.cache.set(cacheKey, result, CACHE_TTL_SECONDS, ['flow-totals']);

    return result;
  }

  async getSeries(
    direction: FlowDirection,
    address: string,
    targetAddress: string,
    startDateMs: number,
    endDateMs: number,
    ignoreTrx: number
  ): Promise<FlowSeriesResult> {
    this.assertAddress(address);
    this.assertAddress(targetAddress);
    const { start, end } = this.normalizeRange(startDateMs, endDateMs);
    const ignoreSun = this.toSun(ignoreTrx);

    const cacheKey = `analytics:flow:${direction}:series:${address}:${targetAddress}:${start.getTime()}:${end.getTime()}:${ignoreSun}`;
    const cached = await this.cache.get<FlowSeriesResult>(cacheKey);
    if (cached) {
      return cached;
    }

    const match: Record<string, unknown> = {
      type: 'TransferContract',
      timestamp: { $gte: start, $lte: end },
      amount: { $gt: ignoreSun },
      $or: [
        { 'from.address': address, 'to.address': targetAddress },
        { 'from.address': targetAddress, 'to.address': address }
      ]
    };

    const documents = (await this.getTransactionModel().find(match)
      .sort({ timestamp: 1 })
      .limit(MAX_SERIES_RESULTS + 1)
      .lean()) as Array<{
      timestamp: Date;
      amount?: number;
      amountTRX?: number;
    }>;

    if (documents.length > MAX_SERIES_RESULTS) {
      throw new ValidationError('Too many transactions. Please narrow down the dates.');
    }

    const buckets = new Map<string, FlowSeriesEntry>();

    for (const doc of documents) {
      const dateKey = this.formatDate(doc.timestamp);
      const entry = buckets.get(dateKey) ?? { date: dateKey, totalAmount: 0, transactions: [] };
      const amountTrx = doc.amountTRX ?? (typeof doc.amount === 'number' ? doc.amount / 1_000_000 : 0);
      entry.totalAmount += amountTrx;
      entry.transactions.push({ amount: amountTrx });
      buckets.set(dateKey, entry);
    }

    // Ensure continuity across date range
    for (const date of this.iterateDates(start, end)) {
      if (!buckets.has(date)) {
        buckets.set(date, { date, totalAmount: 0, transactions: [] });
      }
    }

    const transactions = Array.from(buckets.values()).sort((a, b) => Number.parseInt(a.date, 10) - Number.parseInt(b.date, 10));

    const result: FlowSeriesResult = { success: true, transactions };

    await this.cache.set(cacheKey, result, CACHE_TTL_SECONDS, ['flow-series']);

    return result;
  }

  private iterateDates(start: Date, end: Date) {
    const dates: string[] = [];
    const cursor = new Date(start.getTime());
    cursor.setHours(0, 0, 0, 0);

    const limit = end.getTime();
    while (cursor.getTime() <= limit) {
      dates.push(this.formatDate(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
    return dates;
  }

  private formatDate(date: Date) {
    const year = date.getUTCFullYear();
    const month = `${date.getUTCMonth() + 1}`.padStart(2, '0');
    const day = `${date.getUTCDate()}`.padStart(2, '0');
    return `${year}${month}${day}`;
  }

  private normalizeRange(startMs: number, endMs: number) {
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
      throw new ValidationError('Invalid date range supplied');
    }
    const start = new Date(Math.min(startMs, endMs));
    const end = new Date(Math.max(startMs, endMs));
    if (start.getTime() === end.getTime()) {
      end.setMilliseconds(end.getMilliseconds() + 1);
    }
    return { start, end };
  }

  private assertAddress(address: string) {
    if (!address || typeof address !== 'string' || address.length < 34 || address.length > 64) {
      throw new ValidationError('Invalid Tron address supplied');
    }
    if (!address.startsWith('T')) {
      throw new ValidationError('Address must be a base58 Tron wallet address');
    }
  }

  private toSun(amountTrx: number) {
    if (!amountTrx || !Number.isFinite(amountTrx)) {
      return 0;
    }
    return Math.floor(amountTrx * 1_000_000);
  }
}
