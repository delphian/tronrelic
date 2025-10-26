/// <reference types="vitest" />

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { IDatabaseService } from '@tronrelic/types';
import type { IMigrationMetadata } from '../types.js';
import { MigrationTracker } from '../MigrationTracker.js';
import { createMockMongooseModule } from '../../../../tests/vitest/mocks/mongoose.js';

// Mock logger to prevent console output during tests
vi.mock('../../../../lib/logger.js', () => ({
    logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        fatal: vi.fn()
    }
}));

// Mock mongoose with centralized transaction support
vi.mock('mongoose', () => createMockMongooseModule()());

// Mock process.exit to prevent test crashes
vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null | undefined): never => {
    throw new Error(`process.exit unexpectedly called with "${code}"`);
});

// Import MigrationExecutor AFTER mocking dependencies
import { MigrationExecutor } from '../MigrationExecutor.js';

/**
 * Mock IDatabaseService for testing MigrationExecutor.
 */
class MockDatabase implements IDatabaseService {
    public transactionSupported = true;
    public transactionCommitted = false;
    public transactionRolledBack = false;

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

    // Migration methods (not used by executor)
    async initializeMigrations() {}
    async getMigrationsPending() { return []; }
    async getMigrationsCompleted() { return []; }
    async executeMigration() {}
    async executeMigrationsAll() {}
    isMigrationRunning() { return false; }

    // Transaction simulation
    resetTransactionState() {
        this.transactionCommitted = false;
        this.transactionRolledBack = false;
    }
}

/**
 * Mock MigrationTracker for testing MigrationExecutor.
 */
class MockTracker {
    public successRecorded = false;
    public failureRecorded = false;
    public lastRecordedMetadata: IMigrationMetadata | null = null;
    public lastRecordedError: Error | null = null;
    public lastRecordedDuration = 0;

    async recordSuccess(metadata: IMigrationMetadata, duration: number): Promise<void> {
        this.successRecorded = true;
        this.lastRecordedMetadata = metadata;
        this.lastRecordedDuration = duration;
    }

    async recordFailure(metadata: IMigrationMetadata, error: Error, duration: number): Promise<void> {
        this.failureRecorded = true;
        this.lastRecordedMetadata = metadata;
        this.lastRecordedError = error;
        this.lastRecordedDuration = duration;
    }

    reset() {
        this.successRecorded = false;
        this.failureRecorded = false;
        this.lastRecordedMetadata = null;
        this.lastRecordedError = null;
        this.lastRecordedDuration = 0;
    }
}

describe('MigrationExecutor', () => {
    let executor: MigrationExecutor;
    let mockDatabase: MockDatabase;
    let mockTracker: MockTracker;

    beforeEach(() => {
        vi.clearAllMocks();
        mockDatabase = new MockDatabase();
        mockTracker = new MockTracker();
        executor = new MigrationExecutor(mockDatabase, mockTracker as any as MigrationTracker);
    });

    describe('Execution State Management', () => {
        /**
         * Test: Executor should track running state.
         *
         * Verifies that isRunning() correctly reflects whether a migration
         * is currently executing.
         */
        it('should track running state', async () => {
            expect(executor.isRunning()).toBe(false);

            const migration: IMigrationMetadata = {
                id: '001_test',
                description: 'Test migration',
                source: 'system',
                filePath: '/test/001.ts',
                timestamp: new Date(),
                dependencies: [],
                up: vi.fn(async () => {
                    // Check state during execution
                    expect(executor.isRunning()).toBe(true);
                })
            };

            await executor.executeMigration(migration);
            expect(executor.isRunning()).toBe(false);
        });

        /**
         * Test: Executor should prevent concurrent execution.
         *
         * Verifies that attempting to execute a migration while another is
         * running throws an error.
         */
        it('should prevent concurrent execution', async () => {
            const slowMigration: IMigrationMetadata = {
                id: '001_slow',
                description: 'Slow migration',
                source: 'system',
                filePath: '/test/001.ts',
                timestamp: new Date(),
                dependencies: [],
                up: vi.fn(async () => {
                    await new Promise(resolve => setTimeout(resolve, 100));
                })
            };

            const fastMigration: IMigrationMetadata = {
                id: '002_fast',
                description: 'Fast migration',
                source: 'system',
                filePath: '/test/002.ts',
                timestamp: new Date(),
                dependencies: [],
                up: vi.fn()
            };

            // Start slow migration (don't await)
            const slowPromise = executor.executeMigration(slowMigration);

            // Try to start fast migration while slow is running
            await expect(async () => {
                await executor.executeMigration(fastMigration);
            }).rejects.toThrow(/already running/);

            // Wait for slow migration to complete
            await slowPromise;
        });
    });

    describe('Successful Execution', () => {
        /**
         * Test: Executor should execute migration up function.
         *
         * Verifies that the migration's up() method is called with the
         * database service.
         */
        it('should execute migration up function', async () => {
            const upFunction = vi.fn();
            const migration: IMigrationMetadata = {
                id: '001_test',
                description: 'Test migration',
                source: 'system',
                filePath: '/test/001.ts',
                timestamp: new Date(),
                dependencies: [],
                up: upFunction
            };

            await executor.executeMigration(migration);

            expect(upFunction).toHaveBeenCalledTimes(1);
            expect(upFunction).toHaveBeenCalledWith(mockDatabase);
        });

        /**
         * Test: Executor should record success after execution.
         *
         * Verifies that successful migrations are recorded via the tracker.
         */
        it('should record success after execution', async () => {
            const migration: IMigrationMetadata = {
                id: '001_test',
                description: 'Test migration',
                source: 'system',
                filePath: '/test/001.ts',
                timestamp: new Date(),
                dependencies: [],
                up: vi.fn()
            };

            await executor.executeMigration(migration);

            expect(mockTracker.successRecorded).toBe(true);
            expect(mockTracker.lastRecordedMetadata?.id).toBe('001_test');
            expect(mockTracker.lastRecordedDuration).toBeGreaterThanOrEqual(0);
        });

        /**
         * Test: Executor should measure execution duration.
         *
         * Verifies that the executor accurately measures how long the
         * migration takes to execute.
         */
        it('should measure execution duration', async () => {
            const migration: IMigrationMetadata = {
                id: '001_test',
                description: 'Test migration',
                source: 'system',
                filePath: '/test/001.ts',
                timestamp: new Date(),
                dependencies: [],
                up: vi.fn(async () => {
                    await new Promise(resolve => setTimeout(resolve, 50));
                })
            };

            await executor.executeMigration(migration);

            expect(mockTracker.lastRecordedDuration).toBeGreaterThanOrEqual(50);
        });
    });

    describe('Failed Execution', () => {
        /**
         * Test: Executor should catch and record migration errors.
         *
         * Verifies that errors thrown by migrations are caught and recorded
         * via the tracker.
         */
        it('should catch and record migration errors', async () => {
            const error = new Error('Migration failed');
            const migration: IMigrationMetadata = {
                id: '001_test',
                description: 'Test migration',
                source: 'system',
                filePath: '/test/001.ts',
                timestamp: new Date(),
                dependencies: [],
                up: vi.fn(async () => {
                    throw error;
                })
            };

            await expect(async () => {
                await executor.executeMigration(migration);
            }).rejects.toThrow('Migration failed');

            expect(mockTracker.failureRecorded).toBe(true);
            expect(mockTracker.lastRecordedError).toBe(error);
        });

        /**
         * Test: Executor should reset running state after failure.
         *
         * Verifies that the executor allows new migrations to run after
         * a previous migration fails.
         */
        it('should reset running state after failure', async () => {
            const failingMigration: IMigrationMetadata = {
                id: '001_fail',
                description: 'Failing migration',
                source: 'system',
                filePath: '/test/001.ts',
                timestamp: new Date(),
                dependencies: [],
                up: vi.fn(async () => {
                    throw new Error('Test error');
                })
            };

            await expect(async () => {
                await executor.executeMigration(failingMigration);
            }).rejects.toThrow();

            expect(executor.isRunning()).toBe(false);

            // Should be able to execute another migration
            const successMigration: IMigrationMetadata = {
                id: '002_success',
                description: 'Success migration',
                source: 'system',
                filePath: '/test/002.ts',
                timestamp: new Date(),
                dependencies: [],
                up: vi.fn()
            };

            await executor.executeMigration(successMigration);
            expect(mockTracker.successRecorded).toBe(true);
        });
    });

    describe('Batch Execution', () => {
        /**
         * Test: Executor should execute multiple migrations in series.
         *
         * Verifies that executeMigrations() runs all migrations in order.
         */
        it('should execute multiple migrations in series', async () => {
            const executionOrder: string[] = [];

            const migrations: IMigrationMetadata[] = [
                {
                    id: '001_first',
                    description: 'First',
                    source: 'system',
                    filePath: '/test/001.ts',
                    timestamp: new Date(),
                    dependencies: [],
                    up: vi.fn(async () => {
                        executionOrder.push('001_first');
                    })
                },
                {
                    id: '002_second',
                    description: 'Second',
                    source: 'system',
                    filePath: '/test/002.ts',
                    timestamp: new Date(),
                    dependencies: [],
                    up: vi.fn(async () => {
                        executionOrder.push('002_second');
                    })
                },
                {
                    id: '003_third',
                    description: 'Third',
                    source: 'system',
                    filePath: '/test/003.ts',
                    timestamp: new Date(),
                    dependencies: [],
                    up: vi.fn(async () => {
                        executionOrder.push('003_third');
                    })
                }
            ];

            await executor.executeMigrations(migrations);

            expect(executionOrder).toEqual(['001_first', '002_second', '003_third']);
        });

        /**
         * Test: Executor should stop on first failure in batch.
         *
         * Verifies that if a migration fails during batch execution,
         * remaining migrations are not executed.
         */
        it('should stop on first failure in batch', async () => {
            const executionOrder: string[] = [];

            const migrations: IMigrationMetadata[] = [
                {
                    id: '001_success',
                    description: 'Success',
                    source: 'system',
                    filePath: '/test/001.ts',
                    timestamp: new Date(),
                    dependencies: [],
                    up: vi.fn(async () => {
                        executionOrder.push('001_success');
                    })
                },
                {
                    id: '002_failure',
                    description: 'Failure',
                    source: 'system',
                    filePath: '/test/002.ts',
                    timestamp: new Date(),
                    dependencies: [],
                    up: vi.fn(async () => {
                        executionOrder.push('002_failure');
                        throw new Error('Migration failed');
                    })
                },
                {
                    id: '003_skipped',
                    description: 'Skipped',
                    source: 'system',
                    filePath: '/test/003.ts',
                    timestamp: new Date(),
                    dependencies: [],
                    up: vi.fn(async () => {
                        executionOrder.push('003_skipped');
                    })
                }
            ];

            await expect(async () => {
                await executor.executeMigrations(migrations);
            }).rejects.toThrow('Migration failed');

            expect(executionOrder).toEqual(['001_success', '002_failure']);
            expect(executionOrder).not.toContain('003_skipped');
        });
    });

    describe('Database Service Access', () => {
        /**
         * Test: Migration should have access to database methods.
         *
         * Verifies that migrations can call database service methods
         * during execution.
         */
        it('should provide database service to migration', async () => {
            let receivedDatabase: IDatabaseService | null = null;

            const migration: IMigrationMetadata = {
                id: '001_test',
                description: 'Test migration',
                source: 'system',
                filePath: '/test/001.ts',
                timestamp: new Date(),
                dependencies: [],
                up: vi.fn(async (database) => {
                    receivedDatabase = database;
                    await database.createIndex('test', { field: 1 });
                })
            };

            await executor.executeMigration(migration);

            expect(receivedDatabase).toBe(mockDatabase);
        });

        /**
         * Test: Migration should be able to perform multiple database operations.
         *
         * Verifies that migrations can chain multiple database operations.
         */
        it('should allow multiple database operations', async () => {
            const createIndexSpy = vi.spyOn(mockDatabase, 'createIndex');
            const setSpy = vi.spyOn(mockDatabase, 'set');

            const migration: IMigrationMetadata = {
                id: '001_test',
                description: 'Test migration',
                source: 'system',
                filePath: '/test/001.ts',
                timestamp: new Date(),
                dependencies: [],
                up: vi.fn(async (database) => {
                    await database.createIndex('users', { email: 1 }, { unique: true });
                    await database.set('migration_version', '1.0.0');
                    await database.createIndex('users', { createdAt: -1 });
                })
            };

            await executor.executeMigration(migration);

            expect(createIndexSpy).toHaveBeenCalledTimes(2);
            expect(setSpy).toHaveBeenCalledTimes(1);
        });
    });

    describe('Error Handling', () => {
        /**
         * Test: Executor should handle async errors correctly.
         *
         * Verifies that errors from async operations in migrations
         * are caught properly.
         */
        it('should handle async errors correctly', async () => {
            const migration: IMigrationMetadata = {
                id: '001_test',
                description: 'Test migration',
                source: 'system',
                filePath: '/test/001.ts',
                timestamp: new Date(),
                dependencies: [],
                up: vi.fn(async () => {
                    await Promise.reject(new Error('Async error'));
                })
            };

            await expect(async () => {
                await executor.executeMigration(migration);
            }).rejects.toThrow('Async error');

            expect(mockTracker.failureRecorded).toBe(true);
        });

        /**
         * Test: Executor should handle synchronous errors correctly.
         *
         * Verifies that synchronous errors thrown in migrations are caught.
         */
        it('should handle synchronous errors correctly', async () => {
            const migration: IMigrationMetadata = {
                id: '001_test',
                description: 'Test migration',
                source: 'system',
                filePath: '/test/001.ts',
                timestamp: new Date(),
                dependencies: [],
                up: vi.fn(() => {
                    throw new Error('Sync error');
                })
            };

            await expect(async () => {
                await executor.executeMigration(migration);
            }).rejects.toThrow('Sync error');

            expect(mockTracker.failureRecorded).toBe(true);
        });
    });
});
