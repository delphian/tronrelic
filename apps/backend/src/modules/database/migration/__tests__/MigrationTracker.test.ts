/// <reference types="vitest" />

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { IDatabaseService } from '@tronrelic/types';
import type { IMigrationMetadata, IMigrationRecord } from '../types.js';

// Mock logger to prevent console output during tests
vi.mock('../../../../lib/logger.js', () => ({
    logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
    }
}));

// Import MigrationTracker AFTER mocking dependencies
import { MigrationTracker } from '../MigrationTracker.js';

/**
 * Helper function to create migration test fixtures with qualified IDs.
 */
function createMigrationMetadata(id: string, source: string = 'system', options: Partial<IMigrationMetadata> = {}): IMigrationMetadata {
    const qualifiedId = source === 'system' ? id : `${source}:${id}`;
    return {
        id,
        qualifiedId,
        description: `Migration ${id}`,
        source,
        filePath: `/test/${id}.ts`,
        timestamp: new Date(),
        dependencies: [],
        up: vi.fn(),
        ...options
    };
}

/**
 * Mock IDatabaseService for testing MigrationTracker.
 *
 * Provides in-memory storage for migration records and simulates MongoDB operations.
 */
class MockDatabase implements IDatabaseService {
    private records: IMigrationRecord[] = [];

    getCollection() {
        const self = this;
        return {
            find: (filter: any = {}, options: any = {}) => ({
                toArray: async () => self.records.filter(r => self.matchesFilter(r, filter)),
                sort: (sortSpec: any) => ({
                    limit: (limitNum: number) => ({
                        toArray: async () => {
                            let results = self.records.filter(r => self.matchesFilter(r, filter));
                            // Sort by executedAt descending if specified
                            if (sortSpec.executedAt === -1) {
                                results = results.sort((a, b) => b.executedAt.getTime() - a.executedAt.getTime());
                            }
                            return results.slice(0, limitNum);
                        }
                    })
                })
            }),
            insertOne: async (doc: any) => {
                self.records.push({ ...doc });
                return doc;
            },
            deleteMany: async (filter: any) => {
                const beforeCount = self.records.length;
                self.records = self.records.filter(r => !self.matchesFilter(r, filter));
                return { deletedCount: beforeCount - self.records.length };
            }
        } as any;
    }

    registerModel() {}
    getModel() { return undefined; }

    async get() { return undefined; }
    async set() {}
    async delete() { return false; }
    async createIndex() {}

    async count(collectionName: string, filter: any): Promise<number> {
        return this.records.filter(r => this.matchesFilter(r, filter)).length;
    }

    async find(collectionName: string, filter: any): Promise<any[]> {
        return this.records.filter(r => this.matchesFilter(r, filter));
    }

    async findOne(collectionName: string, filter: any): Promise<any | null> {
        return this.records.find(r => this.matchesFilter(r, filter)) || null;
    }

    async insertOne(collectionName: string, doc: any): Promise<any> {
        this.records.push({ ...doc });
        return doc;
    }

    async updateMany() { return 0; }
    async deleteMany(collectionName: string, filter: any): Promise<number> {
        const beforeCount = this.records.length;
        this.records = this.records.filter(r => !this.matchesFilter(r, filter));
        return beforeCount - this.records.length;
    }

    // Migration methods (not used by tracker)
    async initializeMigrations() {}
    async getMigrationsPending() { return []; }
    async getMigrationsCompleted() { return []; }
    async executeMigration() {}
    async executeMigrationsAll() {}
    isMigrationRunning() { return false; }

    private matchesFilter(record: any, filter: any): boolean {
        return Object.entries(filter).every(([key, value]) => {
            // Handle MongoDB $in operator
            if (typeof value === 'object' && value !== null && '$in' in value) {
                const inArray = (value as any).$in;
                return Array.isArray(inArray) && inArray.includes(record[key]);
            }
            // Simple equality
            return record[key] === value;
        });
    }

    // Helper for tests
    clearRecords() {
        this.records = [];
    }

    getRecords() {
        return [...this.records];
    }
}

describe('MigrationTracker', () => {
    let tracker: MigrationTracker;
    let mockDatabase: MockDatabase;

    beforeEach(async () => {
        vi.clearAllMocks();
        mockDatabase = new MockDatabase();
        tracker = new MigrationTracker(mockDatabase);
        await tracker.ensureIndexes();
    });

    describe('Initialization', () => {
        /**
         * Test: Tracker should initialize with empty database.
         *
         * Verifies that the tracker can initialize without errors when
         * no migration records exist.
         */
        it('should initialize with empty database', async () => {
            const completedIds = await tracker.getCompletedMigrationIds();
            expect(completedIds).toEqual([]);
        });

        /**
         * Test: Tracker should create indexes on initialization.
         *
         * Verifies that ensureIndexes() is called during initialization
         * to set up required database indexes.
         */
        it('should create indexes on initialization', async () => {
            const createIndexSpy = vi.spyOn(mockDatabase, 'createIndex');
            const newTracker = new MigrationTracker(mockDatabase);
            await newTracker.ensureIndexes();

            expect(createIndexSpy).toHaveBeenCalledWith(
                'migrations',
                { migrationId: 1 },
                { unique: true }
            );
        });
    });

    describe('Recording Success', () => {
        /**
         * Test: Tracker should record successful migration execution.
         *
         * Verifies that success records are saved with all required fields
         * including execution duration and checksum.
         */
        it('should record successful migration execution', async () => {
            const metadata: IMigrationMetadata = {
                id: '001_test',
                qualifiedId: '001_test', // System migration uses plain ID
                description: 'Test migration',
                source: 'system',
                filePath: '/test/001_test.ts',
                timestamp: new Date(),
                dependencies: [],
                checksum: 'abc123',
                up: vi.fn()
            };

            await tracker.recordSuccess(metadata, 1234);

            const records = mockDatabase.getRecords();
            expect(records).toHaveLength(1);
            expect(records[0].migrationId).toBe('001_test');
            expect(records[0].status).toBe('completed');
            expect(records[0].executionDuration).toBe(1234);
            expect(records[0].checksum).toBe('abc123');
            expect(records[0].error).toBeUndefined();
        });

        /**
         * Test: Tracker should include execution timestamp.
         *
         * Verifies that the executedAt timestamp is recorded.
         */
        it('should include execution timestamp', async () => {
            const metadata: IMigrationMetadata = {
                id: '001_test',
                qualifiedId: '001_test',
                description: 'Test migration',
                source: 'system',
                filePath: '/test/001_test.ts',
                timestamp: new Date(),
                dependencies: [],
                up: vi.fn()
            };

            const beforeTime = Date.now();
            await tracker.recordSuccess(metadata, 100);
            const afterTime = Date.now();

            const records = mockDatabase.getRecords();
            const executedAt = records[0].executedAt.getTime();
            expect(executedAt).toBeGreaterThanOrEqual(beforeTime);
            expect(executedAt).toBeLessThanOrEqual(afterTime);
        });
    });

    describe('Recording Failure', () => {
        /**
         * Test: Tracker should record failed migration execution.
         *
         * Verifies that failure records include error message and stack trace.
         */
        it('should record failed migration execution', async () => {
            const metadata: IMigrationMetadata = {
                id: '001_test',
                qualifiedId: '001_test',
                description: 'Test migration',
                source: 'system',
                filePath: '/test/001_test.ts',
                timestamp: new Date(),
                dependencies: [],
                up: vi.fn()
            };

            const error = new Error('Migration failed: index creation error');
            await tracker.recordFailure(metadata, error, 500);

            const records = mockDatabase.getRecords();
            expect(records).toHaveLength(1);
            expect(records[0].migrationId).toBe('001_test');
            expect(records[0].status).toBe('failed');
            expect(records[0].error).toBe('Migration failed: index creation error');
            expect(records[0].errorStack).toBeDefined();
            expect(records[0].executionDuration).toBe(500);
        });

        /**
         * Test: Tracker should handle non-Error objects.
         *
         * Verifies that string errors and other thrown values are recorded correctly.
         */
        it('should handle non-Error objects', async () => {
            const metadata: IMigrationMetadata = {
                id: '001_test',
                qualifiedId: '001_test',
                description: 'Test migration',
                source: 'system',
                filePath: '/test/001_test.ts',
                timestamp: new Date(),
                dependencies: [],
                up: vi.fn()
            };

            // Create an Error object with a simple message
            const error = new Error('String error');
            await tracker.recordFailure(metadata, error, 100);

            const records = mockDatabase.getRecords();
            expect(records[0].error).toBe('String error');
            expect(records[0].errorStack).toBeDefined(); // Error objects have stack traces
        });
    });

    describe('Querying Completed Migrations', () => {
        /**
         * Test: Tracker should return completed migration IDs.
         *
         * Verifies that getCompletedMigrationIds() returns only IDs of
         * successfully completed migrations.
         */
        it('should return completed migration IDs', async () => {
            await mockDatabase.insertOne('migrations', {
                migrationId: '001_first',
                status: 'completed',
                source: 'system',
                executedAt: new Date(),
                executionDuration: 100
            });

            await mockDatabase.insertOne('migrations', {
                migrationId: '002_second',
                status: 'completed',
                source: 'system',
                executedAt: new Date(),
                executionDuration: 200
            });

            const completedIds = await tracker.getCompletedMigrationIds();
            expect(completedIds).toEqual(['001_first', '002_second']);
        });

        /**
         * Test: Tracker should exclude failed migrations from completed IDs.
         *
         * Verifies that only migrations with status 'completed' are returned,
         * not those with status 'failed'.
         */
        it('should exclude failed migrations from completed IDs', async () => {
            await mockDatabase.insertOne('migrations', {
                migrationId: '001_success',
                status: 'completed',
                source: 'system',
                executedAt: new Date(),
                executionDuration: 100
            });

            await mockDatabase.insertOne('migrations', {
                migrationId: '002_failed',
                status: 'failed',
                source: 'system',
                executedAt: new Date(),
                executionDuration: 50,
                error: 'Test error'
            });

            const completedIds = await tracker.getCompletedMigrationIds();
            expect(completedIds).toEqual(['001_success']);
        });
    });

    describe('Pending Migration Calculation', () => {
        /**
         * Test: Tracker should identify pending migrations.
         *
         * Verifies that getPendingMigrations() returns migrations that have
         * not been completed yet.
         */
        it('should identify pending migrations', async () => {
            await mockDatabase.insertOne('migrations', {
                migrationId: '001_completed',
                status: 'completed',
                source: 'system',
                executedAt: new Date(),
                executionDuration: 100
            });

            const discovered: IMigrationMetadata[] = [
                {
                    id: '001_completed',
                    qualifiedId: '001_completed',
                    description: 'Already done',
                    source: 'system',
                    filePath: '/test/001.ts',
                    timestamp: new Date(),
                    dependencies: [],
                    up: vi.fn()
                },
                {
                    id: '002_pending',
                    qualifiedId: '002_pending',
                    description: 'Not done yet',
                    source: 'system',
                    filePath: '/test/002.ts',
                    timestamp: new Date(),
                    dependencies: [],
                    up: vi.fn()
                }
            ];

            const pending = await tracker.getPendingMigrations(discovered);
            expect(pending).toHaveLength(1);
            expect(pending[0].id).toBe('002_pending');
        });

        /**
         * Test: Tracker should return all migrations when none completed.
         *
         * Verifies that all discovered migrations are considered pending
         * when the database is empty.
         */
        it('should return all migrations when none completed', async () => {
            const discovered: IMigrationMetadata[] = [
                {
                    id: '001_first',
                qualifiedId: '001_first',
                    description: 'First',
                    source: 'system',
                    filePath: '/test/001.ts',
                    timestamp: new Date(),
                    dependencies: [],
                    up: vi.fn()
                },
                {
                    id: '002_second',
                qualifiedId: '002_second',
                    description: 'Second',
                    source: 'system',
                    filePath: '/test/002.ts',
                    timestamp: new Date(),
                    dependencies: [],
                    up: vi.fn()
                }
            ];

            const pending = await tracker.getPendingMigrations(discovered);
            expect(pending).toHaveLength(2);
        });

        /**
         * Test: Tracker should include failed migrations in pending list.
         *
         * Verifies that failed migrations can be retried (remain pending).
         */
        it('should include failed migrations in pending list', async () => {
            await mockDatabase.insertOne('migrations', {
                migrationId: '001_failed',
                status: 'failed',
                source: 'system',
                executedAt: new Date(),
                executionDuration: 50,
                error: 'Test error'
            });

            const discovered: IMigrationMetadata[] = [
                {
                    id: '001_failed',
                qualifiedId: '001_failed',
                    description: 'Failed migration',
                    source: 'system',
                    filePath: '/test/001.ts',
                    timestamp: new Date(),
                    dependencies: [],
                    up: vi.fn()
                }
            ];

            const pending = await tracker.getPendingMigrations(discovered);
            expect(pending).toHaveLength(1);
            expect(pending[0].id).toBe('001_failed');
        });
    });

    describe('Orphan Cleanup', () => {
        /**
         * Test: Tracker should remove orphaned pending records.
         *
         * Verifies that migration records for migrations that no longer exist
         * in the codebase are removed from the database.
         */
        it('should remove orphaned pending records', async () => {
            // Insert a failed record for a migration that no longer exists
            // (completed records are preserved for history)
            await mockDatabase.insertOne('migrations', {
                migrationId: '999_deleted',
                status: 'failed',
                source: 'system',
                executedAt: new Date(),
                executionDuration: 100,
                error: 'Migration failed',
                errorStack: 'Error stack'
            });

            const discovered: IMigrationMetadata[] = [
                {
                    id: '001_exists',
                qualifiedId: '001_exists',
                    description: 'Still exists',
                    source: 'system',
                    filePath: '/test/001.ts',
                    timestamp: new Date(),
                    dependencies: [],
                    up: vi.fn()
                }
            ];

            const removed = await tracker.removeOrphanedPending(discovered);
            expect(removed).toBe(1);

            const remainingRecords = mockDatabase.getRecords();
            expect(remainingRecords).toHaveLength(0);
        });

        /**
         * Test: Tracker should preserve records for existing migrations.
         *
         * Verifies that records for migrations still in the codebase are
         * not removed during orphan cleanup.
         */
        it('should preserve records for existing migrations', async () => {
            await mockDatabase.insertOne('migrations', {
                migrationId: '001_exists',
                status: 'completed',
                source: 'system',
                executedAt: new Date(),
                executionDuration: 100
            });

            const discovered: IMigrationMetadata[] = [
                {
                    id: '001_exists',
                qualifiedId: '001_exists',
                    description: 'Still exists',
                    source: 'system',
                    filePath: '/test/001.ts',
                    timestamp: new Date(),
                    dependencies: [],
                    up: vi.fn()
                }
            ];

            const removed = await tracker.removeOrphanedPending(discovered);
            expect(removed).toBe(0);

            const remainingRecords = mockDatabase.getRecords();
            expect(remainingRecords).toHaveLength(1);
        });
    });

    describe('Migration History', () => {
        /**
         * Test: Tracker should return completed migrations with limit.
         *
         * Verifies that getCompletedMigrations() respects the limit parameter.
         */
        it('should return completed migrations with limit', async () => {
            for (let i = 1; i <= 5; i++) {
                await mockDatabase.insertOne('migrations', {
                    migrationId: `00${i}_test`,
                    status: 'completed',
                    source: 'system',
                    executedAt: new Date(Date.now() - (5 - i) * 1000), // Stagger timestamps
                    executionDuration: 100
                });
            }

            const history = await tracker.getCompletedMigrations(3);
            expect(history).toHaveLength(3);
        });

        /**
         * Test: Tracker should return migrations sorted by executedAt descending.
         *
         * Verifies that newest migrations appear first in the history.
         */
        it('should return migrations sorted by executedAt descending', async () => {
            await mockDatabase.insertOne('migrations', {
                migrationId: '001_old',
                status: 'completed',
                source: 'system',
                executedAt: new Date('2025-01-01'),
                executionDuration: 100
            });

            await mockDatabase.insertOne('migrations', {
                migrationId: '002_new',
                status: 'completed',
                source: 'system',
                executedAt: new Date('2025-01-02'),
                executionDuration: 100
            });

            const history = await tracker.getCompletedMigrations(10);
            expect(history[0].migrationId).toBe('002_new');
            expect(history[1].migrationId).toBe('001_old');
        });
    });
});
