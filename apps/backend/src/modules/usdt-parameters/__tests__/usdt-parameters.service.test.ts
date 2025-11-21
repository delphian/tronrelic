/// <reference types="vitest" />

/**
 * UsdtParametersService Tests
 *
 * Tests for the USDT parameters service caching and fallback behavior.
 *
 * **Why these tests matter:**
 * The service has a caching bug where fallback values aren't properly cached,
 * causing null reference errors on subsequent calls. These tests verify:
 * - Fallback values are returned when DB is empty
 * - Fallback values are cached correctly for subsequent calls
 * - Cache expiry works as expected
 * - Service handles database errors gracefully
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { UsdtParametersService } from '../usdt-parameters.service.js';
import { UsdtParametersModel } from '../../../database/models/usdt-parameters-model.js';

// Mock the logger (follows pattern from migration tests)
vi.mock('../../../lib/logger.js', () => ({
    logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
    }
}));

// Mock the Mongoose model
vi.mock('../../../database/models/usdt-parameters-model.js', () => ({
    UsdtParametersModel: {
        findOne: vi.fn()
    }
}));

describe('UsdtParametersService - Caching Bug Reproduction', () => {
    let service: UsdtParametersService;

    beforeEach(() => {
        // Reset singleton instance before each test
        (UsdtParametersService as any).instance = null;

        // Clear all mocks
        vi.clearAllMocks();
    });

    afterEach(() => {
        // Clean up singleton after tests
        (UsdtParametersService as any).instance = null;
    });

    /**
     * Test: Reproduces the production bug where fallback values aren't cached.
     *
     * **Current behavior (BUG):**
     * 1. First call: DB returns null, service returns fallback WITHOUT caching it
     * 2. Service sets cacheExpiry, marking cache as "valid"
     * 3. Second call: Skips DB query (cache valid), returns this.cachedParams (null)
     * 4. Throws: "Cannot read properties of null (reading 'parameters')"
     *
     * **Expected behavior:**
     * Both calls should return valid energy values (64,285 from fallback).
     *
     * **This test currently FAILS** - it will pass after fixing the caching bug.
     */
    it('should cache fallback values when database is empty', async () => {
        // Simulate empty database (first boot scenario)
        const mockFindOne = vi.mocked(UsdtParametersModel.findOne);
        mockFindOne.mockReturnValue({
            sort: vi.fn().mockReturnValue({
                lean: vi.fn().mockResolvedValue(null) // DB returns null
            })
        } as any);

        service = UsdtParametersService.getInstance();

        // First call - should use fallback
        const energy1 = await service.getStandardTransferEnergy();
        expect(energy1).toBe(64_285); // Fallback value

        // Second call within cache TTL (should NOT throw)
        // BUG: This currently throws TypeError because cachedParams is null
        const energy2 = await service.getStandardTransferEnergy();
        expect(energy2).toBe(64_285); // Should still return fallback value

        // Verify DB was only queried once (second call used cache)
        expect(mockFindOne).toHaveBeenCalledOnce();
    });

    /**
     * Test: Verifies first-time transfer energy also uses cached fallback.
     *
     * This ensures the bug affects both energy cost methods.
     */
    it('should cache fallback values for first-time transfers', async () => {
        const mockFindOne = vi.mocked(UsdtParametersModel.findOne);
        mockFindOne.mockReturnValue({
            sort: vi.fn().mockReturnValue({
                lean: vi.fn().mockResolvedValue(null)
            })
        } as any);

        service = UsdtParametersService.getInstance();

        // First call - should use fallback
        const energy1 = await service.getFirstTimeTransferEnergy();
        expect(energy1).toBe(128_570); // Fallback value (2x standard)

        // Second call - should use cached fallback
        const energy2 = await service.getFirstTimeTransferEnergy();
        expect(energy2).toBe(128_570);

        expect(mockFindOne).toHaveBeenCalledOnce();
    });

    /**
     * Test: Verifies getParameters() directly returns cached fallback.
     *
     * Tests the root cause method to ensure it properly caches fallback values.
     */
    it('should cache fallback parameters object', async () => {
        const mockFindOne = vi.mocked(UsdtParametersModel.findOne);
        mockFindOne.mockReturnValue({
            sort: vi.fn().mockReturnValue({
                lean: vi.fn().mockResolvedValue(null)
            })
        } as any);

        service = UsdtParametersService.getInstance();

        // First call - returns fallback
        const params1 = await service.getParameters();
        expect(params1).toBeDefined();
        expect(params1.parameters.standardTransferEnergy).toBe(64_285);

        // Second call - should return cached fallback (not null)
        const params2 = await service.getParameters();
        expect(params2).toBeDefined();
        expect(params2.parameters.standardTransferEnergy).toBe(64_285);

        expect(mockFindOne).toHaveBeenCalledOnce();
    });

    /**
     * Test: Database error should also cache fallback values.
     *
     * Verifies error path has same caching bug.
     */
    it('should cache fallback when database throws error', async () => {
        const mockFindOne = vi.mocked(UsdtParametersModel.findOne);
        mockFindOne.mockReturnValue({
            sort: vi.fn().mockReturnValue({
                lean: vi.fn().mockRejectedValue(new Error('DB connection failed'))
            })
        } as any);

        service = UsdtParametersService.getInstance();

        // First call - catches error, returns fallback
        const energy1 = await service.getStandardTransferEnergy();
        expect(energy1).toBe(64_285);

        // Second call - should use cached fallback
        const energy2 = await service.getStandardTransferEnergy();
        expect(energy2).toBe(64_285);

        expect(mockFindOne).toHaveBeenCalledOnce();
    });
});

describe('UsdtParametersService - Correct Behavior', () => {
    let service: UsdtParametersService;

    beforeEach(() => {
        (UsdtParametersService as any).instance = null;
        vi.clearAllMocks();
    });

    afterEach(() => {
        (UsdtParametersService as any).instance = null;
    });

    /**
     * Test: Normal operation when database has valid data.
     *
     * This should pass even with the bug (no fallback involved).
     */
    it('should cache valid database values', async () => {
        const mockParams = {
            network: 'mainnet',
            contractAddress: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
            parameters: {
                standardTransferEnergy: 65_000,
                firstTimeTransferEnergy: 130_000
            },
            fetchedAt: new Date(),
            createdAt: new Date()
        };

        const mockFindOne = vi.mocked(UsdtParametersModel.findOne);
        mockFindOne.mockReturnValue({
            sort: vi.fn().mockReturnValue({
                lean: vi.fn().mockResolvedValue(mockParams)
            })
        } as any);

        service = UsdtParametersService.getInstance();

        // First call - fetches from DB
        const energy1 = await service.getStandardTransferEnergy();
        expect(energy1).toBe(65_000);

        // Second call - uses cache
        const energy2 = await service.getStandardTransferEnergy();
        expect(energy2).toBe(65_000);

        // DB queried only once
        expect(mockFindOne).toHaveBeenCalledOnce();
    });

    /**
     * Test: Cache expiry causes DB re-query.
     *
     * Verifies cache TTL mechanism works correctly.
     */
    it('should re-query database after cache expires', async () => {
        const mockParams = {
            network: 'mainnet',
            contractAddress: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
            parameters: {
                standardTransferEnergy: 65_000,
                firstTimeTransferEnergy: 130_000
            },
            fetchedAt: new Date(),
            createdAt: new Date()
        };

        const mockFindOne = vi.mocked(UsdtParametersModel.findOne);
        mockFindOne.mockReturnValue({
            sort: vi.fn().mockReturnValue({
                lean: vi.fn().mockResolvedValue(mockParams)
            })
        } as any);

        service = UsdtParametersService.getInstance();

        // First call - fetches from DB
        await service.getStandardTransferEnergy();
        expect(mockFindOne).toHaveBeenCalledOnce();

        // Fast-forward time past cache TTL (1 minute = 60,000 ms)
        vi.useFakeTimers();
        vi.advanceTimersByTime(61_000); // 61 seconds

        // Second call - should re-query DB
        await service.getStandardTransferEnergy();
        expect(mockFindOne).toHaveBeenCalledTimes(2);

        vi.useRealTimers();
    });
});
