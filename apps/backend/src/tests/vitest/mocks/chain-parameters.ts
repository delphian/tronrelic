/**
 * Centralized ChainParametersService mock for unit testing.
 *
 * Provides realistic mock implementation matching the production service's math.
 * All plugin tests should use this mock instead of implementing their own.
 *
 * Usage:
 * ```typescript
 * import { createMockChainParameters } from '../../../tests/vitest/mocks/chain-parameters.js';
 *
 * const mockContext = {
 *     chainParameters: createMockChainParameters(),
 *     // ... other context properties
 * };
 * ```
 *
 * @module tests/vitest/mocks/chain-parameters
 */

import type { IChainParametersService } from '@tronrelic/types';
import { vi } from 'vitest';

/**
 * Default chain parameters matching typical mainnet values.
 * These can be overridden when creating the mock.
 */
export interface MockChainParametersConfig {
    /**
     * Energy obtained per 1 TRX staked
     * Mainnet typical: ~210 energy per TRX
     */
    energyPerTrx?: number;

    /**
     * Energy fee in SUN per energy unit
     * Network constant: 100 SUN
     */
    energyFee?: number;
}

const DEFAULT_CONFIG: Required<MockChainParametersConfig> = {
    energyPerTrx: 210,
    energyFee: 100
};

/**
 * Creates a mock ChainParametersService with correct APY calculations.
 *
 * The mock implementation matches the production service's math exactly:
 * - getTRXFromEnergy: energy / energyPerTrx
 * - getEnergyFromTRX: trx * energyPerTrx
 * - getAPY: (cost / trxStaked) × (365 / days) × 100
 *
 * @param config - Optional configuration overrides
 * @returns Mock IChainParametersService suitable for testing
 *
 * @example
 * ```typescript
 * // Default mainnet values (210 energy/TRX)
 * const mock = createMockChainParameters();
 *
 * // Custom energy ratio
 * const mock = createMockChainParameters({ energyPerTrx: 250 });
 * ```
 */
export function createMockChainParameters(
    config: MockChainParametersConfig = {}
): IChainParametersService {
    const { energyPerTrx, energyFee } = { ...DEFAULT_CONFIG, ...config };

    return {
        /**
         * Get mock chain parameters.
         * Returns fixed values for testing (no database dependency).
         */
        getParameters: vi.fn(async () => ({
            network: 'mainnet' as const,
            parameters: {
                totalEnergyLimit: 90_000_000_000,
                totalEnergyCurrentLimit: 90_000_000_000,
                totalFrozenForEnergy: 10_000_000_000 * 1_000_000, // 10B TRX in SUN
                energyPerTrx,
                energyFee,
                totalBandwidthLimit: 43_200_000_000,
                totalFrozenForBandwidth: 5_000_000_000 * 1_000_000, // 5B TRX in SUN
                bandwidthPerTrx: 1000
            },
            fetchedAt: new Date(),
            createdAt: new Date()
        })),

        /**
         * Convert TRX to energy using configured ratio.
         *
         * Production formula: Math.floor(trx * energyPerTrx)
         *
         * @param trx - Amount in TRX
         * @returns Energy amount (floored to integer)
         */
        getEnergyFromTRX: vi.fn((trx: number): number => {
            return Math.floor(trx * energyPerTrx);
        }),

        /**
         * Convert energy to TRX using configured ratio.
         *
         * Production formula: energy / energyPerTrx
         *
         * This is the staking cost - how much TRX you'd need to stake
         * to obtain this amount of energy.
         *
         * @param energy - Energy amount
         * @returns Amount in TRX
         */
        getTRXFromEnergy: vi.fn((energy: number): number => {
            return energy / energyPerTrx;
        }),

        /**
         * Calculate APY for energy rental.
         *
         * Production formula:
         * ```
         * trxStaked = energy / energyPerTrx
         * cost = (energy × sun) / 1_000_000
         * effectiveDays = max(1, days)
         * APY = (cost / trxStaked) × (365 / effectiveDays) × 100
         * ```
         *
         * CRITICAL: This matches the production implementation exactly.
         * Previous plugin test mocks had buggy formula: (energy / 1_000_000) × energyPrice
         * Correct formula is: energy / energyPerTrx
         *
         * @param energy - Energy amount rented
         * @param sun - Rental price in SUN per energy unit
         * @param days - Rental duration in days
         * @returns APY as percentage (e.g., 15.5 for 15.5%)
         */
        getAPY: vi.fn((energy: number, sun: number, days: number): number => {
            if (days <= 0) {
                return 0;
            }

            // Staking cost: TRX needed to stake for this energy
            const trxStaked = energy / energyPerTrx;

            // Rental cost: Total TRX paid for rental
            const cost = (energy * sun) / 1_000_000; // SUN to TRX

            // Clamp duration to minimum 1 day (energy regeneration constraint)
            const effectiveDays = Math.max(1, days);

            // APY formula: annualized rental cost as percentage of staking cost
            return (cost / trxStaked) * (365 / effectiveDays) * 100;
        }),

        /**
         * Get current energy fee (SUN per energy unit).
         * Network constant: 100 SUN
         *
         * @returns Energy fee in SUN
         */
        getEnergyFee: vi.fn((): number => {
            return energyFee;
        })
    };
}

/**
 * Creates a minimal mock context with ChainParameters for testing.
 *
 * Useful for quickly setting up plugin fetcher tests without
 * manually constructing the full IPluginContext.
 *
 * @param config - Optional chain parameters configuration
 * @returns Partial IPluginContext with chainParameters configured
 *
 * @example
 * ```typescript
 * import { createMockContextWithChainParameters } from '../../../tests/vitest/mocks/chain-parameters.js';
 *
 * const context = {
 *     ...createMockContextWithChainParameters(),
 *     http: mockHttp,
 *     logger: mockLogger
 * };
 * ```
 */
export function createMockContextWithChainParameters(
    config: MockChainParametersConfig = {}
) {
    return {
        chainParameters: createMockChainParameters(config)
    };
}
