import type { Collection } from 'mongodb';
import { TransactionModel, type TransactionDoc } from '../../database/models/transaction-model.js';
import { CacheService } from '../../services/cache.service.js';
import type { Redis as RedisClient } from 'ioredis';
import type { IDatabaseService } from '@tronrelic/types';
import { ValidationError } from '../../lib/errors.js';

const TRANSACTIONS_COLLECTION = 'transactions';

export interface AccountSnapshot {
  address: string;
  recentTransactions: unknown[];
  summary: {
    totalSent: number;
    totalReceived: number;
    lastActive: Date | null;
  };
}

export class AccountService {
  private readonly cache: CacheService;
  private readonly database: IDatabaseService;

  constructor(redis: RedisClient, database: IDatabaseService) {
    this.cache = new CacheService(redis, database);
    this.database = database;
    this.database.registerModel(TRANSACTIONS_COLLECTION, TransactionModel);
  }

  private getTransactionModel() {
    return this.database.getModel<TransactionDoc>(TRANSACTIONS_COLLECTION);
  }

  private getTransactionsCollection(): Collection<TransactionDoc> {
    return this.database.getCollection<TransactionDoc>(TRANSACTIONS_COLLECTION);
  }

  async getAccountSnapshot(address: string): Promise<AccountSnapshot> {
    if (!address.startsWith('T')) {
      throw new ValidationError('Invalid TRON address');
    }

    const cacheKey = `account:snapshot:${address}`;
    const cached = await this.cache.get<AccountSnapshot>(cacheKey);
    if (cached) {
      return cached;
    }

    const recentTransactions = await this.getTransactionModel().find({
      $or: [{ 'from.address': address }, { 'to.address': address }]
    })
      .sort({ timestamp: -1 })
      .limit(50)
      .lean();

    const summary = await this.getTransactionsCollection().aggregate([
      {
        $match: {
          $or: [{ 'from.address': address }, { 'to.address': address }]
        }
      },
      {
        $group: {
          _id: null,
          totalSent: {
            $sum: {
              $cond: [{ $eq: ['$from.address', address] }, '$amountTRX', 0]
            }
          },
          totalReceived: {
            $sum: {
              $cond: [{ $eq: ['$to.address', address] }, '$amountTRX', 0]
            }
          },
          lastActive: { $max: '$timestamp' }
        }
      }
    ]).toArray();

    const snapshot: AccountSnapshot = {
      address,
      recentTransactions,
      summary: {
        totalSent: summary[0]?.totalSent ?? 0,
        totalReceived: summary[0]?.totalReceived ?? 0,
        lastActive: summary[0]?.lastActive ?? null
      }
    };

    await this.cache.set(cacheKey, snapshot, 60, ['accounts']);
    return snapshot;
  }
}
