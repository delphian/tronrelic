import { beforeEach, describe, expect, it, vi } from 'vitest';
import type Redis from 'ioredis';
import { AccountAnalyticsService } from '../../src/modules/analytics/account-analytics.service';
import { TransactionModel } from '../../src/database/models/transaction-model';
import { CacheModel } from '../../src/database/models/cache-model';

const ADDRESS = 'T'.padEnd(34, 'A');

const createRedisMock = () => ({
  get: vi.fn().mockResolvedValue(null),
  set: vi.fn().mockResolvedValue(null),
  del: vi.fn().mockResolvedValue(null)
}) as unknown as Redis;

describe('AccountAnalyticsService', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(CacheModel, 'findOne').mockResolvedValue(null as never);
    vi.spyOn(CacheModel, 'updateOne').mockResolvedValue({ acknowledged: true } as never);
  });

  it('returns exact transactions when within range limit', async () => {
    const redis = createRedisMock();
    const start = new Date('2024-01-01T00:00:00Z').getTime();
    const end = new Date('2024-01-31T23:59:59Z').getTime();

    vi.spyOn(TransactionModel, 'countDocuments').mockResolvedValue(2 as never);

    const documents = [
      {
        txId: 'tx-2',
        timestamp: new Date('2024-01-05T00:00:00Z'),
        type: 'TransferContract',
        from: { address: 'TFROM1' },
        to: { address: ADDRESS },
        amountTRX: 25
      },
      {
        txId: 'tx-1',
        timestamp: new Date('2024-01-03T00:00:00Z'),
        type: 'TransferContract',
        from: { address: ADDRESS },
        to: { address: 'TTO1' },
        amount: 10_000_000
      }
    ];

    const lean = vi.fn().mockResolvedValue(documents);
    const limit = vi.fn().mockReturnValue({ lean } as never);
    const sort = vi.fn().mockReturnValue({ limit, lean } as never);

    vi.spyOn(TransactionModel, 'find').mockReturnValue({ sort, limit, lean } as never);

    const service = new AccountAnalyticsService(redis);
    const result = await service.getTransactionsByDateRange(ADDRESS, start, end, 0);

    expect(result.success).toBe(true);
    expect(result.approximate).toBeUndefined();
    expect(result.transactions).toHaveLength(2);
    expect(result.transactions[0].record.id).toBe('tx-2');
    expect(result.transactions[0].record.amount).toBe(25);
    expect(result.transactions[1].record.amount).toBe(10);

    expect(redis.set).toHaveBeenCalled();
  });

  it('falls back to Monte Carlo aggregation when result set exceeds limit', async () => {
    const redis = createRedisMock();
    const start = new Date('2024-02-01T00:00:00Z').getTime();
    const end = new Date('2024-03-01T00:00:00Z').getTime();

    vi.spyOn(TransactionModel, 'countDocuments').mockResolvedValue(5000 as never);
    vi.spyOn(TransactionModel, 'find').mockReturnValue({
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue([])
    } as never);

    const aggregateDocuments = [
      {
        txId: 'tx-3',
        timestamp: new Date('2024-02-10T12:00:00Z'),
        type: 'TransferContract',
        from: { address: 'TFROM-1' },
        to: { address: ADDRESS },
        amountTRX: 200
      },
      {
        txId: 'tx-2',
        timestamp: new Date('2024-02-09T12:00:00Z'),
        type: 'TransferContract',
        from: { address: ADDRESS },
        to: { address: 'TTO-2' },
        amountTRX: 150
      },
      {
        txId: 'tx-1',
        timestamp: new Date('2024-02-11T12:00:00Z'),
        type: 'TransferContract',
        from: { address: 'TFROM-3' },
        to: { address: ADDRESS },
        amount: 3_000_000
      }
    ];

    vi.spyOn(TransactionModel, 'aggregate').mockResolvedValue(aggregateDocuments as never);

    const service = new AccountAnalyticsService(redis);
    const result = await service.getTransactionsByDateRange(ADDRESS, start, end, 0);

    expect(result.approximate).toBe(true);
    expect(result.transactions).toHaveLength(3);
    expect(result.transactions[0].record.id).toBe('tx-1');

    const summary = result.monteCarloSummary;
    expect(summary).toBeDefined();
    expect(summary?.populationSize).toBe(5000);
    expect(summary?.sampleSize).toBe(3);
    expect(summary?.scalingFactor).toBeCloseTo(1666.6667, 4);
    expect(summary?.estimatedIncomingTrx).toBeCloseTo(338333.33, 2);
    expect(summary?.estimatedOutgoingTrx).toBeCloseTo(250000, 2);
    expect(summary?.estimatedIncomingCount).toBeGreaterThan(0);
    expect(summary?.estimatedOutgoingCount).toBeGreaterThan(0);
  expect(summary?.topCounterparties?.[0]?.address).toBe('TFROM-1');
  expect(summary?.topCounterparties?.[0]?.direction).toBe('inflow');

    expect(redis.set).toHaveBeenCalled();
  });
});
