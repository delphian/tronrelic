/// <reference types="vitest" />

/**
 * @fileoverview Unit tests for the energy estimate's cost figures.
 *
 * The estimator once labelled the burn cost at the chain's `energyFee` as
 * "rent", which overstated renting several times over. These tests pin the
 * corrected meaning: every cost figure is a burn cost derived from `energyFee`,
 * the stake comparison is in days of burning, and no rent-named field returns.
 */

import { describe, it, expect } from 'vitest';
import type { ICacheService } from '@/types';
import { CalculatorService } from '../services/calculator.service.js';
import { createMockDatabaseService } from '../../../tests/vitest/mocks/database-service.js';
import { createMockChainParameters } from '../../../tests/vitest/mocks/chain-parameters.js';

/**
 * Cache that always answers with fixed energy statistics.
 *
 * The estimate reads its per-call energy from the cache before touching the
 * database, so serving a fixed figure here keeps the tests on the cost math
 * rather than on the aggregation.
 */
class FixedStatsCache implements ICacheService {
    /**
     * Build a cache that reports the given average energy per call.
     *
     * @param avgEnergy - Energy each call consumes, so the expected totals are easy to compute by hand
     */
    constructor(private readonly avgEnergy: number) {}

    /**
     * Return the fixed statistics for any key.
     *
     * @returns The statistics the calculator reads as a cache hit
     */
    async get<T>(): Promise<T | null> {
        const stats = { avgEnergy: this.avgEnergy, maxEnergy: this.avgEnergy, sampleSize: 600, updatedAt: Date.now() };
        return stats as T;
    }

    /** Ignore writes, because every read is already a hit. */
    async set(): Promise<void> {
        // No-op
    }

    /**
     * Report that nothing was deleted.
     *
     * @returns Zero, since the cache holds no real entries
     */
    async del(): Promise<number> {
        return 0;
    }

    /** Ignore tag invalidation, which the calculator never calls here. */
    async invalidate(): Promise<void> {
        // No-op
    }

    /**
     * Report no stored keys.
     *
     * @returns An empty list, since the cache holds no real entries
     */
    async keys(): Promise<string[]> {
        return [];
    }
}

/**
 * Build a calculator over fixed per-call energy and chosen chain parameters.
 *
 * @param energyFee - Burn price in SUN per energy, so a test can check the costs follow it
 * @param energyPerTrx - Staking ratio, so the stake and the burn comparison are predictable
 * @returns A calculator whose estimate depends only on the inputs above
 */
function createCalculator(energyFee: number, energyPerTrx: number): CalculatorService {
    return new CalculatorService(
        new FixedStatsCache(65_000),
        createMockDatabaseService(),
        createMockChainParameters({ energyFee, energyPerTrx })
    );
}

describe('CalculatorService.estimateEnergy', () => {
    it('prices the cost figures as burn costs at the chain energy fee', async () => {
        const calculator = createCalculator(100, 5_000);

        const estimate = await calculator.estimateEnergy({
            contractType: 'TriggerSmartContract',
            averageMethodCalls: 1,
            expectedTransactionsPerDay: 10
        });

        expect(estimate.requiredEnergy).toBe(650_000);
        expect(estimate.recommendedStake).toBe(130);
        expect(estimate.burnPriceSun).toBe(100);
        expect(estimate.burnCostPerDayTRX).toBe(65);
        expect(estimate.burnCostPerMonthTRX).toBe(1_950);
        expect(estimate.burnMatchesStakeDays).toBe(2);
    });

    it('scales the burn cost with the energy fee', async () => {
        const calculator = createCalculator(210, 5_000);

        const estimate = await calculator.estimateEnergy({
            contractType: 'TriggerSmartContract',
            averageMethodCalls: 1,
            expectedTransactionsPerDay: 10
        });

        expect(estimate.burnPriceSun).toBe(210);
        expect(estimate.burnCostPerDayTRX).toBe(136.5);
    });

    it('reports no burn comparison when the energy fee is zero', async () => {
        const calculator = createCalculator(0, 5_000);

        const estimate = await calculator.estimateEnergy({
            contractType: 'TriggerSmartContract',
            averageMethodCalls: 1,
            expectedTransactionsPerDay: 10
        });

        expect(estimate.burnCostPerDayTRX).toBe(0);
        expect(estimate.burnCostPerMonthTRX).toBe(0);
        expect(estimate.burnMatchesStakeDays).toBeNull();
    });

    it('returns no field that names the burn cost as rent', async () => {
        const calculator = createCalculator(100, 5_000);

        const estimate = await calculator.estimateEnergy({
            contractType: 'TriggerSmartContract',
            averageMethodCalls: 1,
            expectedTransactionsPerDay: 10
        });

        const rentNamedKeys = Object.keys(estimate).filter(key => /rent|breakEven|estimatedCost/i.test(key));
        expect(rentNamedKeys).toEqual([]);
    });
});
