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
 *
 * **Database Access Pattern:**
 * The service uses IDatabaseService for all MongoDB operations. Tests mock
 * the database service rather than the Mongoose model directly.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { UsdtParametersService } from '../usdt-parameters.service.js';
import type { IDatabaseService } from '@tronrelic/types';

// Mock the logger (follows pattern from migration tests)
vi.mock('../../../lib/logger.js', () => ({
    logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
    }
}));

/**
 * Create a mock IDatabaseService with configurable model behavior.
 *
 * @param modelMock - Mock implementation for getModel().findOne()
 * @returns Mock IDatabaseService
 */
function createMockDatabase(modelMock: any): IDatabaseService {
    return {
        registerModel: vi.fn(),
        getModel: vi.fn().mockReturnValue(modelMock),
        getCollection: vi.fn(),
        find: vi.fn(),
        findOne: vi.fn(),
        create: vi.fn(),
        updateMany: vi.fn(),
        deleteMany: vi.fn(),
        countDocuments: vi.fn()
    } as unknown as IDatabaseService;
}

/**
 * Create a chainable mock for Mongoose model.findOne().sort().lean() pattern.
 *
 * @param resolvedValue - Value to resolve from lean()
 * @returns Mock with chainable sort() and lean() methods
 */
function createChainableFindOneMock(resolvedValue: any) {
    return {
        findOne: vi.fn().mockReturnValue({
            sort: vi.fn().mockReturnValue({
                lean: vi.fn().mockResolvedValue(resolvedValue),
                select: vi.fn().mockReturnValue({
                    lean: vi.fn().mockResolvedValue(resolvedValue)
                })
            })
        })
    };
}

/**
 * Create a chainable mock that rejects with an error.
 *
 * @param error - Error to reject with
 * @returns Mock with chainable methods that reject
 */
function createChainableFindOneErrorMock(error: Error) {
    return {
        findOne: vi.fn().mockReturnValue({
            sort: vi.fn().mockReturnValue({
                lean: vi.fn().mockRejectedValue(error)
            })
        })
    };
}

describe('UsdtParametersService - Error Handling', () => {
    beforeEach(() => {
        // Reset singleton instance and database before each test
        (UsdtParametersService as any).instance = null;
        (UsdtParametersService as any).database = null;
        vi.clearAllMocks();
    });

    afterEach(() => {
        // Clean up singleton after tests
        (UsdtParametersService as any).instance = null;
        (UsdtParametersService as any).database = null;
    });

    /**
     * Test: Service must throw error when database is empty (no fallback).
     *
     * **Expected behavior:**
     * Service throws error instead of returning arbitrary fallback values.
     * Using fallback values produces incorrect calculations.
     */
    it('should throw error when database is empty', async () => {
        // Create mock that returns null (empty database)
        const modelMock = createChainableFindOneMock(null);
        const mockDatabase = createMockDatabase(modelMock);

        // Initialize service with mock database
        UsdtParametersService.setDependencies(mockDatabase);
        const service = UsdtParametersService.getInstance();

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
        // Create mock that rejects with error
        const modelMock = createChainableFindOneErrorMock(new Error('DB connection failed'));
        const mockDatabase = createMockDatabase(modelMock);

        // Initialize service with mock database
        UsdtParametersService.setDependencies(mockDatabase);
        const service = UsdtParametersService.getInstance();

        // Should throw database error (not return fallback)
        await expect(service.getStandardTransferEnergy()).rejects.toThrow('DB connection failed');
    });

    /**
     * Test: getParameters() throws error when no data available.
     *
     * Tests the root method to ensure it throws instead of using fallback.
     */
    it('should throw error from getParameters() when database is empty', async () => {
        const modelMock = createChainableFindOneMock(null);
        const mockDatabase = createMockDatabase(modelMock);

        UsdtParametersService.setDependencies(mockDatabase);
        const service = UsdtParametersService.getInstance();

        // Should throw error
        await expect(service.getParameters()).rejects.toThrow(
            'No USDT parameters found in database'
        );
    });

    /**
     * Test: First-time transfer energy also throws error when data unavailable.
     */
    it('should throw error from getFirstTimeTransferEnergy() when database is empty', async () => {
        const modelMock = createChainableFindOneMock(null);
        const mockDatabase = createMockDatabase(modelMock);

        UsdtParametersService.setDependencies(mockDatabase);
        const service = UsdtParametersService.getInstance();

        // Should throw error
        await expect(service.getFirstTimeTransferEnergy()).rejects.toThrow(
            'No USDT parameters found in database'
        );
    });
});

describe('UsdtParametersService - Correct Behavior', () => {
    beforeEach(() => {
        (UsdtParametersService as any).instance = null;
        (UsdtParametersService as any).database = null;
        vi.clearAllMocks();
    });

    afterEach(() => {
        (UsdtParametersService as any).instance = null;
        (UsdtParametersService as any).database = null;
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

        const modelMock = createChainableFindOneMock(mockParams);
        const mockDatabase = createMockDatabase(modelMock);

        UsdtParametersService.setDependencies(mockDatabase);
        const service = UsdtParametersService.getInstance();

        // First call - fetches from DB
        const energy1 = await service.getStandardTransferEnergy();
        expect(energy1).toBe(65_000);

        // Second call - uses cache
        const energy2 = await service.getStandardTransferEnergy();
        expect(energy2).toBe(65_000);

        // DB queried only once (model.findOne called once)
        expect(modelMock.findOne).toHaveBeenCalledOnce();
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

        const modelMock = createChainableFindOneMock(mockParams);
        const mockDatabase = createMockDatabase(modelMock);

        UsdtParametersService.setDependencies(mockDatabase);
        const service = UsdtParametersService.getInstance();

        // First call - fetches from DB
        await service.getStandardTransferEnergy();
        expect(modelMock.findOne).toHaveBeenCalledOnce();

        // Fast-forward time past cache TTL (1 minute = 60,000 ms)
        vi.useFakeTimers();
        vi.advanceTimersByTime(61_000); // 61 seconds

        // Second call - should re-query DB
        await service.getStandardTransferEnergy();
        expect(modelMock.findOne).toHaveBeenCalledTimes(2);

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

        const modelMock = createChainableFindOneMock(mockParams);
        const mockDatabase = createMockDatabase(modelMock);

        UsdtParametersService.setDependencies(mockDatabase);
        const service = UsdtParametersService.getInstance();

        // First call - fetches from DB
        const energy1 = await service.getFirstTimeTransferEnergy();
        expect(energy1).toBe(130_000);

        // Second call - uses cache
        const energy2 = await service.getFirstTimeTransferEnergy();
        expect(energy2).toBe(130_000);

        // DB queried only once
        expect(modelMock.findOne).toHaveBeenCalledOnce();
    });
});
