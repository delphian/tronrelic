import crypto from 'node:crypto';
import type { Redis as RedisClient } from 'ioredis';
import type { IDatabaseService } from '@tronrelic/types';
import type { FilterQuery, Model } from 'mongoose';
import { TransactionMemoModel, type TransactionMemoDoc } from '../../database/models/transaction-memo-model.js';
import { CacheService } from '../../services/cache.service.js';
import { toBase58Address } from '../../lib/tron-address.js';

const CACHE_TTL_SECONDS = 60 * 5;
const MEMOS_COLLECTION = 'transaction_memos';

interface MemoCachePayload {
  cache: number;
  memos: MemoResponse[];
}

export interface MemoResponse {
  block_height: number;
  timestamp: number;
  transaction_id: string;
  account_from: string;
  account_to: string;
  memo: string | null;
}

export interface MemoRecentParams {
  limit: number;
  ignoreAddress: string[];
  ignoreMemo: string[];
}

export class TransactionMemoService {
  private readonly cache: CacheService;
  private readonly database: IDatabaseService;

  constructor(redis: RedisClient, database: IDatabaseService) {
    this.cache = new CacheService(redis, database);
    this.database = database;
    this.database.registerModel(MEMOS_COLLECTION, TransactionMemoModel);
  }

  /**
   * Get the registered TransactionMemo model for database operations.
   */
  private getMemoModel(): Model<TransactionMemoDoc> {
    return this.database.getModel<TransactionMemoDoc>(MEMOS_COLLECTION);
  }

  async getRecentMemos(params: MemoRecentParams): Promise<MemoCachePayload> {
    const limit = Math.min(Math.max(params.limit ?? 10, 1), 200);
    const normalizedAddresses = this.normalizeAddresses(params.ignoreAddress ?? []);
    const ignoreMemoSet = this.buildIgnoreMemoSet(params.ignoreMemo ?? []);

    const hashSource = [
      `limit:${limit}`,
      `addresses:${normalizedAddresses.join('|')}`,
      `memos:${Array.from(ignoreMemoSet).join('|')}`
    ].join(';');
    const cacheKey = `transactions:memo-recent:${crypto.createHash('sha256').update(hashSource).digest('hex')}`;

    const cached = await this.cache.get<MemoCachePayload>(cacheKey);
    if (cached) {
      return cached;
    }

    const query: FilterQuery<TransactionMemoDoc> = {};
    if (normalizedAddresses.length) {
      query.$and = [
        { fromAddress: { $nin: normalizedAddresses } },
        { toAddress: { $nin: normalizedAddresses } }
      ];
    }

    const documents = await this.getMemoModel().find(query)
      .sort({ timestamp: -1 })
      .limit(limit * 3)
      .lean();

    const memos: MemoResponse[] = [];
    for (const doc of documents) {
      if (memos.length >= limit) {
        break;
      }

      const memoValue = typeof doc.memo === 'string' ? doc.memo : '';
      if (this.shouldIgnoreMemo(memoValue, ignoreMemoSet)) {
        continue;
      }

      memos.push({
        block_height: doc.blockNumber,
        timestamp: doc.timestamp.getTime(),
        transaction_id: doc.txId,
        account_from: doc.fromAddress,
        account_to: doc.toAddress,
        memo: memoValue
      });
    }

    const cachePayload: MemoCachePayload = {
      cache: Date.now(),
      memos
    };

    await this.cache.set(cacheKey, cachePayload, CACHE_TTL_SECONDS, ['transactions-memo']);
    return { cache: 0, memos };
  }

  private normalizeAddresses(addresses: string[]): string[] {
    return addresses
      .map(address => {
        try {
          return toBase58Address(address);
        } catch (error) {
          return null;
        }
      })
      .filter((value): value is string => Boolean(value));
  }

  private buildIgnoreMemoSet(memos: string[]): Set<string> {
    const set = new Set<string>();
    for (const memo of memos) {
      if (!memo || typeof memo !== 'string') {
        continue;
      }
      const trimmed = memo.trim();
      if (!trimmed) {
        continue;
      }
      set.add(trimmed);
      set.add(trimmed.toLowerCase());
      set.add(trimmed.toUpperCase());
      set.add(Buffer.from(trimmed, 'utf8').toString('hex'));
      set.add(Buffer.from(trimmed, 'utf8').toString('hex').toLowerCase());
      set.add(Buffer.from(trimmed, 'utf8').toString('hex').toUpperCase());
    }
    return set;
  }

  private shouldIgnoreMemo(memo: string, ignoreSet: Set<string>): boolean {
    if (!ignoreSet.size) {
      return false;
    }

    if (ignoreSet.has(memo) || ignoreSet.has(memo.toLowerCase()) || ignoreSet.has(memo.toUpperCase())) {
      return true;
    }

    if (this.isHexString(memo)) {
      const decoded = this.tryDecodeHex(memo);
      if (decoded && (ignoreSet.has(decoded) || ignoreSet.has(decoded.toLowerCase()) || ignoreSet.has(decoded.toUpperCase()))) {
        return true;
      }
    } else {
      const hex = Buffer.from(memo, 'utf8').toString('hex');
      if (ignoreSet.has(hex) || ignoreSet.has(hex.toLowerCase()) || ignoreSet.has(hex.toUpperCase())) {
        return true;
      }
    }

    return false;
  }

  private isHexString(value: string): boolean {
    return /^[0-9a-fA-F]+$/u.test(value) && value.length % 2 === 0;
  }

  private tryDecodeHex(value: string): string | null {
    try {
      const buffer = Buffer.from(value, 'hex');
      const decoded = buffer.toString('utf8').replace(/\0+$/gu, '').trim();
      return decoded.length ? decoded : null;
    } catch (error) {
      return null;
    }
  }
}
