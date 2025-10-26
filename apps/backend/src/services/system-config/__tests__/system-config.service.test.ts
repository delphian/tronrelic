/// <reference types="vitest" />

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ISystemLogService, IDatabaseService } from '@tronrelic/types';
import { SystemConfigService } from '../system-config.service.js';

/**
 * Mock logger implementation for testing.
 *
 * Provides a complete ISystemLogService interface with spy functions to verify
 * that the service logs appropriate messages during operation.
 */
class MockLogger implements ISystemLogService {
    public level = 'info';
    public fatal = vi.fn();
    public error = vi.fn();
    public warn = vi.fn();
    public info = vi.fn();
    public debug = vi.fn();
    public trace = vi.fn();
    public child = vi.fn((_bindings: Record<string, unknown>): ISystemLogService => {
        return this;
    });

    // Additional ISystemLogService properties (not used in tests, so just return dummy values)
    public async initialize() {}
    public async saveLog() {}
    public async getLogs() { return { logs: [], total: 0, page: 1, limit: 50, totalPages: 0, hasNextPage: false, hasPrevPage: false }; }
    public async markAsResolved() {}
    public async cleanup() { return 0; }
    public async getStatistics() { return { total: 0, byLevel: {} as any, byService: {}, unresolved: 0 }; }
    public async getLogById() { return null; }
    public async markAsUnresolved() { return null; }
    public async deleteAllLogs() { return 0; }
    public async getStats() { return { total: 0, byLevel: {} as any, resolved: 0, unresolved: 0 }; }
}

/**
 * Mock database implementation for testing.
 */
class MockDatabase implements IDatabaseService {
    getCollection() { return {} as any; }
    registerModel() {}
    getModel() { return undefined; }
    async get() { return undefined; }
    async set() {}
    async delete() { return false; }
    async createIndex() {}
    async count() { return 0; }
    async find() { return []; }
    async findOne() { return null; }
    async insertOne() { return null; }
    async updateMany() { return 0; }
    async deleteMany() { return 0; }
}

describe('SystemConfigService', () => {
    let service: SystemConfigService;
    let mockLogger: MockLogger;
    let mockDatabase: MockDatabase;

    beforeEach(() => {
        // Clear all mocks before each test
        vi.clearAllMocks();

        // Create fresh mock logger and database
        mockLogger = new MockLogger();
        mockDatabase = new MockDatabase();

        // Reset singleton and initialize with mock logger and database
        (SystemConfigService as any).instance = undefined;
        SystemConfigService.initialize(mockLogger as any, mockDatabase);
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
            expect(() => SystemConfigService.initialize(mockLogger as any, mockDatabase)).toThrow(
                'SystemConfigService already initialized'
            );
        });
    });
});
