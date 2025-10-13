import { describe, expect, it, vi } from 'vitest';
import type Redis from 'ioredis';
import { CalculatorService } from '../../src/modules/analytics/calculator.service';
import { TransactionModel } from '../../src/database/models/transaction-model';
import type { TronGridClient } from '../../src/modules/blockchain/tron-grid.client';

describe('CalculatorService', () => {
  const createRedisMock = () => ({
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(null),
    del: vi.fn().mockResolvedValue(null)
  }) as unknown as Redis;

  const createTronGridMock = () => ({
    getAccountResource: vi.fn().mockResolvedValue({
      TotalEnergyLimit: 10_000_000_000,
      TotalEnergyWeight: 100_000_000,
      TotalNetLimit: 50_000_000_000,
      TotalNetWeight: 100_000_000
    }),
    getEnergyPrices: vi.fn().mockResolvedValue([
      { time: '2024-01-01T00:00:00Z', price: 420 },
      { time: '2024-02-01T00:00:00Z', price: 400 }
    ])
  }) as unknown as TronGridClient;

  it('calculates energy estimates using on-chain metrics', async () => {
    const redis = createRedisMock();
    const tronGrid = createTronGridMock();

    const aggregateSpy = vi.spyOn(TransactionModel, 'aggregate').mockReturnValue({
      exec: vi.fn().mockResolvedValue([
        {
          avgEnergy: 2000,
          maxEnergy: 5000,
          sampleSize: 250
        }
      ])
    } as never);

    const service = new CalculatorService(redis, { tronGridClient: tronGrid });
    const result = await service.estimateEnergy({
      contractType: 'TransferContract',
      averageMethodCalls: 2,
      expectedTransactionsPerDay: 10
    });

    expect(result.requiredEnergy).toBe(40_000);
    expect(result.recommendedStake).toBe(400);
    expect(result.estimatedCostTRX).toBe(504);
    expect(result.estimatedRentPerDayTRX).toBeCloseTo(16.8, 1);
    expect(result.bandwidthFromStake).toBe(200_000);
    expect(result.confidence).toBe('medium');
    expect(result.metadata.energyPerTrx).toBeCloseTo(100, 4);
    expect(result.metadata.bandwidthPerTrx).toBeCloseTo(500, 2);
    expect(tronGrid.getAccountResource).toHaveBeenCalled();

    aggregateSpy.mockRestore();
  });

  it('estimates stake outputs for provided TRX amount', async () => {
    const redis = createRedisMock();
    const tronGrid = createTronGridMock();

    const service = new CalculatorService(redis, { tronGridClient: tronGrid });
    const result = await service.estimateStake(10);

    expect(result.energy).toBe(1000);
    expect(result.bandwidth).toBe(5000);
    expect(result.energyPerTrx).toBeCloseTo(100, 4);
    expect(result.bandwidthPerTrx).toBeCloseTo(500, 2);
    expect(result.snapshotTimestamp).toBeGreaterThan(0);
  });
});
