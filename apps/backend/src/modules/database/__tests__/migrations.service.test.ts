/// <reference types="vitest" />

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MigrationsService } from '../services/migrations.service.js';
import type { IDatabaseService, ISystemLogService } from '@tronrelic/types';

/**
 * Mock logger for testing.
 */
class MockLogger implements Partial<ISystemLogService> {
    public info = vi.fn();
    public error = vi.fn();
    public warn = vi.fn();
    public debug = vi.fn();
    public child = vi.fn(() => new MockLogger() as any);
}

/**
 * Mock database service for testing.
 */
class MockDatabase implements Partial<IDatabaseService> {
    public getMigrationsPending = vi.fn().mockResolvedValue([]);
    public getMigrationsCompleted = vi.fn().mockResolvedValue([]);
    public isMigrationRunning = vi.fn().mockReturnValue(false);
    public executeMigration = vi.fn().mockResolvedValue(undefined);
    public executeMigrationsAll = vi.fn().mockResolvedValue(undefined);
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
}

describe('MigrationsService', () => {
    let service: MigrationsService;
    let mockDatabase: MockDatabase;
    let mockLogger: MockLogger;

    beforeEach(() => {
        vi.clearAllMocks();
        mockDatabase = new MockDatabase();
        mockLogger = new MockLogger();
        service = new MigrationsService(mockDatabase as any, mockLogger as any);
    });

    describe('getStatus()', () => {
        /**
         * Test: Should return comprehensive migration status.
         *
         * Verifies that status includes pending, completed, and running state.
         */
        it('should return comprehensive migration status', async () => {
            const pendingMigrations = [
                {
                    id: 'migration-1',
                    description: 'Test migration 1',
                    source: 'system',
                    filePath: '/path/to/migration-1.ts',
                    timestamp: new Date(),
                    dependencies: []
                }
            ];

            const completedMigrations = [
                {
                    migrationId: 'migration-0',
                    status: 'completed' as const,
                    source: 'system',
                    executedAt: new Date(),
                    executionDuration: 100
                }
            ];

            mockDatabase.getMigrationsPending.mockResolvedValueOnce(pendingMigrations);
            mockDatabase.getMigrationsCompleted.mockResolvedValueOnce(completedMigrations);
            mockDatabase.isMigrationRunning.mockReturnValueOnce(false);

            const status = await service.getStatus();

            expect(status).toEqual({
                pending: pendingMigrations,
                completed: completedMigrations,
                isRunning: false,
                totalPending: 1,
                totalCompleted: 1
            });
        });

        /**
         * Test: Should handle errors gracefully.
         *
         * Verifies that errors are logged and re-thrown with context.
         */
        it('should handle errors gracefully', async () => {
            mockDatabase.getMigrationsPending.mockRejectedValueOnce(new Error('Database error'));

            await expect(service.getStatus()).rejects.toThrow(
                'Failed to get migration status: Database error'
            );
            expect(mockLogger.error).toHaveBeenCalled();
        });
    });

    describe('getHistory()', () => {
        /**
         * Test: Should return all migration history.
         *
         * Verifies that history is returned without filtering by default.
         */
        it('should return all migration history', async () => {
            const history = [
                {
                    migrationId: 'migration-1',
                    status: 'completed' as const,
                    source: 'system',
                    executedAt: new Date(),
                    executionDuration: 100
                },
                {
                    migrationId: 'migration-2',
                    status: 'failed' as const,
                    source: 'system',
                    executedAt: new Date(),
                    executionDuration: 50,
                    error: 'Test error'
                }
            ];

            mockDatabase.getMigrationsCompleted.mockResolvedValueOnce(history);

            const result = await service.getHistory();

            expect(result).toEqual(history);
            expect(mockDatabase.getMigrationsCompleted).toHaveBeenCalledWith(100);
        });

        /**
         * Test: Should filter history by status.
         *
         * Verifies that history can be filtered to show only completed or failed migrations.
         */
        it('should filter history by status', async () => {
            const history = [
                {
                    migrationId: 'migration-1',
                    status: 'completed' as const,
                    source: 'system',
                    executedAt: new Date(),
                    executionDuration: 100
                },
                {
                    migrationId: 'migration-2',
                    status: 'failed' as const,
                    source: 'system',
                    executedAt: new Date(),
                    executionDuration: 50,
                    error: 'Test error'
                }
            ];

            mockDatabase.getMigrationsCompleted.mockResolvedValueOnce(history);

            const result = await service.getHistory(100, 'completed');

            expect(result).toHaveLength(1);
            expect(result[0].migrationId).toBe('migration-1');
        });

        /**
         * Test: Should enforce maximum limit.
         *
         * Verifies that the limit cannot exceed 500 records.
         */
        it('should enforce maximum limit', async () => {
            mockDatabase.getMigrationsCompleted.mockResolvedValueOnce([]);

            await service.getHistory(1000);

            expect(mockDatabase.getMigrationsCompleted).toHaveBeenCalledWith(500);
        });

        /**
         * Test: Should handle errors gracefully.
         */
        it('should handle errors gracefully', async () => {
            mockDatabase.getMigrationsCompleted.mockRejectedValueOnce(new Error('Database error'));

            await expect(service.getHistory()).rejects.toThrow(
                'Failed to get migration history: Database error'
            );
            expect(mockLogger.error).toHaveBeenCalled();
        });
    });

    describe('executeOne()', () => {
        /**
         * Test: Should execute single migration successfully.
         *
         * Verifies that a specific migration can be executed by ID.
         */
        it('should execute single migration successfully', async () => {
            mockDatabase.isMigrationRunning.mockReturnValueOnce(false);
            mockDatabase.executeMigration.mockResolvedValueOnce(undefined);

            const result = await service.executeOne('migration-1');

            expect(result).toEqual({
                success: true,
                executed: ['migration-1']
            });
            expect(mockDatabase.executeMigration).toHaveBeenCalledWith('migration-1');
            expect(mockLogger.info).toHaveBeenCalled();
        });

        /**
         * Test: Should prevent concurrent migration execution.
         *
         * Verifies that migrations cannot run simultaneously.
         */
        it('should prevent concurrent migration execution', async () => {
            mockDatabase.isMigrationRunning.mockReturnValueOnce(true);

            await expect(service.executeOne('migration-1')).rejects.toThrow(
                'Cannot execute migration: Another migration is already running'
            );
        });

        /**
         * Test: Should handle migration execution failure.
         *
         * Verifies that failed migrations return error details.
         */
        it('should handle migration execution failure', async () => {
            mockDatabase.isMigrationRunning.mockReturnValueOnce(false);
            mockDatabase.executeMigration.mockRejectedValueOnce(new Error('Migration failed'));

            const result = await service.executeOne('migration-1');

            expect(result).toEqual({
                success: false,
                executed: [],
                failed: {
                    migrationId: 'migration-1',
                    error: 'Migration failed'
                }
            });
            expect(mockLogger.error).toHaveBeenCalled();
        });
    });

    describe('executeAll()', () => {
        /**
         * Test: Should execute all pending migrations successfully.
         *
         * Verifies that all pending migrations are executed in order.
         */
        it('should execute all pending migrations successfully', async () => {
            const pendingMigrations = [
                {
                    id: 'migration-1',
                    description: 'Test migration 1',
                    source: 'system',
                    filePath: '/path/to/migration-1.ts',
                    timestamp: new Date(),
                    dependencies: []
                },
                {
                    id: 'migration-2',
                    description: 'Test migration 2',
                    source: 'system',
                    filePath: '/path/to/migration-2.ts',
                    timestamp: new Date(),
                    dependencies: ['migration-1']
                }
            ];

            mockDatabase.isMigrationRunning.mockReturnValueOnce(false);
            mockDatabase.getMigrationsPending.mockResolvedValueOnce(pendingMigrations);
            mockDatabase.executeMigrationsAll.mockResolvedValueOnce(undefined);

            const result = await service.executeAll();

            expect(result).toEqual({
                success: true,
                executed: ['migration-1', 'migration-2']
            });
            expect(mockDatabase.executeMigrationsAll).toHaveBeenCalled();
            expect(mockLogger.info).toHaveBeenCalled();
        });

        /**
         * Test: Should return success with empty array when no pending migrations.
         *
         * Verifies that executing with no pending migrations succeeds immediately.
         */
        it('should return success with empty array when no pending migrations', async () => {
            mockDatabase.isMigrationRunning.mockReturnValueOnce(false);
            mockDatabase.getMigrationsPending.mockResolvedValueOnce([]);

            const result = await service.executeAll();

            expect(result).toEqual({
                success: true,
                executed: []
            });
            expect(mockDatabase.executeMigrationsAll).not.toHaveBeenCalled();
        });

        /**
         * Test: Should prevent concurrent migration execution.
         */
        it('should prevent concurrent migration execution', async () => {
            mockDatabase.isMigrationRunning.mockReturnValueOnce(true);

            await expect(service.executeAll()).rejects.toThrow(
                'Cannot execute migrations: Another migration is already running'
            );
        });

        /**
         * Test: Should handle partial execution on failure.
         *
         * Verifies that when migrations fail, the result shows which migrations
         * succeeded before failure occurred.
         */
        it('should handle partial execution on failure', async () => {
            const pendingMigrations = [
                {
                    id: 'migration-1',
                    description: 'Test migration 1',
                    source: 'system',
                    filePath: '/path/to/migration-1.ts',
                    timestamp: new Date(),
                    dependencies: []
                },
                {
                    id: 'migration-2',
                    description: 'Test migration 2',
                    source: 'system',
                    filePath: '/path/to/migration-2.ts',
                    timestamp: new Date(),
                    dependencies: ['migration-1']
                }
            ];

            const stillPending = [
                {
                    id: 'migration-2',
                    description: 'Test migration 2',
                    source: 'system',
                    filePath: '/path/to/migration-2.ts',
                    timestamp: new Date(),
                    dependencies: ['migration-1']
                }
            ];

            mockDatabase.isMigrationRunning.mockReturnValueOnce(false);
            mockDatabase.getMigrationsPending
                .mockResolvedValueOnce(pendingMigrations)
                .mockResolvedValueOnce(stillPending);
            mockDatabase.executeMigrationsAll.mockRejectedValueOnce(new Error('Migration 2 failed'));

            const result = await service.executeAll();

            expect(result).toEqual({
                success: false,
                executed: ['migration-1'],
                failed: {
                    migrationId: 'migration-2',
                    error: 'Migration 2 failed'
                }
            });
            expect(mockLogger.error).toHaveBeenCalled();
        });
    });

    describe('getMigrationDetails()', () => {
        /**
         * Test: Should return details for pending migration.
         *
         * Verifies that pending migrations include metadata and execution history.
         */
        it('should return details for pending migration', async () => {
            const pendingMigration = {
                id: 'migration-1',
                description: 'Test migration',
                source: 'system',
                filePath: '/path/to/migration-1.ts',
                timestamp: new Date(),
                dependencies: []
            };

            const executions = [
                {
                    migrationId: 'migration-1',
                    status: 'failed' as const,
                    source: 'system',
                    executedAt: new Date(),
                    executionDuration: 50,
                    error: 'Previous failure'
                }
            ];

            mockDatabase.getMigrationsPending.mockResolvedValueOnce([pendingMigration]);
            mockDatabase.getMigrationsCompleted.mockResolvedValueOnce(executions);

            const details = await service.getMigrationDetails('migration-1');

            expect(details).toEqual({
                migration: pendingMigration,
                isPending: true,
                executions
            });
        });

        /**
         * Test: Should return details for completed migration.
         *
         * Verifies that completed migrations show execution history without metadata.
         */
        it('should return details for completed migration', async () => {
            const executions = [
                {
                    migrationId: 'migration-1',
                    status: 'completed' as const,
                    source: 'system',
                    executedAt: new Date(),
                    executionDuration: 100
                }
            ];

            mockDatabase.getMigrationsPending.mockResolvedValueOnce([]);
            mockDatabase.getMigrationsCompleted.mockResolvedValueOnce(executions);

            const details = await service.getMigrationDetails('migration-1');

            expect(details).toEqual({
                migration: null,
                isPending: false,
                executions
            });
        });

        /**
         * Test: Should throw error for non-existent migration.
         *
         * Verifies that requesting details for unknown migrations throws error.
         */
        it('should throw error for non-existent migration', async () => {
            mockDatabase.getMigrationsPending.mockResolvedValueOnce([]);
            mockDatabase.getMigrationsCompleted.mockResolvedValueOnce([]);

            await expect(service.getMigrationDetails('unknown-migration')).rejects.toThrow(
                "Migration 'unknown-migration' not found"
            );
        });

        /**
         * Test: Should handle errors gracefully.
         */
        it('should handle errors gracefully', async () => {
            mockDatabase.getMigrationsPending.mockRejectedValueOnce(new Error('Database error'));

            await expect(service.getMigrationDetails('migration-1')).rejects.toThrow(
                'Failed to get migration details: Database error'
            );
            expect(mockLogger.error).toHaveBeenCalled();
        });
    });
});
