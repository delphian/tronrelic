/// <reference types="vitest" />

/**
 * UsdtParametersService Tests
 *
 * Tests for the USDT parameters service caching and error handling.
 *
 * **Why these tests matter:**
 * The service MUST throw errors when parameters are unavailable rather than using
 * arbitrary fallback values. These tests verify:
 * - Service throws errors when DB is empty (no fallback used)
 * - Service throws errors on database failures
 * - Valid parameters are cached correctly
 * - Cache expiry works as expected
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

describe('UsdtParametersService - Error Handling', () => {
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
     * Test: Service must throw error when database is empty (no fallback).
     *
     * **Expected behavior:**
     * Service throws error instead of returning arbitrary fallback values.
     * Using fallback values produces incorrect calculations.
     */
    it('should throw error when database is empty', async () => {
        // Simulate empty database (first boot scenario)
        const mockFindOne = vi.mocked(UsdtParametersModel.findOne);
        mockFindOne.mockReturnValue({
            sort: vi.fn().mockReturnValue({
                lean: vi.fn().mockResolvedValue(null) // DB returns null
            })
        } as any);

        service = UsdtParametersService.getInstance();

        // Should throw error (not return fallback)
        await expect(service.getStandardTransferEnergy()).rejects.toThrow(
            'No USDT parameters found in database'
        );
    });

    /**
     * Test: Service must throw error when database query fails.
     *
     * **Expected behavior:**
     * Database errors propagate as exceptions instead of silently using fallback values.
     */
    it('should throw error when database query fails', async () => {
        const mockFindOne = vi.mocked(UsdtParametersModel.findOne);
        mockFindOne.mockReturnValue({
            sort: vi.fn().mockReturnValue({
                lean: vi.fn().mockRejectedValue(new Error('DB connection failed'))
            })
        } as any);

        service = UsdtParametersService.getInstance();

        // Should throw database error (not return fallback)
        await expect(service.getStandardTransferEnergy()).rejects.toThrow('DB connection failed');
    });

    /**
     * Test: getParameters() throws error when no data available.
     *
     * Tests the root method to ensure it throws instead of using fallback.
     */
    it('should throw error from getParameters() when database is empty', async () => {
        const mockFindOne = vi.mocked(UsdtParametersModel.findOne);
        mockFindOne.mockReturnValue({
            sort: vi.fn().mockReturnValue({
                lean: vi.fn().mockResolvedValue(null)
            })
        } as any);

        service = UsdtParametersService.getInstance();

        // Should throw error
        await expect(service.getParameters()).rejects.toThrow(
            'No USDT parameters found in database'
        );
    });

    /**
     * Test: First-time transfer energy also throws error when data unavailable.
     */
    it('should throw error from getFirstTimeTransferEnergy() when database is empty', async () => {
        const mockFindOne = vi.mocked(UsdtParametersModel.findOne);
        mockFindOne.mockReturnValue({
            sort: vi.fn().mockReturnValue({
                lean: vi.fn().mockResolvedValue(null)
            })
        } as any);

        service = UsdtParametersService.getInstance();

        // Should throw error
        await expect(service.getFirstTimeTransferEnergy()).rejects.toThrow(
            'No USDT parameters found in database'
        );
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
     * Service should cache valid parameters and reuse them.
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

    /**
     * Test: First-time transfer energy uses cached parameters.
     */
    it('should return first-time transfer energy from cached parameters', async () => {
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
        const energy1 = await service.getFirstTimeTransferEnergy();
        expect(energy1).toBe(130_000);

        // Second call - uses cache
        const energy2 = await service.getFirstTimeTransferEnergy();
        expect(energy2).toBe(130_000);

        // DB queried only once
        expect(mockFindOne).toHaveBeenCalledOnce();
    });
});
