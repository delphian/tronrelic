/// <reference types="vitest" />

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { MigrationsController } from '../api/migrations.controller.js';
import type { IDatabaseService, ISystemLogService } from '@tronrelic/types';
import type { Request, Response } from 'express';

/**
 * Mock DatabaseService for controller instantiation.
 */
class MockDatabaseService implements Partial<IDatabaseService> {
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
    async initializeMigrations() {}
    async getMigrationsPending() { return []; }
    async getMigrationsCompleted() { return []; }
    async executeMigration() {}
    async executeMigrationsAll() {}
    isMigrationRunning() { return false; }
}

/**
 * Mock logger for testing.
 */
class MockLogger {
    public info = vi.fn();
    public error = vi.fn();
    public warn = vi.fn();
    public debug = vi.fn();
    public child = vi.fn(() => {
        const child = new MockLogger();
        return child as any;
    });
}

/**
 * Create mock Express request object.
 *
 * @param overrides - Partial request properties to override defaults
 * @returns Mock request object
 */
function createMockRequest(overrides: Partial<Request> = {}): Partial<Request> {
    return {
        query: {},
        params: {},
        body: {},
        ...overrides
    };
}

/**
 * Create mock Express response object with chainable methods.
 *
 * @returns Mock response object with spy functions
 */
function createMockResponse(): Partial<Response> {
    const res: any = {
        json: vi.fn().mockReturnThis(),
        status: vi.fn().mockReturnThis(),
        send: vi.fn().mockReturnThis()
    };
    return res;
}

// Mock the MigrationsService module
vi.mock('../services/migrations.service.js', () => ({
    MigrationsService: class {
        getStatus = vi.fn();
        getHistory = vi.fn();
        executeOne = vi.fn();
        executeAll = vi.fn();
        getMigrationDetails = vi.fn();
    }
}));

describe('MigrationsController', () => {
    let controller: MigrationsController;
    let mockDatabase: MockDatabaseService;
    let mockLogger: MockLogger;

    beforeEach(() => {
        mockDatabase = new MockDatabaseService();
        mockLogger = new MockLogger();

        controller = new MigrationsController(
            mockDatabase as any as IDatabaseService,
            mockLogger as any as ISystemLogService
        );
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    describe('getStatus', () => {
        /**
         * Test: getStatus should return migration system status.
         *
         * Verifies that the controller fetches status from the service
         * and returns it in the response.
         */
        it('should return migration system status', async () => {
            const mockStatus = {
                pending: [
                    { id: '001-add-indexes', name: 'Add user indexes' }
                ],
                completed: [
                    { id: '000-init', name: 'Initialize database', executedAt: '2024-01-01' }
                ],
                isRunning: false,
                totalPending: 1,
                totalCompleted: 1
            };

            const mockService = (controller as any).service;
            mockService.getStatus.mockResolvedValue(mockStatus);

            const req = createMockRequest();
            const res = createMockResponse();

            await controller.getStatus(req as Request, res as Response);

            expect(mockService.getStatus).toHaveBeenCalledOnce();
            expect(res.json).toHaveBeenCalledWith(mockStatus);
        });

        /**
         * Test: getStatus should handle service errors.
         *
         * Verifies that when the service throws an error, the controller
         * logs it and returns a 500 response.
         */
        it('should handle service errors', async () => {
            const error = new Error('Failed to read migrations');
            const mockService = (controller as any).service;
            mockService.getStatus.mockRejectedValue(error);

            const req = createMockRequest();
            const res = createMockResponse();

            await controller.getStatus(req as Request, res as Response);

            expect(mockLogger.error).toHaveBeenCalledWith(
                { error },
                'Failed to get migration status'
            );
            expect(res.status).toHaveBeenCalledWith(500);
            expect(res.json).toHaveBeenCalledWith({
                error: 'Failed to get migration status',
                message: 'Failed to read migrations'
            });
        });
    });

    describe('getHistory', () => {
        /**
         * Test: getHistory should return migration history with default limit.
         *
         * Verifies that when no query parameters are provided, the controller
         * uses the default limit of 100 and status filter of 'all'.
         */
        it('should return migration history with default limit', async () => {
            const mockHistory = [
                { id: '001-test', status: 'completed', executedAt: '2024-01-01', duration: 100 }
            ];

            const mockService = (controller as any).service;
            mockService.getHistory.mockResolvedValue(mockHistory);

            const req = createMockRequest();
            const res = createMockResponse();

            await controller.getHistory(req as Request, res as Response);

            expect(mockService.getHistory).toHaveBeenCalledWith(100, 'all');
            expect(res.json).toHaveBeenCalledWith({
                migrations: mockHistory,
                total: 1
            });
        });

        /**
         * Test: getHistory should return migration history with custom limit.
         *
         * Verifies that the limit query parameter is parsed and passed to the service.
         */
        it('should return migration history with custom limit', async () => {
            const mockService = (controller as any).service;
            mockService.getHistory.mockResolvedValue([]);

            const req = createMockRequest({
                query: { limit: '50' }
            });
            const res = createMockResponse();

            await controller.getHistory(req as Request, res as Response);

            expect(mockService.getHistory).toHaveBeenCalledWith(50, 'all');
        });

        /**
         * Test: getHistory should filter by status.
         *
         * Verifies that the status query parameter is passed to the service.
         */
        it('should filter by status', async () => {
            const mockService = (controller as any).service;
            mockService.getHistory.mockResolvedValue([]);

            const req = createMockRequest({
                query: { status: 'failed' }
            });
            const res = createMockResponse();

            await controller.getHistory(req as Request, res as Response);

            expect(mockService.getHistory).toHaveBeenCalledWith(100, 'failed');
        });

        /**
         * Test: getHistory should accept completed status filter.
         *
         * Verifies that 'completed' is a valid status filter value.
         */
        it('should accept completed status filter', async () => {
            const mockService = (controller as any).service;
            mockService.getHistory.mockResolvedValue([]);

            const req = createMockRequest({
                query: { status: 'completed', limit: '200' }
            });
            const res = createMockResponse();

            await controller.getHistory(req as Request, res as Response);

            expect(mockService.getHistory).toHaveBeenCalledWith(200, 'completed');
        });

        /**
         * Test: getHistory should handle service errors.
         *
         * Verifies that service errors are logged and returned as 500 responses.
         */
        it('should handle service errors', async () => {
            const error = new Error('Database connection failed');
            const mockService = (controller as any).service;
            mockService.getHistory.mockRejectedValue(error);

            const req = createMockRequest();
            const res = createMockResponse();

            await controller.getHistory(req as Request, res as Response);

            expect(mockLogger.error).toHaveBeenCalledWith(
                { error },
                'Failed to get migration history'
            );
            expect(res.status).toHaveBeenCalledWith(500);
            expect(res.json).toHaveBeenCalledWith({
                error: 'Failed to get migration history',
                message: 'Database connection failed'
            });
        });
    });

    describe('execute', () => {
        /**
         * Test: execute should execute single migration.
         *
         * Verifies that when a migration ID is provided, the controller
         * executes that specific migration.
         */
        it('should execute single migration', async () => {
            const mockResult = {
                success: true,
                migrationId: '001-test',
                duration: 150
            };

            const mockService = (controller as any).service;
            mockService.executeOne.mockResolvedValue(mockResult);

            const req = createMockRequest({
                body: { migrationId: '001-test' }
            });
            const res = createMockResponse();

            await controller.execute(req as Request, res as Response);

            expect(mockService.executeOne).toHaveBeenCalledWith('001-test');
            expect(res.json).toHaveBeenCalledWith(mockResult);
        });

        /**
         * Test: execute should execute all pending migrations.
         *
         * Verifies that when no migration ID is provided, the controller
         * executes all pending migrations.
         */
        it('should execute all pending migrations', async () => {
            const mockResult = {
                success: true,
                executed: ['001-test', '002-test'],
                totalDuration: 300
            };

            const mockService = (controller as any).service;
            mockService.executeAll.mockResolvedValue(mockResult);

            const req = createMockRequest({
                body: {} // No migrationId
            });
            const res = createMockResponse();

            await controller.execute(req as Request, res as Response);

            expect(mockService.executeAll).toHaveBeenCalledOnce();
            expect(res.json).toHaveBeenCalledWith(mockResult);
        });

        /**
         * Test: execute should handle execution errors.
         *
         * Verifies that migration execution errors are logged and returned
         * as 500 responses.
         */
        it('should handle execution errors', async () => {
            const error = new Error('Migration execution failed');
            const mockService = (controller as any).service;
            mockService.executeOne.mockRejectedValue(error);

            const req = createMockRequest({
                body: { migrationId: '001-test' }
            });
            const res = createMockResponse();

            await controller.execute(req as Request, res as Response);

            expect(mockLogger.error).toHaveBeenCalledWith(
                { error, body: { migrationId: '001-test' } },
                'Failed to execute migration'
            );
            expect(res.status).toHaveBeenCalledWith(500);
            expect(res.json).toHaveBeenCalledWith({
                error: 'Failed to execute migration',
                message: 'Migration execution failed'
            });
        });
    });

    describe('getDetails', () => {
        /**
         * Test: getDetails should return migration details.
         *
         * Verifies that the controller fetches details for a specific migration
         * by its ID from the URL parameters.
         */
        it('should return migration details', async () => {
            const mockDetails = {
                id: '001-test',
                name: 'Test Migration',
                status: 'completed',
                executedAt: '2024-01-01',
                duration: 100,
                dependencies: []
            };

            const mockService = (controller as any).service;
            mockService.getMigrationDetails.mockResolvedValue(mockDetails);

            const req = createMockRequest({
                params: { id: '001-test' }
            });
            const res = createMockResponse();

            await controller.getDetails(req as Request, res as Response);

            expect(mockService.getMigrationDetails).toHaveBeenCalledWith('001-test');
            expect(res.json).toHaveBeenCalledWith(mockDetails);
        });

        /**
         * Test: getDetails should return 404 for non-existent migration.
         *
         * Verifies that when a migration ID is not found, the controller
         * returns a 404 status.
         */
        it('should return 404 for non-existent migration', async () => {
            const error = new Error('Migration not found: nonexistent');
            const mockService = (controller as any).service;
            mockService.getMigrationDetails.mockRejectedValue(error);

            const req = createMockRequest({
                params: { id: 'nonexistent' }
            });
            const res = createMockResponse();

            await controller.getDetails(req as Request, res as Response);

            expect(res.status).toHaveBeenCalledWith(404);
            expect(res.json).toHaveBeenCalledWith({
                error: 'Migration not found',
                message: 'Migration not found: nonexistent'
            });
        });

        /**
         * Test: getDetails should handle service errors.
         *
         * Verifies that service errors are logged and returned as 500 responses.
         */
        it('should handle service errors', async () => {
            const error = new Error('Database read failed');
            const mockService = (controller as any).service;
            mockService.getMigrationDetails.mockRejectedValue(error);

            const req = createMockRequest({
                params: { id: '001-test' }
            });
            const res = createMockResponse();

            await controller.getDetails(req as Request, res as Response);

            expect(mockLogger.error).toHaveBeenCalledWith(
                { error, migrationId: '001-test' },
                'Failed to get migration details'
            );
            expect(res.status).toHaveBeenCalledWith(500);
            expect(res.json).toHaveBeenCalledWith({
                error: 'Failed to get migration details',
                message: 'Database read failed'
            });
        });
    });
});
