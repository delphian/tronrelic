/**
 * Centralized IDatabaseService mock for Vitest.
 *
 * Provides a complete mock implementation of IDatabaseService that all test files
 * can import and use instead of creating local mock implementations. This mock
 * is designed to work alongside the mongoose mock system but can also be used
 * independently.
 *
 * Why this exists:
 * - **Eliminates duplication** - Single source of truth instead of 13+ local mocks
 * - **Consistent behavior** - All tests use the same mock implementation
 * - **Easier maintenance** - Changes to IDatabaseService interface update once
 * - **Test isolation** - Each test can reset state via clear() method
 * - **Error injection** - Supports simulating database failures for error handling tests
 *
 * Architecture:
 * - Uses in-memory Map for collection storage
 * - Reuses matchesFilter() from mongoose mock for consistent filter behavior
 * - Supports MongoDB and Mongoose operator patterns ($in, $ne, RegExp, $set, etc.)
 * - Includes key-value store for simple configuration
 * - Migration methods are no-ops (tests can spy on them if needed)
 *
 * @example
 * ```typescript
 * import { createMockDatabaseService } from '../../../tests/vitest/mocks/database-service.js';
 *
 * describe('MyService', () => {
 *     let mockDb: ReturnType<typeof createMockDatabaseService>;
 *
 *     beforeEach(() => {
 *         mockDb = createMockDatabaseService();
 *     });
 *
 *     afterEach(() => {
 *         mockDb.clear();
 *     });
 *
 *     it('should store data', async () => {
 *         const service = new MyService(mockDb, logger);
 *         await service.create({ name: 'test' });
 *
 *         const docs = mockDb.getCollectionData('items');
 *         expect(docs).toHaveLength(1);
 *     });
 * });
 * ```
 */

import type { IDatabaseService } from '@tronrelic/types';
import type { Collection, Document, Filter, UpdateFilter } from 'mongodb';
import { ObjectId } from 'mongodb';
import { vi } from 'vitest';
import { matchesFilter } from './mongoose.js';

/**
 * Create a mock IDatabaseService instance.
 *
 * Returns a complete implementation of IDatabaseService with in-memory storage.
 * Each invocation creates a fresh instance with empty collections.
 *
 * The mock provides:
 * - All IDatabaseService methods (CRUD, key-value, migrations)
 * - Test helpers (clear, getCollectionData, injectError)
 * - Consistent filter matching using shared matchesFilter() logic
 *
 * @returns Mock database service with test helpers
 *
 * @example
 * ```typescript
 * const mockDb = createMockDatabaseService();
 *
 * // Use like real IDatabaseService
 * await mockDb.set('key', 'value');
 * const value = await mockDb.get<string>('key');
 *
 * // Test helpers
 * const data = mockDb.getCollectionData('users');
 * expect(data).toHaveLength(1);
 *
 * mockDb.clear();
 * ```
 */
export function createMockDatabaseService(): IDatabaseService & {
    /**
     * Clear all collections and key-value store.
     *
     * Call this in afterEach() or beforeEach() to ensure test isolation.
     */
    clear(): void;

    /**
     * Get raw collection data for assertions.
     *
     * Useful for verifying that data was stored correctly without
     * going through the service API.
     *
     * @param collectionName - Logical collection name
     * @returns Array of documents in the collection
     */
    getCollectionData(collectionName: string): any[];

    /**
     * Inject an error into the next operation on a collection.
     *
     * Useful for testing error handling paths.
     *
     * @param collectionName - Target collection
     * @param operation - Operation to fail (findOne, insertOne, etc.)
     * @param error - Error to throw
     */
    injectError(collectionName: string, operation: string, error: Error): void;
} {
    /**
     * In-memory storage for all collections.
     * Maps collection name to array of documents.
     */
    const collections = new Map<string, any[]>();

    /**
     * Cached collection mocks to ensure same instance returned for same name.
     */
    const collectionMocks = new Map<string, any>();

    /**
     * Key-value store for simple configuration.
     */
    const kvStore = new Map<string, any>();

    /**
     * Injected errors for testing error handling.
     * Maps "collectionName:operation" to Error.
     */
    const injectedErrors = new Map<string, Error>();

    /**
     * Ensure a collection exists in storage.
     */
    function ensureCollection(name: string): any[] {
        if (!collections.has(name)) {
            collections.set(name, []);
        }
        return collections.get(name)!;
    }

    /**
     * Check for injected errors and throw if found.
     */
    function checkInjectedError(collectionName: string, operation: string): void {
        const key = `${collectionName}:${operation}`;
        const error = injectedErrors.get(key);
        if (error) {
            injectedErrors.delete(key); // One-time error injection
            throw error;
        }
    }

    return {
        // ============================================================
        // MongoDB Collection Access
        // ============================================================

        getCollection: vi.fn(<T extends Document = Document>(name: string): Collection<T> => {
            // Return cached collection mock if it exists
            if (collectionMocks.has(name)) {
                return collectionMocks.get(name);
            }

            // Mock collection implementation (minimal for now)
            // Most tests use the convenience methods (find, findOne, etc.)
            // rather than getCollection() directly
            const data = ensureCollection(name);

            const collectionMock = {
                find: (filter: Filter<T> = {} as Filter<T>) => {
                    let sortOptions: Record<string, 1 | -1> | null = null;
                    let skipValue = 0;
                    let limitValue: number | undefined;

                    const cursor = {
                        toArray: async () => {
                            checkInjectedError(name, 'find');
                            let results = filter && Object.keys(filter).length > 0
                                ? data.filter((doc: any) => matchesFilter(doc, filter))
                                : [...data];

                            // Apply sorting
                            if (sortOptions) {
                                const entries = Object.entries(sortOptions);
                                results.sort((a: any, b: any) => {
                                    for (const [field, order] of entries) {
                                        const aVal = a[field];
                                        const bVal = b[field];
                                        if (aVal < bVal) return order === 1 ? -1 : 1;
                                        if (aVal > bVal) return order === 1 ? 1 : -1;
                                    }
                                    return 0;
                                });
                            }

                            // Apply skip
                            if (skipValue > 0) {
                                results = results.slice(skipValue);
                            }

                            // Apply limit
                            if (limitValue !== undefined) {
                                results = results.slice(0, limitValue);
                            }

                            return results;
                        },
                        sort: (options: Record<string, 1 | -1>) => {
                            sortOptions = options;
                            return cursor;
                        },
                        skip: (value: number) => {
                            skipValue = value;
                            return cursor;
                        },
                        limit: (value: number) => {
                            limitValue = value;
                            return cursor;
                        }
                    };

                    return cursor;
                },
                findOne: async (filter: Filter<T>) => {
                    checkInjectedError(name, 'findOne');
                    return data.find((doc: any) => matchesFilter(doc, filter)) || null;
                },
                insertOne: async (doc: any) => {
                    checkInjectedError(name, 'insertOne');
                    const id = doc._id || new ObjectId();
                    const newDoc = { ...doc, _id: id };
                    data.push(newDoc);
                    return { insertedId: id, acknowledged: true };
                },
                updateOne: async (filter: Filter<T>, update: UpdateFilter<T>, options?: any) => {
                    checkInjectedError(name, 'updateOne');
                    const docIndex = data.findIndex((d: any) => matchesFilter(d, filter));

                    if (docIndex !== -1) {
                        const updateFields = (update as any).$set || {};
                        data[docIndex] = { ...data[docIndex], ...updateFields };
                        return { modifiedCount: 1, matchedCount: 1, acknowledged: true, upsertedCount: 0 };
                    }

                    // Handle upsert
                    if (options?.upsert) {
                        const id = new ObjectId();
                        const updateFields = (update as any).$set || {};
                        // Merge filter fields with update fields (matches MongoDB behavior)
                        const newDoc = { ...filter, ...updateFields, _id: id };
                        data.push(newDoc);
                        return { modifiedCount: 0, matchedCount: 0, acknowledged: true, upsertedCount: 1, upsertedId: id };
                    }

                    return { modifiedCount: 0, matchedCount: 0, acknowledged: true, upsertedCount: 0 };
                },
                deleteOne: async (filter: Filter<T>) => {
                    checkInjectedError(name, 'deleteOne');
                    const docIndex = data.findIndex((d: any) => matchesFilter(d, filter));

                    if (docIndex !== -1) {
                        data.splice(docIndex, 1);
                        return { deletedCount: 1, acknowledged: true };
                    }

                    return { deletedCount: 0, acknowledged: true };
                },
                countDocuments: async (filter?: Filter<T>) => {
                    checkInjectedError(name, 'countDocuments');
                    if (!filter || Object.keys(filter).length === 0) {
                        return data.length;
                    }
                    return data.filter((doc: any) => matchesFilter(doc, filter)).length;
                },
                aggregate: vi.fn((pipeline: any[]) => {
                    return {
                        toArray: async () => {
                            checkInjectedError(name, 'aggregate');

                            // Start with all data
                            let results = [...data];

                            // Process each pipeline stage
                            for (const stage of pipeline) {
                                // $match stage - filter documents
                                if (stage.$match) {
                                    results = results.filter((doc: any) => matchesFilter(doc, stage.$match));
                                }

                                // $sort stage - sort documents
                                if (stage.$sort) {
                                    const sortFields = Object.entries(stage.$sort);
                                    results = [...results].sort((a: any, b: any) => {
                                        for (const [field, order] of sortFields) {
                                            const aVal = a[field];
                                            const bVal = b[field];
                                            if (aVal < bVal) return order === 1 ? -1 : 1;
                                            if (aVal > bVal) return order === 1 ? 1 : -1;
                                        }
                                        return 0;
                                    });
                                }

                                // $skip stage - skip N documents
                                if (stage.$skip) {
                                    results = results.slice(stage.$skip);
                                }

                                // $limit stage - limit to N documents
                                if (stage.$limit) {
                                    results = results.slice(0, stage.$limit);
                                }

                                // $group stage - group and aggregate documents
                                if (stage.$group) {
                                    const groupBy = stage.$group._id;
                                    const groups = new Map<any, any[]>();

                                    // Group documents by _id expression
                                    results.forEach((doc: any) => {
                                        let groupKey;

                                        // Handle different _id expressions
                                        if (typeof groupBy === 'object' && groupBy !== null) {
                                            // Complex grouping expression (e.g., date bucketing)
                                            groupKey = JSON.stringify(groupBy);

                                            // For date bucketing with $subtract, $mod, etc.
                                            if (groupBy.$subtract || groupBy.$toDate) {
                                                // Simplified: extract timestamp field and bucket it
                                                // This is a basic implementation that works for common cases
                                                const timestampField = 'timestamp'; // Default field
                                                const timestamp = doc[timestampField];

                                                if (timestamp instanceof Date) {
                                                    // Extract interval from pipeline if available
                                                    // For now, use a simple bucketing strategy
                                                    groupKey = timestamp.toISOString();
                                                }
                                            }
                                        } else if (typeof groupBy === 'string' && groupBy.startsWith('$')) {
                                            // Field reference like "$category"
                                            const fieldName = groupBy.substring(1);
                                            groupKey = doc[fieldName];
                                        } else {
                                            // Constant value (all documents in one group)
                                            groupKey = groupBy;
                                        }

                                        if (!groups.has(groupKey)) {
                                            groups.set(groupKey, []);
                                        }
                                        groups.get(groupKey)!.push(doc);
                                    });

                                    // Apply aggregation operators
                                    results = Array.from(groups.entries()).map(([key, groupDocs]) => {
                                        const result: any = {};

                                        // Set _id field (ungrouped if constant)
                                        if (typeof groupBy === 'object' && groupBy !== null) {
                                            // For complex expressions, use the first doc's timestamp
                                            const firstDoc = groupDocs[0];
                                            if (firstDoc.timestamp) {
                                                result._id = firstDoc.timestamp;
                                            }
                                        } else if (groupBy === null || groupBy === undefined) {
                                            result._id = null;
                                        } else {
                                            result._id = key;
                                        }

                                        // Process each field in $group
                                        for (const [fieldName, expr] of Object.entries(stage.$group)) {
                                            if (fieldName === '_id') continue;

                                            const exprObj = expr as any;

                                            // $avg operator
                                            if (exprObj.$avg) {
                                                const fieldPath = exprObj.$avg.substring(1); // Remove $
                                                const sum = groupDocs.reduce((acc, doc) => acc + (doc[fieldPath] || 0), 0);
                                                result[fieldName] = groupDocs.length > 0 ? sum / groupDocs.length : 0;
                                            }

                                            // $sum operator
                                            else if (exprObj.$sum) {
                                                if (exprObj.$sum === 1) {
                                                    result[fieldName] = groupDocs.length;
                                                } else if (typeof exprObj.$sum === 'string' && exprObj.$sum.startsWith('$')) {
                                                    const fieldPath = exprObj.$sum.substring(1);
                                                    result[fieldName] = groupDocs.reduce((acc, doc) => acc + (doc[fieldPath] || 0), 0);
                                                }
                                            }

                                            // $min operator
                                            else if (exprObj.$min) {
                                                const fieldPath = exprObj.$min.substring(1);
                                                const values = groupDocs.map(doc => doc[fieldPath]).filter(v => v !== undefined);
                                                result[fieldName] = values.length > 0 ? Math.min(...values) : undefined;
                                            }

                                            // $max operator
                                            else if (exprObj.$max) {
                                                const fieldPath = exprObj.$max.substring(1);
                                                const values = groupDocs.map(doc => doc[fieldPath]).filter(v => v !== undefined);
                                                result[fieldName] = values.length > 0 ? Math.max(...values) : undefined;
                                            }

                                            // $first operator
                                            else if (exprObj.$first) {
                                                const fieldPath = exprObj.$first.substring(1);
                                                result[fieldName] = groupDocs[0]?.[fieldPath];
                                            }

                                            // $last operator
                                            else if (exprObj.$last) {
                                                const fieldPath = exprObj.$last.substring(1);
                                                result[fieldName] = groupDocs[groupDocs.length - 1]?.[fieldPath];
                                            }
                                        }

                                        return result;
                                    });
                                }

                                // $project stage - reshape documents
                                if (stage.$project) {
                                    results = results.map((doc: any) => {
                                        const projected: any = {};
                                        for (const [field, value] of Object.entries(stage.$project)) {
                                            if (value === 1) {
                                                projected[field] = doc[field];
                                            } else if (value === 0) {
                                                // Exclude field (copy all except this one)
                                                continue;
                                            } else if (typeof value === 'string' && (value as string).startsWith('$')) {
                                                // Field reference
                                                const fieldName = (value as string).substring(1);
                                                projected[field] = doc[fieldName];
                                            } else if (typeof value === 'object') {
                                                // Handle $dateToString
                                                if ((value as any).$dateToString) {
                                                    const dateField = (value as any).$dateToString.date;
                                                    if (typeof dateField === 'string' && dateField.startsWith('$')) {
                                                        const fieldName = dateField.substring(1);
                                                        const dateValue = doc[fieldName];
                                                        if (dateValue instanceof Date) {
                                                            projected[field] = dateValue.toISOString();
                                                        } else {
                                                            projected[field] = dateValue;
                                                        }
                                                    }
                                                } else {
                                                    // Other expressions - just copy field reference
                                                    if (typeof value === 'string' && (value as string).startsWith('$')) {
                                                        const fieldName = (value as string).substring(1);
                                                        projected[field] = doc[fieldName];
                                                    } else {
                                                        projected[field] = value;
                                                    }
                                                }
                                            }
                                        }
                                        return projected;
                                    });
                                }
                            }

                            return results;
                        }
                    };
                })
            } as any; // Minimal mock - extend as needed

            // Cache the collection mock
            collectionMocks.set(name, collectionMock);

            return collectionMock;
        }) as any,

        // ============================================================
        // Mongoose Model Registry (no-ops for most tests)
        // ============================================================

        registerModel<T extends Document = Document>(collectionName: string, model: any): void {
            // No-op for tests - tests that need model registry can spy on this method
        },

        getModel<T extends Document = Document>(collectionName: string): any | undefined {
            return undefined;
        },

        // ============================================================
        // Key-Value Store
        // ============================================================

        async get<T = any>(key: string): Promise<T | undefined> {
            return kvStore.get(key);
        },

        async set<T = any>(key: string, value: T): Promise<void> {
            kvStore.set(key, value);
        },

        async delete(key: string): Promise<boolean> {
            return kvStore.delete(key);
        },

        // ============================================================
        // Index Management
        // ============================================================

        async createIndex(
            collectionName: string,
            indexSpec: Record<string, 1 | -1>,
            options?: { unique?: boolean; sparse?: boolean; expireAfterSeconds?: number; name?: string }
        ): Promise<void> {
            // No-op for tests - tests that need to verify index creation can spy on this method
        },

        // ============================================================
        // Convenience CRUD Methods
        // ============================================================

        count: vi.fn(async <T extends Document = Document>(
            collectionName: string,
            filter: Filter<T>
        ): Promise<number> => {
            checkInjectedError(collectionName, 'count');
            const data = ensureCollection(collectionName);

            if (Object.keys(filter).length === 0) {
                return data.length;
            }

            return data.filter((doc: any) => matchesFilter(doc, filter)).length;
        }) as any,

        find: vi.fn(async <T extends Document = Document>(
            collectionName: string,
            filter: Filter<T>,
            options?: { limit?: number; skip?: number; sort?: Record<string, 1 | -1> }
        ): Promise<T[]> => {
            checkInjectedError(collectionName, 'find');
            const data = ensureCollection(collectionName);

            let results = Object.keys(filter).length === 0
                ? [...data]  // Create copy to prevent mutations (consistent with getCollection().find())
                : data.filter((doc: any) => matchesFilter(doc, filter));

            // Apply sorting
            if (options?.sort) {
                const entries = Object.entries(options.sort);
                results = [...results].sort((a: any, b: any) => {
                    for (const [field, order] of entries) {
                        const aVal = a[field];
                        const bVal = b[field];

                        if (aVal < bVal) return order === 1 ? -1 : 1;
                        if (aVal > bVal) return order === 1 ? 1 : -1;
                    }
                    return 0;
                });
            }

            // Apply skip
            if (options?.skip) {
                results = results.slice(options.skip);
            }

            // Apply limit
            if (options?.limit) {
                results = results.slice(0, options.limit);
            }

            return results as T[];
        }) as any,

        async findOne<T extends Document = Document>(
            collectionName: string,
            filter: Filter<T>
        ): Promise<T | null> {
            checkInjectedError(collectionName, 'findOne');
            const data = ensureCollection(collectionName);
            const doc = data.find((d: any) => matchesFilter(d, filter));
            return doc ? (doc as T) : null;
        },

        async insertOne<T extends Document = Document>(
            collectionName: string,
            document: T
        ): Promise<any> {
            checkInjectedError(collectionName, 'insertOne');
            const data = ensureCollection(collectionName);
            const id = (document as any)._id || new ObjectId();
            const newDoc = { ...document, _id: id };
            data.push(newDoc);
            return id;
        },

        async updateMany<T extends Document = Document>(
            collectionName: string,
            filter: Filter<T>,
            update: UpdateFilter<T>
        ): Promise<number> {
            checkInjectedError(collectionName, 'updateMany');
            const data = ensureCollection(collectionName);
            let modifiedCount = 0;

            data.forEach((doc, index) => {
                if (matchesFilter(doc, filter)) {
                    const updateFields = (update as any).$set || {};
                    data[index] = { ...data[index], ...updateFields };
                    modifiedCount++;
                }
            });

            return modifiedCount;
        },

        async deleteMany<T extends Document = Document>(
            collectionName: string,
            filter: Filter<T>
        ): Promise<number> {
            checkInjectedError(collectionName, 'deleteMany');
            const data = ensureCollection(collectionName);
            let deletedCount = 0;
            const indicesToDelete: number[] = [];

            data.forEach((doc, index) => {
                if (matchesFilter(doc, filter)) {
                    indicesToDelete.push(index);
                }
            });

            // Delete in reverse order to maintain correct indices
            indicesToDelete.reverse().forEach(index => {
                data.splice(index, 1);
                deletedCount++;
            });

            return deletedCount;
        },

        // ============================================================
        // Migration System (no-ops for tests)
        // ============================================================

        async initializeMigrations(): Promise<void> {
            // No-op - tests that need to verify migration initialization can spy on this method
        },

        async getMigrationsPending(): Promise<Array<{
            id: string;
            description: string;
            source: string;
            filePath: string;
            timestamp: Date;
            dependencies: string[];
            checksum?: string;
        }>> {
            return [];
        },

        async getMigrationsCompleted(limit?: number): Promise<Array<{
            migrationId: string;
            status: 'completed' | 'failed';
            source: string;
            executedAt: Date;
            executionDuration: number;
            error?: string;
            errorStack?: string;
            checksum?: string;
            environment?: string;
            codebaseVersion?: string;
        }>> {
            return [];
        },

        async executeMigration(migrationId: string): Promise<void> {
            // No-op - tests that need to verify migration execution can spy on this method
        },

        async executeMigrationsAll(): Promise<void> {
            // No-op - tests that need to verify migration execution can spy on this method
        },

        isMigrationRunning(): boolean {
            return false;
        },

        // ============================================================
        // Test Helpers
        // ============================================================

        clear(): void {
            collections.clear();
            collectionMocks.clear();
            kvStore.clear();
            injectedErrors.clear();
        },

        getCollectionData(collectionName: string): any[] {
            return ensureCollection(collectionName);
        },

        injectError(collectionName: string, operation: string, error: Error): void {
            const key = `${collectionName}:${operation}`;
            injectedErrors.set(key, error);
        }
    };
}
