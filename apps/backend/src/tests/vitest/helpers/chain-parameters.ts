/**
 * Test helper for using real ChainParametersService with mocked database.
 *
 * This approach is superior to mocking the service because:
 * - Uses real production code (no formula duplication)
 * - Validates the actual implementation
 * - Updates automatically when service changes
 *
 * For integration tests, fetches LIVE chain parameters from TronGrid.
 * For unit tests, uses sensible defaults.
 *
 * Usage:
 * ```typescript
 * import { vi, beforeEach } from 'vitest';
 * import { createMockMongooseModule, clearMockCollections } from '../mocks/mongoose.js';
 * import { setupChainParametersForTests } from '../helpers/chain-parameters.js';
 *
 * // Mock mongoose BEFORE importing services
 * vi.mock('mongoose', async (importOriginal) => {
 *     const { createMockMongooseModule } = await import('../mocks/mongoose.js');
 *     return createMockMongooseModule()(importOriginal);
 * });
 *
 * import { ChainParametersService } from '../../../modules/chain-parameters/chain-parameters.service.js';
 *
 * describe('My Market Tests', () => {
 *     let chainParams: ChainParametersService;
 *
 *     beforeEach(async () => {
 *         clearMockCollections();
 *         chainParams = await setupChainParametersForTests({ useLiveData: true });
 *     });
 * });
 * ```
 *
 * @module tests/vitest/helpers/chain-parameters
 */

import type { IChainParameters } from '@tronrelic/types';
import axios from 'axios';
import { ChainParametersService } from '../../../modules/chain-parameters/chain-parameters.service.js';
import { createMockCollectionWithData } from '../mocks/mongoose.js';

/**
 * Response from TronGrid /wallet/getchainparameters endpoint
 */
interface TronGridChainParametersResponse {
    chainParameter: Array<{
        key: string;
        value: number;
    }>;
}

/**
 * Response from TronGrid /wallet/getaccountresource endpoint
 */
interface TronGridAccountResourceResponse {
    TotalEnergyLimit: number;
    TotalEnergyWeight: number;
    TotalNetLimit: number;
    TotalNetWeight: number;
}

/**
 * Configuration for test chain parameters.
 */
export interface ChainParametersTestConfig {
    /**
     * Use live data from TronGrid API.
     * If true, fetches real chain parameters (integration tests).
     * If false, uses default values (unit tests).
     * Default: false
     */
    useLiveData?: boolean;

    /**
     * Energy obtained per 1 TRX staked
     * Only used when useLiveData is false
     * Default: 9.5 (realistic mainnet value based on ~19B TRX staked)
     */
    energyPerTrx?: number;

    /**
     * Energy fee in SUN per energy unit
     * Only used when useLiveData is false
     * Default: 100 (network constant)
     */
    energyFee?: number;
}

const DEFAULT_TEST_CONFIG: Required<ChainParametersTestConfig> = {
    useLiveData: false,
    energyPerTrx: 9.5,
    energyFee: 100
};

/**
 * Cache for live chain parameters to avoid repeated API calls during test runs.
 */
let cachedLiveParams: IChainParameters | null = null;

/**
 * Fetches live chain parameters from TronGrid API.
 *
 * Matches production ChainParametersFetcher logic:
 * 1. Fetches protocol params from /wallet/getchainparameters (for energyFee)
 * 2. Fetches network state from /wallet/getaccountresource (for TotalEnergyWeight, TotalNetWeight)
 *
 * Results are cached for the entire test run to avoid rate limiting.
 * Uses TRONGRID_API_KEY from environment if available.
 *
 * @returns Live chain parameters from mainnet
 * @throws Error if TronGrid API request fails
 */
async function fetchLiveChainParameters(): Promise<IChainParameters> {
    if (cachedLiveParams) {
        return cachedLiveParams;
    }

    const headers: Record<string, string> = {};
    if (process.env.TRONGRID_API_KEY) {
        headers['TRON-PRO-API-KEY'] = process.env.TRONGRID_API_KEY;
    }

    // Fetch protocol parameters (fees)
    const paramsResponse = await axios.post<TronGridChainParametersResponse>(
        'https://api.trongrid.io/wallet/getchainparameters',
        {},
        { headers, timeout: 10000 }
    );

    // Fetch network state (total staked TRX)
    const resourceResponse = await axios.post<TronGridAccountResourceResponse>(
        'https://api.trongrid.io/wallet/getaccountresource',
        { address: 'TRX6Q82wMqWNbCCiLqejbZe43wk1h1zJHm', visible: true },
        { headers, timeout: 10000 }
    );

    const chainParams = paramsResponse.data.chainParameter;
    const networkState = resourceResponse.data;

    // Extract protocol parameters (matching ChainParametersFetcher logic)
    const findParam = (key: string): number => {
        const param = chainParams.find(p => p.key === key);
        return param?.value ?? 0;
    };

    const energyFee = findParam('getEnergyFee');
    const totalEnergyCurrentLimit = findParam('getTotalEnergyCurrentLimit');

    // Extract network state - live staking data from getaccountresource
    const totalEnergyLimit = networkState.TotalEnergyLimit;
    const totalEnergyWeight = networkState.TotalEnergyWeight;
    const totalBandwidthLimit = networkState.TotalNetLimit;
    const totalNetWeight = networkState.TotalNetWeight;

    // Convert TRX to SUN for storage (1 TRX = 1,000,000 SUN)
    const totalFrozenForEnergy = totalEnergyWeight * 1_000_000;
    const totalFrozenForBandwidth = totalNetWeight * 1_000_000;

    // Calculate ratios using live network state
    const energyPerTrx = totalEnergyWeight > 0
        ? totalEnergyLimit / totalEnergyWeight
        : 0;
    const bandwidthPerTrx = totalNetWeight > 0
        ? totalBandwidthLimit / totalNetWeight
        : 0;

    cachedLiveParams = {
        network: 'mainnet',
        parameters: {
            totalEnergyLimit,
            totalEnergyCurrentLimit,
            totalFrozenForEnergy,
            energyPerTrx,
            energyFee,
            totalBandwidthLimit,
            totalFrozenForBandwidth,
            bandwidthPerTrx
        },
        fetchedAt: new Date(),
        createdAt: new Date()
    };

    return cachedLiveParams;
}

/**
 * Sets up real ChainParametersService for testing with mocked database.
 *
 * This function:
 * 1. Fetches chain parameters (live from TronGrid or uses defaults)
 * 2. Creates mock chain parameters document in the database
 * 3. Gets the singleton ChainParametersService instance
 * 4. Loads parameters from mock database (populates cache)
 * 5. Returns the service ready for use with real calculation methods
 *
 * **IMPORTANT:** This must be called AFTER:
 * - `vi.mock('mongoose', ...)` has been set up
 * - `clearMockCollections()` has been called (in beforeEach)
 *
 * @param config - Optional configuration overrides
 * @returns Real ChainParametersService instance with loaded cache
 *
 * @example
 * ```typescript
 * beforeEach(async () => {
 *     clearMockCollections();
 *
 *     // Integration test: use live TronGrid data
 *     const service = await setupChainParametersForTests({ useLiveData: true });
 *
 *     // Unit test: use default values (210 energy/TRX)
 *     const service = await setupChainParametersForTests();
 *
 *     // Unit test: custom values for edge cases
 *     const service = await setupChainParametersForTests({ energyPerTrx: 250 });
 * });
 * ```
 */
export async function setupChainParametersForTests(
    config: ChainParametersTestConfig = {}
): Promise<ChainParametersService> {
    const mergedConfig = { ...DEFAULT_TEST_CONFIG, ...config };

    let mockParams: IChainParameters;

    if (mergedConfig.useLiveData) {
        // Integration test: fetch real data from TronGrid
        mockParams = await fetchLiveChainParameters();
    } else {
        // Unit test: use configured/default values with realistic network state
        mockParams = {
            network: 'mainnet',
            parameters: {
                totalEnergyLimit: 180_000_000_000,
                totalEnergyCurrentLimit: 180_000_000_000,
                totalFrozenForEnergy: 19_000_000_000_000_000, // ~19B TRX in SUN (realistic network average)
                energyPerTrx: mergedConfig.energyPerTrx,
                energyFee: mergedConfig.energyFee,
                totalBandwidthLimit: 43_200_000_000,
                totalFrozenForBandwidth: 27_000_000_000_000_000, // ~27B TRX in SUN (realistic network average)
                bandwidthPerTrx: 1.6
            },
            fetchedAt: new Date(),
            createdAt: new Date()
        };
    }

    // Populate mock database with chain parameters
    createMockCollectionWithData('chainparameters', [mockParams]);

    // IMPORTANT: Reset singleton state before getting new instance
    // This ensures clean state in tests
    resetChainParametersService();

    // Get singleton instance (creates new one or reuses existing)
    const service = ChainParametersService.getInstance();

    // Force cache refresh by calling getParameters
    // This loads the mock data into the service's internal cache
    await service.getParameters();

    return service;
}

/**
 * Resets ChainParametersService singleton state for test isolation.
 *
 * Call this in a global `afterEach()` hook to ensure clean state between tests.
 * Without this, the singleton will carry cached data across test suites.
 *
 * @example
 * ```typescript
 * import { afterEach } from 'vitest';
 * import { resetChainParametersService } from '../helpers/chain-parameters.js';
 *
 * afterEach(() => {
 *     resetChainParametersService();
 * });
 * ```
 */
export function resetChainParametersService(): void {
    // Access private static instance via type assertion
    // This is safe in test context to ensure clean state
    (ChainParametersService as any).instance = null;
}
