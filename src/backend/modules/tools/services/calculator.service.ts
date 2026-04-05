/**
 * @fileoverview Energy and stake calculator service.
 *
 * Provides energy estimation from historical transaction data and bidirectional
 * stake calculations using live TRON network parameters via ChainParametersService.
 * Caches energy statistics to minimize database aggregation overhead.
 */

import type { ICacheService, IChainParametersService, IDatabaseService } from '@/types';
import type { Collection } from 'mongodb';
import type { TransactionDoc } from '../../../database/models/transaction-model.js';
import { logger } from '../../../lib/logger.js';

/**
 * Input parameters for energy estimation.
 */
export interface IEnergyEstimateInput {
    contractType: string;
    averageMethodCalls: number;
    expectedTransactionsPerDay: number;
}

/** Confidence rating based on sample size. */
export type ConfidenceLevel = 'low' | 'medium' | 'high';

/**
 * Energy estimation result with cost comparison and metadata.
 */
export interface IEnergyEstimate {
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

/**
 * Bidirectional stake estimation result.
 */
export interface IStakeEstimate {
    trx: number;
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

const DEFAULT_COMPLEXITY = 1500;
const DEFAULT_COMPLEXITY_MAP: Record<string, number> = {
    dex: 2500,
    nft: 1800,
    lending: 3200
};
const ENERGY_STATS_TTL_SECONDS = 60 * 60;
const ENERGY_LOOKBACK_MS = 1000 * 60 * 60 * 24 * 30;
const TRANSACTIONS_COLLECTION = 'transactions';

/**
 * Calculator service for energy estimation and stake calculations.
 *
 * Uses historical transaction data to estimate energy requirements per contract
 * type, and IChainParametersService for live network parameters (energyPerTrx,
 * bandwidthPerTrx, energyFee). This avoids duplicating the TronGrid polling and
 * caching that ChainParametersService already performs.
 *
 * All dependencies are injected via the constructor — the module resolves
 * concrete instances during init() and passes them in.
 */
export class CalculatorService {
    private readonly cache: ICacheService;
    private readonly database: IDatabaseService;
    private readonly chainParameters: IChainParametersService;

    /**
     * @param cache - Cache service for storing energy stats aggregations
     * @param database - Database service for transaction lookups
     * @param chainParameters - Chain parameters service for live network ratios
     */
    constructor(cache: ICacheService, database: IDatabaseService, chainParameters: IChainParametersService) {
        this.cache = cache;
        this.database = database;
        this.chainParameters = chainParameters;
    }

    /**
     * Estimate daily energy requirements for a contract type.
     *
     * Aggregates energy consumption from the last 30 days of transactions matching
     * the contract type, then projects daily needs based on expected usage. Returns
     * both staking and rental cost comparisons with a break-even analysis.
     *
     * @param input - Contract type, method calls per tx, and transactions per day
     * @returns Detailed energy estimate with cost comparison
     */
    async estimateEnergy(input: IEnergyEstimateInput): Promise<IEnergyEstimate> {
        const stats = await this.getEnergyStats(input.contractType);
        const averageEnergyPerCall = stats.avgEnergy;
        const requiredEnergy = Math.ceil(averageEnergyPerCall * input.averageMethodCalls * input.expectedTransactionsPerDay);
        const params = await this.chainParameters.getParameters();

        const energyPerTrx = params.parameters.energyPerTrx;
        const bandwidthPerTrx = params.parameters.bandwidthPerTrx;
        const recommendedStake = energyPerTrx > 0 ? Math.ceil(requiredEnergy / energyPerTrx) : 0;
        const energyPriceSun = params.parameters.energyFee;

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
                snapshotTimestamp: params.fetchedAt instanceof Date ? params.fetchedAt.getTime() : Number(params.fetchedAt)
            }
        };
    }

    /**
     * Calculate stake yields from a TRX amount.
     *
     * Given a TRX amount, returns the energy and bandwidth that staking it
     * would produce using live network ratios.
     *
     * @param trx - Amount of TRX to stake
     * @returns Energy, bandwidth, and network ratios
     */
    async estimateStakeFromTrx(trx: number): Promise<IStakeEstimate> {
        const params = await this.chainParameters.getParameters();
        const energyPerTrx = params.parameters.energyPerTrx;
        const bandwidthPerTrx = params.parameters.bandwidthPerTrx;

        return {
            trx,
            energy: this.round(trx * energyPerTrx),
            bandwidth: this.round(trx * bandwidthPerTrx),
            energyPerTrx: this.round(energyPerTrx, 4),
            bandwidthPerTrx: this.round(bandwidthPerTrx, 2),
            snapshotTimestamp: params.fetchedAt instanceof Date ? params.fetchedAt.getTime() : Number(params.fetchedAt)
        };
    }

    /**
     * Calculate TRX required to produce a target energy amount.
     *
     * Given a desired energy amount, returns the TRX stake needed and the
     * bandwidth that stake would also produce.
     *
     * @param energy - Desired energy amount
     * @returns TRX required, resulting bandwidth, and network ratios
     */
    async estimateStakeFromEnergy(energy: number): Promise<IStakeEstimate> {
        const params = await this.chainParameters.getParameters();
        const energyPerTrx = params.parameters.energyPerTrx;
        const bandwidthPerTrx = params.parameters.bandwidthPerTrx;
        const trx = energyPerTrx > 0 ? Math.ceil(energy / energyPerTrx) : 0;

        return {
            trx,
            energy: this.round(trx * energyPerTrx),
            bandwidth: this.round(trx * bandwidthPerTrx),
            energyPerTrx: this.round(energyPerTrx, 4),
            bandwidthPerTrx: this.round(bandwidthPerTrx, 2),
            snapshotTimestamp: params.fetchedAt instanceof Date ? params.fetchedAt.getTime() : Number(params.fetchedAt)
        };
    }

    /**
     * Get transactions collection handle.
     */
    private getTransactionsCollection(): Collection<TransactionDoc> {
        return this.database.getCollection<TransactionDoc>(TRANSACTIONS_COLLECTION);
    }

    /**
     * Aggregate energy stats for a contract type from the last 30 days.
     *
     * Sanitizes the contract type for use as a Redis cache key by stripping
     * non-alphanumeric characters (except hyphens and underscores) and
     * truncating to 100 characters to prevent cache namespace pollution.
     */
    private async getEnergyStats(contractType: string): Promise<EnergyStats> {
        const normalizedType = contractType.trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 100);
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

            const payload: EnergyStats = { avgEnergy, maxEnergy, sampleSize, updatedAt: Date.now() };
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

    /** Look up default complexity for known contract types. */
    private getDefaultComplexity(contractType: string): number {
        return DEFAULT_COMPLEXITY_MAP[contractType.toLowerCase()] ?? DEFAULT_COMPLEXITY;
    }

    /** Map sample size to a confidence rating. */
    private getConfidence(sampleSize: number): ConfidenceLevel {
        if (sampleSize >= 500) return 'high';
        if (sampleSize >= 150) return 'medium';
        return 'low';
    }

    /** Round a number to a given decimal precision. */
    private round(value: number, decimals = 2): number {
        const factor = 10 ** decimals;
        return Math.round((value + Number.EPSILON) * factor) / factor;
    }
}
