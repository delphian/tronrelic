import type { Request, Response } from 'express';
import type { Redis as RedisClient } from 'ioredis';
import { z } from 'zod';
import { TransactionAnalyticsService, type SimplifiedTransaction } from './transaction.service.js';
import { AccountAnalyticsService } from './account-analytics.service.js';
import { TransactionMemoService } from './memo.service.js';
import { normalizeAddress } from '../../lib/tron-address.js';

const highAmountSchema = z.object({
  minAmountTRX: z.coerce.number().min(1),
  limit: z.coerce.number().min(1).max(500).default(100)
});

const accountSchema = z.object({
  address: z.string().min(34),
  skip: z.coerce.number().min(0).default(0),
  limit: z.coerce.number().min(1).max(200).default(50)
});

const idsSchema = z.object({
  txIds: z.array(z.string().min(1)).min(1).max(100)
});

const latestByTypeSchema = z.object({
  type: z.string().min(1),
  limit: z.coerce.number().min(1).max(200).default(50)
});

const accountRecentSchema = z.object({
  address: z.string().min(34),
  limit: z.coerce.number().min(1).max(1000).default(50),
  ignore: z.coerce.number().min(0).default(0)
});

const accountRangeSchema = z.object({
  address: z.string().min(34),
  startDate: z.coerce.number(),
  endDate: z.coerce.number(),
  ignore: z.coerce.number().min(0).default(0)
});

const memoRecentSchema = z.object({
  limit: z.coerce.number().min(1).max(200).default(10),
  ignoreAddress: z.array(z.string()).default([]),
  ignoreMemo: z.array(z.string()).default([])
});

const singleTransactionSchema = z.object({
  address: z.string().min(34),
  limit: z.coerce.number().min(1).max(200).default(30),
  direction: z
    .enum(['incoming', 'outgoing', 'all', 'forward', 'backward'])
    .default('all')
});

export class TransactionController {
  private readonly transactionService: TransactionAnalyticsService;
  private readonly accountService: AccountAnalyticsService;
  private readonly memoService: TransactionMemoService;

  constructor(redis: RedisClient) {
    this.transactionService = new TransactionAnalyticsService(redis);
    this.accountService = new AccountAnalyticsService(redis);
    this.memoService = new TransactionMemoService(redis);
  }

  highAmounts = async (req: Request, res: Response) => {
    const payload = highAmountSchema.parse(req.body);
    const transactions = await this.transactionService.getHighAmountTransactions(payload.minAmountTRX, payload.limit);
    res.json({ success: true, transactions });
  };

  accountTransactions = async (req: Request, res: Response) => {
    const payload = accountSchema.parse(req.body);
    const transactions = await this.transactionService.getAccountTransactions(payload.address, payload.skip, payload.limit);
    res.json({ success: true, transactions });
  };

  transactionsByIds = async (req: Request, res: Response) => {
    const payload = idsSchema.parse(req.body);
    const transactions = await this.transactionService.getTransactionsByIds(payload.txIds);
    res.json({ success: true, transactions });
  };

  latestByType = async (req: Request, res: Response) => {
    const payload = latestByTypeSchema.parse(req.body);
    const transactions = await this.transactionService.getLatestTransactionsByType(payload.type, payload.limit);
    res.json({ success: true, transactions });
  };

  accountRecent = async (req: Request, res: Response) => {
    const payload = accountRecentSchema.parse(req.body);
    const result = await this.accountService.getRecentTransactions(payload.address, payload.limit, payload.ignore);
    res.json(result);
  };

  accountDateRange = async (req: Request, res: Response) => {
    const payload = accountRangeSchema.parse(req.body);
    const result = await this.accountService.getTransactionsByDateRange(
      payload.address,
      payload.startDate,
      payload.endDate,
      payload.ignore
    );
    res.json(result);
  };

  memoRecent = async (req: Request, res: Response) => {
    const payload = memoRecentSchema.parse(req.body);
    const result = await this.memoService.getRecentMemos(payload);
    res.json({ success: true, cache: result.cache ? result.cache : false, memos: result.memos });
  };

  singleTransaction = async (req: Request, res: Response) => {
    const payload = singleTransactionSchema.parse(req.body);
    const { base58 } = normalizeAddress(payload.address);
    const direction = this.normalizeDirection(payload.direction);
    const transactions = await this.transactionService.getSimplifiedAccountTransactions(
      base58,
      payload.limit,
      direction
    );
    res.json(this.toSingleTransactionResponse(transactions));
  };

  private toSingleTransactionResponse(transactions: SimplifiedTransaction[]) {
    return {
      success: true,
      transactions: transactions.map(transaction => ({
        type: transaction.type,
        amount: transaction.amount ?? 0,
        timestamp: transaction.timestamp,
        to: transaction.to,
        from: transaction.from
      }))
    };
  }

    private normalizeDirection(direction: 'incoming' | 'outgoing' | 'all' | 'forward' | 'backward') {
      if (direction === 'incoming' || direction === 'outgoing' || direction === 'all') {
        return direction;
      }
      return 'all';
    }
}
