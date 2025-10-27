/// <reference types="vitest" />

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SystemLogController } from '../api/system-log.controller.js';
import type { ISystemLogService } from '@tronrelic/types';
import type { Request, Response, NextFunction } from 'express';

/**
 * Mock SystemLogService for testing controller behavior.
 *
 * Provides spy functions to verify that the controller delegates
 * business logic to the service layer correctly.
 */
class MockSystemLogService implements Partial<ISystemLogService> {
    getLogs = vi.fn();
    getStats = vi.fn();
    getLogById = vi.fn();
    markAsResolved = vi.fn();
    markAsUnresolved = vi.fn();
    deleteAllLogs = vi.fn();
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

/**
 * Create mock Express next function.
 *
 * @returns Mock next function
 */
function createMockNext(): NextFunction {
    return vi.fn() as any;
}

describe('SystemLogController', () => {
    let controller: SystemLogController;
    let mockService: MockSystemLogService;

    beforeEach(() => {
        mockService = new MockSystemLogService();
        controller = new SystemLogController(mockService as any);
        vi.clearAllMocks();
    });

    describe('getLogs', () => {
        /**
         * Test: getLogs should fetch logs with query parameters.
         *
         * Verifies that the controller parses query parameters and delegates
         * to the service, then returns results in the expected format.
         */
        it('should fetch logs with query parameters', async () => {
            const mockLogs = {
                logs: [{ _id: '1', level: 'error', message: 'Test' }],
                total: 1,
                page: 1,
                limit: 50,
                totalPages: 1,
                hasNextPage: false,
                hasPrevPage: false
            };

            mockService.getLogs.mockResolvedValue(mockLogs);

            const req = createMockRequest({
                query: {
                    levels: ['error', 'warn'],
                    service: 'tronrelic',
                    page: '2',
                    limit: '25'
                }
            });
            const res = createMockResponse();
            const next = createMockNext();

            await controller.getLogs(req as Request, res as Response, next);

            expect(mockService.getLogs).toHaveBeenCalledWith({
                levels: ['error', 'warn'],
                service: 'tronrelic',
                page: 2,
                limit: 25
            });

            expect(res.json).toHaveBeenCalledWith({
                success: true,
                ...mockLogs
            });

            expect(next).not.toHaveBeenCalled();
        });

        /**
         * Test: getLogs should parse single level as array.
         *
         * Verifies that when a single level is provided (not an array),
         * it's converted to an array before passing to the service.
         */
        it('should parse single level as array', async () => {
            mockService.getLogs.mockResolvedValue({
                logs: [],
                total: 0,
                page: 1,
                limit: 50,
                totalPages: 0,
                hasNextPage: false,
                hasPrevPage: false
            });

            const req = createMockRequest({
                query: { levels: 'error' } // Single string, not array
            });
            const res = createMockResponse();
            const next = createMockNext();

            await controller.getLogs(req as Request, res as Response, next);

            expect(mockService.getLogs).toHaveBeenCalledWith({
                levels: ['error']
            });
        });

        /**
         * Test: getLogs should parse resolved boolean.
         *
         * Verifies that the 'resolved' query parameter is correctly
         * converted from string to boolean.
         */
        it('should parse resolved boolean', async () => {
            mockService.getLogs.mockResolvedValue({
                logs: [],
                total: 0,
                page: 1,
                limit: 50,
                totalPages: 0,
                hasNextPage: false,
                hasPrevPage: false
            });

            const req = createMockRequest({
                query: { resolved: 'true' }
            });
            const res = createMockResponse();
            const next = createMockNext();

            await controller.getLogs(req as Request, res as Response, next);

            expect(mockService.getLogs).toHaveBeenCalledWith({
                resolved: true
            });
        });

        /**
         * Test: getLogs should parse date range.
         *
         * Verifies that startDate and endDate query parameters are
         * converted to Date objects.
         */
        it('should parse date range', async () => {
            mockService.getLogs.mockResolvedValue({
                logs: [],
                total: 0,
                page: 1,
                limit: 50,
                totalPages: 0,
                hasNextPage: false,
                hasPrevPage: false
            });

            const req = createMockRequest({
                query: {
                    startDate: '2025-01-01',
                    endDate: '2025-01-31'
                }
            });
            const res = createMockResponse();
            const next = createMockNext();

            await controller.getLogs(req as Request, res as Response, next);

            expect(mockService.getLogs).toHaveBeenCalledWith({
                startDate: new Date('2025-01-01'),
                endDate: new Date('2025-01-31')
            });
        });

        /**
         * Test: getLogs should call next on error.
         *
         * Verifies that errors are passed to Express error handling middleware.
         */
        it('should call next on error', async () => {
            const error = new Error('Database error');
            mockService.getLogs.mockRejectedValue(error);

            const req = createMockRequest();
            const res = createMockResponse();
            const next = createMockNext();

            await controller.getLogs(req as Request, res as Response, next);

            expect(next).toHaveBeenCalledWith(error);
            expect(res.json).not.toHaveBeenCalled();
        });
    });

    describe('getStats', () => {
        /**
         * Test: getStats should return log statistics.
         *
         * Verifies that the controller fetches and returns statistics.
         */
        it('should return log statistics', async () => {
            const mockStats = {
                total: 100,
                byLevel: { error: 50, warn: 30, info: 20 },
                resolved: 75,
                unresolved: 25
            };

            mockService.getStats.mockResolvedValue(mockStats);

            const req = createMockRequest();
            const res = createMockResponse();
            const next = createMockNext();

            await controller.getStats(req as Request, res as Response, next);

            expect(mockService.getStats).toHaveBeenCalled();
            expect(res.json).toHaveBeenCalledWith({
                success: true,
                stats: mockStats
            });
        });

        /**
         * Test: getStats should call next on error.
         */
        it('should call next on error', async () => {
            const error = new Error('Stats error');
            mockService.getStats.mockRejectedValue(error);

            const req = createMockRequest();
            const res = createMockResponse();
            const next = createMockNext();

            await controller.getStats(req as Request, res as Response, next);

            expect(next).toHaveBeenCalledWith(error);
        });
    });

    describe('getLogById', () => {
        /**
         * Test: getLogById should return log entry.
         *
         * Verifies that the controller fetches a log by ID and returns it.
         */
        it('should return log entry', async () => {
            const mockLog = {
                _id: 'log123',
                level: 'error',
                message: 'Test error'
            };

            mockService.getLogById.mockResolvedValue(mockLog);

            const req = createMockRequest({
                params: { id: 'log123' }
            });
            const res = createMockResponse();
            const next = createMockNext();

            await controller.getLogById(req as Request, res as Response, next);

            expect(mockService.getLogById).toHaveBeenCalledWith('log123');
            expect(res.json).toHaveBeenCalledWith({
                success: true,
                log: mockLog
            });
        });

        /**
         * Test: getLogById should return 404 if not found.
         *
         * Verifies that the controller returns 404 when log entry doesn't exist.
         */
        it('should return 404 if log not found', async () => {
            mockService.getLogById.mockResolvedValue(null);

            const req = createMockRequest({
                params: { id: 'nonexistent' }
            });
            const res = createMockResponse();
            const next = createMockNext();

            await controller.getLogById(req as Request, res as Response, next);

            expect(res.status).toHaveBeenCalledWith(404);
            expect(res.json).toHaveBeenCalledWith({
                success: false,
                error: 'Log entry not found'
            });
        });

        /**
         * Test: getLogById should call next on error.
         */
        it('should call next on error', async () => {
            const error = new Error('Database error');
            mockService.getLogById.mockRejectedValue(error);

            const req = createMockRequest({
                params: { id: 'log123' }
            });
            const res = createMockResponse();
            const next = createMockNext();

            await controller.getLogById(req as Request, res as Response, next);

            expect(next).toHaveBeenCalledWith(error);
        });
    });

    describe('markAsResolved', () => {
        /**
         * Test: markAsResolved should mark log as resolved.
         *
         * Verifies that the controller delegates to service and returns success.
         */
        it('should mark log as resolved', async () => {
            mockService.markAsResolved.mockResolvedValue(undefined);

            const req = createMockRequest({
                params: { id: 'log123' },
                body: { resolvedBy: 'admin' }
            });
            const res = createMockResponse();
            const next = createMockNext();

            await controller.markAsResolved(req as Request, res as Response, next);

            expect(mockService.markAsResolved).toHaveBeenCalledWith('log123', 'admin');
            expect(res.json).toHaveBeenCalledWith({ success: true });
        });

        /**
         * Test: markAsResolved should call next on error.
         */
        it('should call next on error', async () => {
            const error = new Error('Update error');
            mockService.markAsResolved.mockRejectedValue(error);

            const req = createMockRequest({
                params: { id: 'log123' },
                body: { resolvedBy: 'admin' }
            });
            const res = createMockResponse();
            const next = createMockNext();

            await controller.markAsResolved(req as Request, res as Response, next);

            expect(next).toHaveBeenCalledWith(error);
        });
    });

    describe('markAsUnresolved', () => {
        /**
         * Test: markAsUnresolved should mark log as unresolved.
         *
         * Verifies that the controller delegates to service and returns the updated log.
         */
        it('should mark log as unresolved', async () => {
            const mockLog = {
                _id: 'log123',
                resolved: false
            };

            mockService.markAsUnresolved.mockResolvedValue(mockLog);

            const req = createMockRequest({
                params: { id: 'log123' }
            });
            const res = createMockResponse();
            const next = createMockNext();

            await controller.markAsUnresolved(req as Request, res as Response, next);

            expect(mockService.markAsUnresolved).toHaveBeenCalledWith('log123');
            expect(res.json).toHaveBeenCalledWith({
                success: true,
                log: mockLog
            });
        });

        /**
         * Test: markAsUnresolved should return 404 if not found.
         *
         * Verifies that the controller returns 404 when log entry doesn't exist.
         */
        it('should return 404 if log not found', async () => {
            mockService.markAsUnresolved.mockResolvedValue(null);

            const req = createMockRequest({
                params: { id: 'nonexistent' }
            });
            const res = createMockResponse();
            const next = createMockNext();

            await controller.markAsUnresolved(req as Request, res as Response, next);

            expect(res.status).toHaveBeenCalledWith(404);
            expect(res.json).toHaveBeenCalledWith({
                success: false,
                error: 'Log entry not found'
            });
        });

        /**
         * Test: markAsUnresolved should call next on error.
         */
        it('should call next on error', async () => {
            const error = new Error('Update error');
            mockService.markAsUnresolved.mockRejectedValue(error);

            const req = createMockRequest({
                params: { id: 'log123' }
            });
            const res = createMockResponse();
            const next = createMockNext();

            await controller.markAsUnresolved(req as Request, res as Response, next);

            expect(next).toHaveBeenCalledWith(error);
        });
    });

    describe('deleteAllLogs', () => {
        /**
         * Test: deleteAllLogs should delete all log entries.
         *
         * Verifies that the controller delegates to service and returns deletion count.
         */
        it('should delete all log entries', async () => {
            mockService.deleteAllLogs.mockResolvedValue(1000);

            const req = createMockRequest();
            const res = createMockResponse();
            const next = createMockNext();

            await controller.deleteAllLogs(req as Request, res as Response, next);

            expect(mockService.deleteAllLogs).toHaveBeenCalled();
            expect(res.json).toHaveBeenCalledWith({
                success: true,
                message: 'Deleted 1000 log entries',
                deletedCount: 1000
            });
        });

        /**
         * Test: deleteAllLogs should call next on error.
         */
        it('should call next on error', async () => {
            const error = new Error('Delete error');
            mockService.deleteAllLogs.mockRejectedValue(error);

            const req = createMockRequest();
            const res = createMockResponse();
            const next = createMockNext();

            await controller.deleteAllLogs(req as Request, res as Response, next);

            expect(next).toHaveBeenCalledWith(error);
        });
    });
});
