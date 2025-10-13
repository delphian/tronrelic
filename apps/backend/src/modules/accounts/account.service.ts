import { TransactionModel } from '../../database/models/transaction-model.js';
import { CacheService } from '../../services/cache.service.js';
import type { Redis as RedisClient } from 'ioredis';
import { ValidationError } from '../../lib/errors.js';

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

  constructor(redis: RedisClient) {
    this.cache = new CacheService(redis);
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

    const recentTransactions = await TransactionModel.find({
      $or: [{ 'from.address': address }, { 'to.address': address }]
    })
      .sort({ timestamp: -1 })
      .limit(50)
      .lean();

    const summary = await TransactionModel.aggregate([
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
    ]);

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
