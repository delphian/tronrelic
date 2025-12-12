import type { Redis as RedisClient } from 'ioredis';
import type { IDatabaseService } from '@tronrelic/types';
import type { Collection } from 'mongodb';
import { CacheService } from '../../services/cache.service.js';
import { TransactionModel, type TransactionDoc } from '../../database/models/transaction-model.js';
import { TronGridClient } from '../blockchain/tron-grid.client.js';
import { logger } from '../../lib/logger.js';

export interface EnergyEstimateInput {
  contractType: string;
  averageMethodCalls: number;
  expectedTransactionsPerDay: number;
}

export type ConfidenceLevel = 'low' | 'medium' | 'high';

export interface EnergyEstimate {
  requiredEnergy: number;
  recommendedStake: number;
  estimatedCostTRX: number;
  averageEnergyPerCall: number;
  maxObservedEnergy: number;
  sampleSize: number;
  confidence: ConfidenceLevel;
  energyPriceSun: number;
  estimatedRentPerDayTRX: number;
  estimatedRentPerMonthTRX: number;
  breakEvenDays: number | null;
  bandwidthFromStake: number;
  metadata: {
    energyPerTrx: number;
    bandwidthPerTrx: number;
    snapshotTimestamp: number;
  };
}

export interface StakeEstimate {
  energy: number;
  bandwidth: number;
  energyPerTrx: number;
  bandwidthPerTrx: number;
  snapshotTimestamp: number;
}

interface EnergyStats {
  avgEnergy: number;
  maxEnergy: number;
  sampleSize: number;
  updatedAt: number;
}

interface NetworkSnapshot {
  energyPerTrx: number;
  bandwidthPerTrx: number;
  totalEnergyWeight: number;
  totalEnergyLimit: number;
  totalNetWeight: number;
  totalNetLimit: number;
  energyPriceSun: number;
  updatedAt: number;
}

const NETWORK_REFERENCE_ADDRESS = 'TLLM21wteSPs4hKjbxgmH1L6poyMjeTbHm';
const DEFAULT_COMPLEXITY = 1500;
const DEFAULT_COMPLEXITY_MAP: Record<string, number> = {
  dex: 2500,
  nft: 1800,
  lending: 3200
};
const DEFAULT_ENERGY_PER_TRX = 280;
const DEFAULT_BANDWIDTH_PER_TRX = 1500;
const DEFAULT_ENERGY_PRICE_SUN = 420;
const ENERGY_STATS_TTL_SECONDS = 60 * 60; // 1 hour
const NETWORK_SNAPSHOT_TTL_SECONDS = 60 * 5; // 5 minutes
const ENERGY_LOOKBACK_MS = 1000 * 60 * 60 * 24 * 30; // 30 days
const TRANSACTIONS_COLLECTION = 'transactions';

export class CalculatorService {
  private readonly cache: CacheService;
  private readonly database: IDatabaseService;
  private readonly tronGridClient: TronGridClient;

  constructor(redis: RedisClient, database: IDatabaseService, deps?: { tronGridClient?: TronGridClient }) {
    this.cache = new CacheService(redis, database);
    this.database = database;
    this.database.registerModel(TRANSACTIONS_COLLECTION, TransactionModel);
    this.tronGridClient = deps?.tronGridClient ?? TronGridClient.getInstance();
  }

  /**
   * Get the transactions collection for aggregate operations.
   */
  private getTransactionsCollection(): Collection<TransactionDoc> {
    return this.database.getCollection<TransactionDoc>(TRANSACTIONS_COLLECTION);
  }

  async estimateEnergy(input: EnergyEstimateInput): Promise<EnergyEstimate> {
    const stats = await this.getEnergyStats(input.contractType);
    const averageEnergyPerCall = stats.avgEnergy;
    const requiredEnergy = Math.ceil(averageEnergyPerCall * input.averageMethodCalls * input.expectedTransactionsPerDay);
    const network = await this.getNetworkSnapshot();

    const energyPerTrx = network.energyPerTrx || DEFAULT_ENERGY_PER_TRX;
    const bandwidthPerTrx = network.bandwidthPerTrx || DEFAULT_BANDWIDTH_PER_TRX;
    const recommendedStake = energyPerTrx > 0 ? Math.ceil(requiredEnergy / energyPerTrx) : 0;
    const energyPriceSun = network.energyPriceSun || DEFAULT_ENERGY_PRICE_SUN;

    const rentPerDayTrx = energyPriceSun > 0 ? (requiredEnergy * energyPriceSun) / 1_000_000 : 0;
    const rentPerMonthTrx = rentPerDayTrx * 30;
    const estimatedCostTRX = Math.ceil(rentPerMonthTrx);
    const breakEvenDays = rentPerDayTrx > 0 ? recommendedStake / rentPerDayTrx : null;

    return {
      requiredEnergy,
      recommendedStake,
      estimatedCostTRX,
      averageEnergyPerCall: Math.round(averageEnergyPerCall),
      maxObservedEnergy: Math.round(stats.maxEnergy),
      sampleSize: stats.sampleSize,
      confidence: this.getConfidence(stats.sampleSize),
      energyPriceSun,
      estimatedRentPerDayTRX: this.round(rentPerDayTrx),
      estimatedRentPerMonthTRX: this.round(rentPerMonthTrx),
      breakEvenDays: breakEvenDays != null ? this.round(breakEvenDays, 1) : null,
      bandwidthFromStake: this.round(recommendedStake * bandwidthPerTrx),
      metadata: {
        energyPerTrx: this.round(energyPerTrx, 4),
        bandwidthPerTrx: this.round(bandwidthPerTrx, 2),
        snapshotTimestamp: network.updatedAt
      }
    };
  }

  async estimateStake(trx: number): Promise<StakeEstimate> {
    const network = await this.getNetworkSnapshot();
    const energyPerTrx = network.energyPerTrx || DEFAULT_ENERGY_PER_TRX;
    const bandwidthPerTrx = network.bandwidthPerTrx || DEFAULT_BANDWIDTH_PER_TRX;

    return {
      energy: this.round(trx * energyPerTrx),
      bandwidth: this.round(trx * bandwidthPerTrx),
      energyPerTrx: this.round(energyPerTrx, 4),
      bandwidthPerTrx: this.round(bandwidthPerTrx, 2),
      snapshotTimestamp: network.updatedAt
    };
  }

  private async getEnergyStats(contractType: string): Promise<EnergyStats> {
    const normalizedType = contractType.trim();
    const cacheKey = `calc:energy-stats:${normalizedType}`;
    const cached = await this.cache.get<EnergyStats>(cacheKey);
    if (cached) {
      return cached;
    }

    const lookback = new Date(Date.now() - ENERGY_LOOKBACK_MS);

    try {
      const results = await this.getTransactionsCollection().aggregate<{
        avgEnergy: number;
        maxEnergy: number;
        sampleSize: number;
      }>([
        {
          $match: {
            type: normalizedType,
            timestamp: { $gte: lookback },
            'energy.consumed': { $gt: 0 }
          }
        },
        {
          $group: {
            _id: null,
            avgEnergy: { $avg: '$energy.consumed' },
            maxEnergy: { $max: '$energy.consumed' },
            sampleSize: { $sum: 1 }
          }
        }
      ]).toArray();

      const stats = results?.[0];
      const avgEnergy = stats?.avgEnergy ?? this.getDefaultComplexity(normalizedType);
      const maxEnergy = stats?.maxEnergy ?? avgEnergy;
      const sampleSize = stats?.sampleSize ?? 0;

      const payload: EnergyStats = {
        avgEnergy,
        maxEnergy,
        sampleSize,
        updatedAt: Date.now()
      };

      await this.cache.set(cacheKey, payload, ENERGY_STATS_TTL_SECONDS, ['analytics:energy']);
      return payload;
    } catch (error) {
      logger.error({ error, contractType: normalizedType }, 'Failed to aggregate energy stats');
      return {
        avgEnergy: this.getDefaultComplexity(normalizedType),
        maxEnergy: this.getDefaultComplexity(normalizedType) * 1.5,
        sampleSize: 0,
        updatedAt: Date.now()
      };
    }
  }

  private async getNetworkSnapshot(): Promise<NetworkSnapshot> {
    const cacheKey = 'calc:network-snapshot';
    const cached = await this.cache.get<NetworkSnapshot>(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      const [resource, prices] = await Promise.all([
        this.tronGridClient.getAccountResource(NETWORK_REFERENCE_ADDRESS),
        this.tronGridClient.getEnergyPrices()
      ]);

      const energyPerTrx = this.computeRatio(resource.TotalEnergyLimit, resource.TotalEnergyWeight, DEFAULT_ENERGY_PER_TRX);
      const bandwidthPerTrx = this.computeRatio(resource.TotalNetLimit, resource.TotalNetWeight, DEFAULT_BANDWIDTH_PER_TRX);
      const energyPriceSun = this.getLatestEnergyPrice(prices) ?? DEFAULT_ENERGY_PRICE_SUN;

      const snapshot: NetworkSnapshot = {
        energyPerTrx,
        bandwidthPerTrx,
        totalEnergyLimit: resource.TotalEnergyLimit,
        totalEnergyWeight: resource.TotalEnergyWeight,
        totalNetLimit: resource.TotalNetLimit,
        totalNetWeight: resource.TotalNetWeight,
        energyPriceSun,
        updatedAt: Date.now()
      };

      await this.cache.set(cacheKey, snapshot, NETWORK_SNAPSHOT_TTL_SECONDS, ['analytics:network']);
      return snapshot;
    } catch (error) {
      logger.error({ error }, 'Failed to build network snapshot');
      return {
        energyPerTrx: DEFAULT_ENERGY_PER_TRX,
        bandwidthPerTrx: DEFAULT_BANDWIDTH_PER_TRX,
        totalEnergyLimit: 0,
        totalEnergyWeight: 0,
        totalNetLimit: 0,
        totalNetWeight: 0,
        energyPriceSun: DEFAULT_ENERGY_PRICE_SUN,
        updatedAt: Date.now()
      };
    }
  }

  private getDefaultComplexity(contractType: string): number {
    const key = contractType.toLowerCase();
    return DEFAULT_COMPLEXITY_MAP[key] ?? DEFAULT_COMPLEXITY;
  }

  private getConfidence(sampleSize: number): ConfidenceLevel {
    if (sampleSize >= 500) {
      return 'high';
    }
    if (sampleSize >= 150) {
      return 'medium';
    }
    return 'low';
  }

  private getLatestEnergyPrice(prices: Array<{ time: string; price: number }>): number | null {
    if (!prices?.length) {
      return null;
    }
    const sorted = [...prices].sort((a, b) => (a.time > b.time ? 1 : -1));
    return sorted.at(-1)?.price ?? null;
  }

  private computeRatio(limit: number, weight: number, fallback: number): number {
    if (!weight || weight <= 0) {
      return fallback;
    }
    const ratio = limit / weight;
    if (!Number.isFinite(ratio) || ratio <= 0) {
      return fallback;
    }
    return ratio;
  }

  private round(value: number, decimals = 2): number {
    const factor = 10 ** decimals;
    return Math.round((value + Number.EPSILON) * factor) / factor;
  }
}
