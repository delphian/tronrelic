/// <reference types="vitest" />

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ILogger } from '@tronrelic/types';
import { SystemConfigService } from '../system-config.service.js';

/**
 * Mock logger implementation for testing.
 *
 * Provides a complete ILogger interface with spy functions to verify
 * that the service logs appropriate messages during operation.
 */
class MockLogger implements ILogger {
    public fatal = vi.fn();
    public error = vi.fn();
    public warn = vi.fn();
    public info = vi.fn();
    public debug = vi.fn();
    public trace = vi.fn();
    public child = vi.fn((_bindings: Record<string, unknown>, _options?: Record<string, unknown>): ILogger => {
        return this;
    });
}

describe('SystemConfigService', () => {
    let service: SystemConfigService;
    let mockLogger: MockLogger;

    beforeEach(() => {
        // Clear all mocks before each test
        vi.clearAllMocks();

        // Create fresh mock logger
        mockLogger = new MockLogger();

        // Reset singleton and initialize with mock logger
        (SystemConfigService as any).instance = undefined;
        SystemConfigService.initialize(mockLogger);
        service = SystemConfigService.getInstance();
    });

    afterEach(() => {
        // Reset singleton after each test
        (SystemConfigService as any).instance = undefined;
    });

    describe('Singleton Pattern', () => {
        /**
         * Test: SystemConfigService should create singleton instance on initialize.
         *
         * Verifies that initialize() creates a new instance and stores it as the singleton.
         */
        it('should create singleton instance on initialize', () => {
            expect(service).toBeInstanceOf(SystemConfigService);
        });

        /**
         * Test: SystemConfigService should return same instance on subsequent getInstance calls.
         *
         * Verifies that getInstance() always returns the same singleton instance
         * after initialization, ensuring consistent state across the application.
         */
        it('should return same instance on subsequent getInstance calls', () => {
            const instance1 = SystemConfigService.getInstance();
            const instance2 = SystemConfigService.getInstance();
            expect(instance1).toBe(instance2);
            expect(instance1).toBe(service);
        });

        /**
         * Test: SystemConfigService should throw error if getInstance called before initialize.
         *
         * Verifies that calling getInstance() before initialize() throws a clear error
         * guiding developers to call initialize() first during application bootstrap.
         */
        it('should throw error if getInstance called before initialize', () => {
            (SystemConfigService as any).instance = undefined;
            expect(() => SystemConfigService.getInstance()).toThrow(
                'SystemConfigService not initialized. Call initialize() first in bootstrap.'
            );
        });

        /**
         * Test: SystemConfigService should throw error if initialized twice.
         *
         * Verifies that calling initialize() multiple times throws an error
         * to prevent accidental re-initialization and loss of cached state.
         */
        it('should throw error if initialized twice', () => {
            expect(() => SystemConfigService.initialize(mockLogger)).toThrow(
                'SystemConfigService already initialized'
            );
        });
    });
});
