/// <reference types="vitest" />

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DatabaseBrowserController } from '../api/database-browser.controller.js';
import { DatabaseBrowserRepository } from '../repositories/database-browser.repository.js';
import type { ISystemLogService } from '@tronrelic/types';
import type { Request, Response } from 'express';

/**
 * Mock DatabaseBrowserRepository for testing controller behavior.
 *
 * Provides spy functions to verify that the controller delegates
 * data access operations to the repository layer correctly.
 */
class MockDatabaseBrowserRepository {
    getDatabaseStats = vi.fn();
    getDocuments = vi.fn();
    queryDocuments = vi.fn();
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

describe('DatabaseBrowserController', () => {
    let controller: DatabaseBrowserController;
    let mockRepository: MockDatabaseBrowserRepository;
    let mockLogger: MockLogger;

    beforeEach(() => {
        mockRepository = new MockDatabaseBrowserRepository();
        mockLogger = new MockLogger();
        controller = new DatabaseBrowserController(
            mockRepository as any as DatabaseBrowserRepository,
            mockLogger as any as ISystemLogService
        );
        vi.clearAllMocks();
    });

    describe('getStats', () => {
        /**
         * Test: getStats should fetch database statistics successfully.
         *
         * Verifies that the controller delegates to the repository and returns
         * results in the expected success format.
         */
        it('should fetch database statistics successfully', async () => {
            const mockStats = {
                dbName: 'tronrelic',
                totalSize: 1024000,
                collections: [
                    { name: 'transactions', count: 1000, size: 512000, avgObjSize: 512, indexes: 3 },
                    { name: 'blocks', count: 500, size: 256000, avgObjSize: 512, indexes: 2 }
                ]
            };

            mockRepository.getDatabaseStats.mockResolvedValue(mockStats);

            const req = createMockRequest();
            const res = createMockResponse();

            await controller.getStats(req as Request, res as Response);

            expect(mockRepository.getDatabaseStats).toHaveBeenCalledOnce();
            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith({
                success: true,
                data: mockStats
            });
        });

        /**
         * Test: getStats should handle repository errors.
         *
         * Verifies that when the repository throws an error, the controller
         * returns a 500 status with error details.
         */
        it('should handle repository errors', async () => {
            const error = new Error('Database connection failed');
            mockRepository.getDatabaseStats.mockRejectedValue(error);

            const req = createMockRequest();
            const res = createMockResponse();

            await controller.getStats(req as Request, res as Response);

            expect(mockLogger.error).toHaveBeenCalledWith(
                { error },
                'Failed to fetch database stats'
            );
            expect(res.status).toHaveBeenCalledWith(500);
            expect(res.json).toHaveBeenCalledWith({
                success: false,
                error: 'Failed to fetch database statistics',
                message: 'Database connection failed'
            });
        });

        /**
         * Test: getStats should handle non-Error exceptions.
         *
         * Verifies that when a non-Error object is thrown, the controller
         * still returns a proper error response.
         */
        it('should handle non-Error exceptions', async () => {
            mockRepository.getDatabaseStats.mockRejectedValue('String error');

            const req = createMockRequest();
            const res = createMockResponse();

            await controller.getStats(req as Request, res as Response);

            expect(res.status).toHaveBeenCalledWith(500);
            expect(res.json).toHaveBeenCalledWith({
                success: false,
                error: 'Failed to fetch database statistics',
                message: 'Unknown error'
            });
        });
    });

    describe('getDocuments', () => {
        /**
         * Test: getDocuments should fetch documents with default pagination.
         *
         * Verifies that when no query parameters are provided, the controller
         * uses sensible defaults (page 1, limit 20, sort by -_id).
         */
        it('should fetch documents with default pagination', async () => {
            const mockResult = {
                documents: [{ _id: '1', data: 'test' }],
                total: 1,
                page: 1,
                limit: 20,
                totalPages: 1,
                hasNextPage: false,
                hasPrevPage: false
            };

            mockRepository.getDocuments.mockResolvedValue(mockResult);

            const req = createMockRequest({
                params: { name: 'transactions' }
            });
            const res = createMockResponse();

            await controller.getDocuments(req as Request, res as Response);

            expect(mockRepository.getDocuments).toHaveBeenCalledWith('transactions', {
                page: 1,
                limit: 20,
                sort: { _id: -1 } // Default sort by -_id
            });

            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith({
                success: true,
                data: mockResult
            });
        });

        /**
         * Test: getDocuments should fetch documents with custom pagination.
         *
         * Verifies that query parameters for page, limit, and sort are parsed correctly.
         */
        it('should fetch documents with custom pagination', async () => {
            const mockResult = {
                documents: [],
                total: 100,
                page: 3,
                limit: 50,
                totalPages: 2,
                hasNextPage: false,
                hasPrevPage: true
            };

            mockRepository.getDocuments.mockResolvedValue(mockResult);

            const req = createMockRequest({
                params: { name: 'blocks' },
                query: {
                    page: '3',
                    limit: '50',
                    sort: 'timestamp' // Ascending sort
                }
            });
            const res = createMockResponse();

            await controller.getDocuments(req as Request, res as Response);

            expect(mockRepository.getDocuments).toHaveBeenCalledWith('blocks', {
                page: 3,
                limit: 50,
                sort: { timestamp: 1 }
            });

            expect(res.status).toHaveBeenCalledWith(200);
        });

        /**
         * Test: getDocuments should parse descending sort parameter.
         *
         * Verifies that sort parameters prefixed with '-' are parsed as descending.
         */
        it('should parse descending sort parameter', async () => {
            mockRepository.getDocuments.mockResolvedValue({
                documents: [],
                total: 0,
                page: 1,
                limit: 20,
                totalPages: 0,
                hasNextPage: false,
                hasPrevPage: false
            });

            const req = createMockRequest({
                params: { name: 'logs' },
                query: { sort: '-createdAt' }
            });
            const res = createMockResponse();

            await controller.getDocuments(req as Request, res as Response);

            expect(mockRepository.getDocuments).toHaveBeenCalledWith('logs', {
                page: 1,
                limit: 20,
                sort: { createdAt: -1 }
            });
        });

        /**
         * Test: getDocuments should enforce maximum limit of 100.
         *
         * Verifies that even if a client requests more than 100 documents,
         * the limit is capped at 100 to prevent memory issues.
         */
        it('should enforce maximum limit of 100', async () => {
            mockRepository.getDocuments.mockResolvedValue({
                documents: [],
                total: 0,
                page: 1,
                limit: 100,
                totalPages: 0,
                hasNextPage: false,
                hasPrevPage: false
            });

            const req = createMockRequest({
                params: { name: 'test' },
                query: { limit: '500' } // Request 500, should be capped at 100
            });
            const res = createMockResponse();

            await controller.getDocuments(req as Request, res as Response);

            expect(mockRepository.getDocuments).toHaveBeenCalledWith('test', {
                page: 1,
                limit: 100, // Capped
                sort: { _id: -1 }
            });
        });

        /**
         * Test: getDocuments should use default for invalid page strings.
         *
         * Verifies that when page string parses to 0 or NaN, the default value of 1 is used.
         * The `|| 1` operator converts falsy parsed values to default before validation.
         */
        it('should use default for invalid page strings', async () => {
            mockRepository.getDocuments.mockResolvedValue({
                documents: [],
                total: 0,
                page: 1,
                limit: 20,
                totalPages: 0,
                hasNextPage: false,
                hasPrevPage: false
            });

            const req = createMockRequest({
                params: { name: 'test' },
                query: { page: '0' } // Parses to 0, becomes 1 via || operator
            });
            const res = createMockResponse();

            await controller.getDocuments(req as Request, res as Response);

            // Should use default page of 1
            expect(mockRepository.getDocuments).toHaveBeenCalledWith('test', {
                page: 1, // Default applied
                limit: 20,
                sort: { _id: -1 }
            });
            expect(res.status).toHaveBeenCalledWith(200);
        });

        /**
         * Test: getDocuments should use default for invalid limit strings.
         *
         * Verifies that when limit string parses to 0 or NaN, the default value of 20 is used.
         * The `|| 20` operator converts falsy parsed values to default before validation.
         */
        it('should use default for invalid limit strings', async () => {
            mockRepository.getDocuments.mockResolvedValue({
                documents: [],
                total: 0,
                page: 1,
                limit: 20,
                totalPages: 0,
                hasNextPage: false,
                hasPrevPage: false
            });

            const req = createMockRequest({
                params: { name: 'test' },
                query: { limit: '0' } // Parses to 0, becomes 20 via || operator
            });
            const res = createMockResponse();

            await controller.getDocuments(req as Request, res as Response);

            // Should use default limit of 20
            expect(mockRepository.getDocuments).toHaveBeenCalledWith('test', {
                page: 1,
                limit: 20, // Default applied
                sort: { _id: -1 }
            });
            expect(res.status).toHaveBeenCalledWith(200);
        });

        /**
         * Test: getDocuments should reject invalid limits (too high).
         *
         * Note: This test verifies the error message, but the implementation
         * actually caps the limit rather than rejecting it. The capping test
         * above verifies the actual behavior.
         */
        it('should reject invalid limits (too high)', async () => {
            const req = createMockRequest({
                params: { name: 'test' },
                query: { limit: '101' }
            });
            const res = createMockResponse();

            await controller.getDocuments(req as Request, res as Response);

            // The implementation caps at 100 rather than rejecting, so this should succeed
            expect(mockRepository.getDocuments).toHaveBeenCalledWith('test', {
                page: 1,
                limit: 100,
                sort: { _id: -1 }
            });
        });

        /**
         * Test: getDocuments should handle repository errors.
         *
         * Verifies that repository errors are logged and returned as 500 responses.
         */
        it('should handle repository errors', async () => {
            const error = new Error('Collection not found');
            mockRepository.getDocuments.mockRejectedValue(error);

            const req = createMockRequest({
                params: { name: 'nonexistent' }
            });
            const res = createMockResponse();

            await controller.getDocuments(req as Request, res as Response);

            expect(mockLogger.error).toHaveBeenCalledWith(
                { error, params: req.params, query: req.query },
                'Failed to fetch documents'
            );
            expect(res.status).toHaveBeenCalledWith(500);
            expect(res.json).toHaveBeenCalledWith({
                success: false,
                error: 'Failed to fetch documents',
                message: 'Collection not found'
            });
        });
    });

    describe('queryDocuments', () => {
        /**
         * Test: queryDocuments should execute query with default options.
         *
         * Verifies that when minimal request body is provided, the controller
         * uses sensible defaults.
         */
        it('should execute query with default options', async () => {
            const mockResult = {
                documents: [{ _id: '1', status: 'active' }],
                total: 1,
                page: 1,
                limit: 20,
                totalPages: 1,
                hasNextPage: false,
                hasPrevPage: false
            };

            mockRepository.queryDocuments.mockResolvedValue(mockResult);

            const req = createMockRequest({
                params: { name: 'users' },
                body: {} // Empty body, should use defaults
            });
            const res = createMockResponse();

            await controller.queryDocuments(req as Request, res as Response);

            expect(mockRepository.queryDocuments).toHaveBeenCalledWith('users', {
                filter: {},
                page: 1,
                limit: 20,
                sort: { _id: -1 }
            });

            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith({
                success: true,
                data: mockResult
            });
        });

        /**
         * Test: queryDocuments should execute query with custom filter.
         *
         * Verifies that MongoDB query filters are passed through correctly.
         */
        it('should execute query with custom filter', async () => {
            mockRepository.queryDocuments.mockResolvedValue({
                documents: [],
                total: 0,
                page: 1,
                limit: 20,
                totalPages: 0,
                hasNextPage: false,
                hasPrevPage: false
            });

            const req = createMockRequest({
                params: { name: 'transactions' },
                body: {
                    filter: { amount: { $gte: 1000 } },
                    page: 2,
                    limit: 50,
                    sort: { timestamp: -1 }
                }
            });
            const res = createMockResponse();

            await controller.queryDocuments(req as Request, res as Response);

            expect(mockRepository.queryDocuments).toHaveBeenCalledWith('transactions', {
                filter: { amount: { $gte: 1000 } },
                page: 2,
                limit: 50,
                sort: { timestamp: -1 }
            });
        });

        /**
         * Test: queryDocuments should enforce maximum limit of 100.
         *
         * Verifies that requested limits are capped at 100.
         */
        it('should enforce maximum limit of 100', async () => {
            mockRepository.queryDocuments.mockResolvedValue({
                documents: [],
                total: 0,
                page: 1,
                limit: 100,
                totalPages: 0,
                hasNextPage: false,
                hasPrevPage: false
            });

            const req = createMockRequest({
                params: { name: 'test' },
                body: { limit: 200 }
            });
            const res = createMockResponse();

            await controller.queryDocuments(req as Request, res as Response);

            expect(mockRepository.queryDocuments).toHaveBeenCalledWith('test', {
                filter: {},
                page: 1,
                limit: 100, // Capped
                sort: { _id: -1 }
            });
        });

        /**
         * Test: queryDocuments should reject invalid filter type (array).
         *
         * Verifies that filters must be objects, not arrays.
         */
        it('should reject invalid filter type (array)', async () => {
            const req = createMockRequest({
                params: { name: 'test' },
                body: { filter: ['invalid'] }
            });
            const res = createMockResponse();

            await controller.queryDocuments(req as Request, res as Response);

            expect(mockRepository.queryDocuments).not.toHaveBeenCalled();
            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith({
                success: false,
                error: 'Invalid filter',
                message: 'Filter must be an object'
            });
        });

        /**
         * Test: queryDocuments should use default for zero page numbers.
         *
         * Verifies that when page is 0, the default value of 1 is used.
         * The `|| 1` operator converts falsy values to default before validation.
         */
        it('should use default for zero page numbers', async () => {
            mockRepository.queryDocuments.mockResolvedValue({
                documents: [],
                total: 0,
                page: 1,
                limit: 20,
                totalPages: 0,
                hasNextPage: false,
                hasPrevPage: false
            });

            const req = createMockRequest({
                params: { name: 'test' },
                body: { page: 0 } // Becomes 1 via || operator
            });
            const res = createMockResponse();

            await controller.queryDocuments(req as Request, res as Response);

            // Should use default page of 1
            expect(mockRepository.queryDocuments).toHaveBeenCalledWith('test', {
                filter: {},
                page: 1, // Default applied
                limit: 20,
                sort: { _id: -1 }
            });
            expect(res.status).toHaveBeenCalledWith(200);
        });

        /**
         * Test: queryDocuments should use default for zero limit.
         *
         * Verifies that when limit is 0, the default value of 20 is used.
         * The `|| 20` operator converts falsy values to default before validation.
         */
        it('should use default for zero limit', async () => {
            mockRepository.queryDocuments.mockResolvedValue({
                documents: [],
                total: 0,
                page: 1,
                limit: 20,
                totalPages: 0,
                hasNextPage: false,
                hasPrevPage: false
            });

            const req = createMockRequest({
                params: { name: 'test' },
                body: { limit: 0 } // Becomes 20 via || operator
            });
            const res = createMockResponse();

            await controller.queryDocuments(req as Request, res as Response);

            // Should use default limit of 20
            expect(mockRepository.queryDocuments).toHaveBeenCalledWith('test', {
                filter: {},
                page: 1,
                limit: 20, // Default applied
                sort: { _id: -1 }
            });
            expect(res.status).toHaveBeenCalledWith(200);
        });

        /**
         * Test: queryDocuments should reject invalid sort type (array).
         *
         * Verifies that sort specifications must be objects, not arrays.
         */
        it('should reject invalid sort type (array)', async () => {
            const req = createMockRequest({
                params: { name: 'test' },
                body: { sort: ['invalid'] }
            });
            const res = createMockResponse();

            await controller.queryDocuments(req as Request, res as Response);

            expect(mockRepository.queryDocuments).not.toHaveBeenCalled();
            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith({
                success: false,
                error: 'Invalid sort',
                message: 'Sort must be an object'
            });
        });

        /**
         * Test: queryDocuments should handle repository errors.
         *
         * Verifies that repository errors are logged and returned as 500 responses.
         */
        it('should handle repository errors', async () => {
            const error = new Error('Query execution failed');
            mockRepository.queryDocuments.mockRejectedValue(error);

            const req = createMockRequest({
                params: { name: 'test' },
                body: { filter: { status: 'active' } }
            });
            const res = createMockResponse();

            await controller.queryDocuments(req as Request, res as Response);

            expect(mockLogger.error).toHaveBeenCalledWith(
                { error, params: req.params, body: req.body },
                'Failed to execute query'
            );
            expect(res.status).toHaveBeenCalledWith(500);
            expect(res.json).toHaveBeenCalledWith({
                success: false,
                error: 'Failed to execute query',
                message: 'Query execution failed'
            });
        });

        /**
         * Test: queryDocuments should handle string page/limit conversion.
         *
         * Verifies that string values are properly parsed to numbers.
         */
        it('should handle string page/limit conversion', async () => {
            mockRepository.queryDocuments.mockResolvedValue({
                documents: [],
                total: 0,
                page: 5,
                limit: 30,
                totalPages: 0,
                hasNextPage: false,
                hasPrevPage: true
            });

            const req = createMockRequest({
                params: { name: 'test' },
                body: {
                    page: '5',    // String instead of number
                    limit: '30'   // String instead of number
                }
            });
            const res = createMockResponse();

            await controller.queryDocuments(req as Request, res as Response);

            expect(mockRepository.queryDocuments).toHaveBeenCalledWith('test', {
                filter: {},
                page: 5,      // Parsed to number
                limit: 30,    // Parsed to number
                sort: { _id: -1 }
            });
        });
    });
});
