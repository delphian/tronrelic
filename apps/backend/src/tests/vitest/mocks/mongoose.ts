/**
 * Comprehensive Mongoose mocking utilities for Vitest.
 *
 * Provides complete mock implementations of Mongoose connection, collections,
 * models, and query builders to enable full testing coverage of IDatabaseService
 * implementations without requiring a real MongoDB instance.
 *
 * Why this exists:
 * - **Complete coverage** - Supports all DatabaseService operations (CRUD, indexes, models)
 * - **Chainable queries** - Proper implementation of sort().skip().limit() patterns
 * - **Model registry** - Full Mongoose model API with lean(), exec(), hooks
 * - **Error injection** - Helpers to simulate database failures for error handling tests
 * - **Reusability** - Single source of truth for all database service tests
 *
 * @example
 * ```typescript
 * import { vi } from 'vitest';
 * import { createMockMongooseModule, getMockCollections, clearMockCollections } from './mocks/mongoose.js';
 *
 * vi.mock('mongoose', () => createMockMongooseModule());
 *
 * beforeEach(() => {
 *     clearMockCollections();
 * });
 *
 * it('should store data', async () => {
 *     const db = new DatabaseService();
 *     await db.set('key', 'value');
 *
 *     const collections = getMockCollections();
 *     expect(collections.get('_kv')).toHaveLength(1);
 * });
 * ```
 */

import { vi } from 'vitest';
import { ObjectId } from 'mongodb';
import type { Filter, UpdateFilter, Sort } from 'mongodb';

/**
 * Global in-memory storage for all mock collections.
 *
 * Maps collection name to array of documents. Shared across all mock instances
 * to ensure consistent state. Use clearMockCollections() to reset between tests.
 */
const mockCollections = new Map<string, any[]>();

/**
 * Cached collection instances keyed by physical collection name.
 *
 * Returning stable instances ensures that spies and mock implementations
 * applied in tests are visible to the code under test, avoiding false
 * positives where new instances bypass injected behaviour.
 */
const mockCollectionInstances = new Map<string, any>();

/**
 * Chainable query builder for mock collections.
 *
 * Implements the MongoDB query builder pattern with support for:
 * - Filtering documents
 * - Sorting results
 * - Pagination (skip/limit)
 * - Result materialization (toArray, exec)
 */
class MockQueryBuilder<T = any> {
    private data: T[];
    private sortOptions?: Sort;
    private skipCount: number = 0;
    private limitCount?: number;

    constructor(data: T[], filter: Filter<T> = {}) {
        // Apply filter immediately if provided
        if (Object.keys(filter).length === 0) {
            this.data = data;
        } else {
            this.data = data.filter((doc: any) => this.matchesFilter(doc, filter));
        }
    }

    /**
     * Check if a document matches a MongoDB filter.
     *
     * Supports:
     * - Equality: { field: value }
     * - ObjectId comparison: { _id: ObjectId(...) }
     * - Nested fields: { 'user.name': 'John' }
     *
     * @param doc - Document to test
     * @param filter - MongoDB filter object
     * @returns True if document matches all filter criteria
     */
    private matchesFilter(doc: any, filter: Filter<T>): boolean {
        return Object.entries(filter).every(([key, value]) => {
            // Handle ObjectId comparison
            if (key === '_id' && value instanceof ObjectId && doc._id instanceof ObjectId) {
                return doc._id.equals(value);
            }

            // Handle nested field paths (e.g., 'user.name')
            if (key.includes('.')) {
                const parts = key.split('.');
                let current = doc;
                for (const part of parts) {
                    if (current == null) return false;
                    current = current[part];
                }
                return current === value;
            }

            // Simple equality
            return doc[key] === value;
        });
    }

    /**
     * Sort results by specified fields.
     *
     * @param sort - MongoDB sort specification { field: 1 | -1 }
     * @returns This query builder for chaining
     */
    public sort(sort: Sort): this {
        this.sortOptions = sort;
        return this;
    }

    /**
     * Skip first N results (pagination).
     *
     * @param count - Number of documents to skip
     * @returns This query builder for chaining
     */
    public skip(count: number): this {
        this.skipCount = count;
        return this;
    }

    /**
     * Limit results to N documents (pagination).
     *
     * @param count - Maximum number of documents to return
     * @returns This query builder for chaining
     */
    public limit(count: number): this {
        this.limitCount = count;
        return this;
    }

    /**
     * Execute query and return results as array.
     *
     * Applies sorting, skip, and limit operations before returning.
     *
     * @returns Filtered and paginated results
     */
    public async toArray(): Promise<T[]> {
        let results = [...this.data];

        // Apply sorting
        if (this.sortOptions) {
            const entries = Object.entries(this.sortOptions);
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
        if (this.skipCount > 0) {
            results = results.slice(this.skipCount);
        }

        // Apply limit
        if (this.limitCount !== undefined) {
            results = results.slice(0, this.limitCount);
        }

        return results;
    }

    /**
     * Execute query and return results (alias for toArray).
     *
     * @returns Filtered and paginated results
     */
    public async exec(): Promise<T[]> {
        return this.toArray();
    }
}

/**
 * Mock Mongoose model implementation.
 *
 * Provides full Mongoose model API including:
 * - Query methods: find(), findOne(), countDocuments()
 * - Mutations: create(), updateMany(), deleteMany()
 * - Lean queries for performance
 * - Chainable query builders
 */
export class MockMongooseModel {
    public modelName: string;
    private collectionName: string;

    constructor(modelName: string, collectionName: string) {
        this.modelName = modelName;
        this.collectionName = collectionName;
    }

    /**
     * Get the underlying data array for this model's collection.
     */
    private getData(): any[] {
        if (!mockCollections.has(this.collectionName)) {
            mockCollections.set(this.collectionName, []);
        }
        return mockCollections.get(this.collectionName)!;
    }

    /**
     * Find documents matching a filter.
     *
     * @param filter - MongoDB filter object
     * @returns Chainable query builder
     */
    public find(filter: Filter<any> = {}) {
        const data = this.getData();
        const builder = new MockQueryBuilder(data, filter);

        return {
            lean: vi.fn(() => ({
                sort: vi.fn((sort: Sort) => {
                    builder.sort(sort);
                    return {
                        skip: vi.fn((count: number) => {
                            builder.skip(count);
                            return {
                                limit: vi.fn((count: number) => {
                                    builder.limit(count);
                                    return {
                                        exec: vi.fn(() => builder.exec())
                                    };
                                })
                            };
                        }),
                        limit: vi.fn((count: number) => {
                            builder.limit(count);
                            return {
                                exec: vi.fn(() => builder.exec())
                            };
                        }),
                        exec: vi.fn(() => builder.exec())
                    };
                }),
                skip: vi.fn((count: number) => {
                    builder.skip(count);
                    return {
                        limit: vi.fn((count: number) => {
                            builder.limit(count);
                            return {
                                exec: vi.fn(() => builder.exec())
                            };
                        }),
                        exec: vi.fn(() => builder.exec())
                    };
                }),
                limit: vi.fn((count: number) => {
                    builder.limit(count);
                    return {
                        exec: vi.fn(() => builder.exec())
                    };
                }),
                exec: vi.fn(() => builder.exec())
            }))
        };
    }

    /**
     * Find a single document matching a filter.
     *
     * @param filter - MongoDB filter object
     * @returns Chainable query builder
     */
    public findOne(filter: Filter<any>) {
        const data = this.getData();
        const doc = data.find((d: any) => {
            return Object.entries(filter).every(([key, value]) => {
                if (key === '_id' && value instanceof ObjectId && d._id instanceof ObjectId) {
                    return d._id.equals(value);
                }
                return d[key] === value;
            });
        });

        return {
            lean: vi.fn(() => ({
                exec: vi.fn(async () => doc || null)
            }))
        };
    }

    /**
     * Create a new document in the collection.
     *
     * @param doc - Document to create
     * @returns Created document with _id
     */
    public async create(doc: any): Promise<any> {
        const data = this.getData();
        const id = new ObjectId();
        const newDoc = { ...doc, _id: id };
        data.push(newDoc);
        return newDoc;
    }

    /**
     * Count documents matching a filter.
     *
     * @param filter - MongoDB filter object
     * @returns Number of matching documents
     */
    public async countDocuments(filter: Filter<any> = {}): Promise<number> {
        const data = this.getData();

        if (Object.keys(filter).length === 0) {
            return data.length;
        }

        return data.filter((doc: any) => {
            return Object.entries(filter).every(([key, value]) => {
                if (key === '_id' && value instanceof ObjectId && doc._id instanceof ObjectId) {
                    return doc._id.equals(value);
                }
                return doc[key] === value;
            });
        }).length;
    }

    /**
     * Update multiple documents matching a filter.
     *
     * @param filter - MongoDB filter object
     * @param update - Update operations
     * @returns Update result with modifiedCount
     */
    public async updateMany(filter: Filter<any>, update: UpdateFilter<any>): Promise<{ modifiedCount: number }> {
        const data = this.getData();
        let modifiedCount = 0;

        data.forEach((doc, index) => {
            const matches = Object.entries(filter).every(([key, value]) => {
                if (key === '_id' && value instanceof ObjectId && doc._id instanceof ObjectId) {
                    return doc._id.equals(value);
                }
                return doc[key] === value;
            });

            if (matches) {
                const updateFields = (update as any).$set || {};
                data[index] = { ...data[index], ...updateFields };
                modifiedCount++;
            }
        });

        return { modifiedCount };
    }

    /**
     * Delete multiple documents matching a filter.
     *
     * @param filter - MongoDB filter object
     * @returns Delete result with deletedCount
     */
    public async deleteMany(filter: Filter<any>): Promise<{ deletedCount: number }> {
        const data = this.getData();
        let deletedCount = 0;
        const indicesToDelete: number[] = [];

        data.forEach((doc, index) => {
            const matches = Object.entries(filter).every(([key, value]) => {
                if (key === '_id' && value instanceof ObjectId && doc._id instanceof ObjectId) {
                    return doc._id.equals(value);
                }
                return doc[key] === value;
            });

            if (matches) {
                indicesToDelete.push(index);
            }
        });

        // Delete in reverse order to maintain correct indices
        indicesToDelete.reverse().forEach(index => {
            data.splice(index, 1);
            deletedCount++;
        });

        return { deletedCount };
    }
}

/**
 * Mock MongoDB collection implementation.
 *
 * Provides the native MongoDB driver collection API with full support for:
 * - CRUD operations
 * - Chainable query builders
 * - Index creation
 * - Upsert operations
 */
export function createMockCollection(name: string) {
    if (mockCollectionInstances.has(name)) {
        return mockCollectionInstances.get(name);
    }

    // Initialize collection if it doesn't exist
    if (!mockCollections.has(name)) {
        mockCollections.set(name, []);
    }

    const data = mockCollections.get(name)!;

    const collection = {
        /**
         * Find documents with chainable query builder.
         */
        find: vi.fn((filter: Filter<any> = {}) => {
            const builder = new MockQueryBuilder(data, filter);

            return {
                toArray: vi.fn(() => builder.toArray()),
                sort: vi.fn((sort: Sort) => {
                    builder.sort(sort);
                    return {
                        toArray: vi.fn(() => builder.toArray()),
                        skip: vi.fn((count: number) => {
                            builder.skip(count);
                            return {
                                toArray: vi.fn(() => builder.toArray()),
                                limit: vi.fn((count: number) => {
                                    builder.limit(count);
                                    return {
                                        toArray: vi.fn(() => builder.toArray())
                                    };
                                })
                            };
                        }),
                        limit: vi.fn((count: number) => {
                            builder.limit(count);
                            return {
                                toArray: vi.fn(() => builder.toArray())
                            };
                        })
                    };
                }),
                skip: vi.fn((count: number) => {
                    builder.skip(count);
                    return {
                        toArray: vi.fn(() => builder.toArray()),
                        limit: vi.fn((count: number) => {
                            builder.limit(count);
                            return {
                                toArray: vi.fn(() => builder.toArray())
                            };
                        })
                    };
                }),
                limit: vi.fn((count: number) => {
                    builder.limit(count);
                    return {
                        toArray: vi.fn(() => builder.toArray())
                    };
                })
            };
        }),

        /**
         * Find a single document.
         */
        findOne: vi.fn(async (filter: Filter<any>) => {
            const doc = data.find((d: any) => {
                return Object.entries(filter).every(([key, value]) => {
                    if (key === '_id' && value instanceof ObjectId && d._id instanceof ObjectId) {
                        return d._id.equals(value);
                    }
                    return d[key] === value;
                });
            });
            return doc || null;
        }),

        /**
         * Insert a single document.
         */
        insertOne: vi.fn(async (doc: any) => {
            const id = new ObjectId();
            const newDoc = { ...doc, _id: id };
            data.push(newDoc);
            return { insertedId: id, acknowledged: true };
        }),

        /**
         * Update a single document with upsert support.
         */
        updateOne: vi.fn(async (filter: Filter<any>, update: UpdateFilter<any>, options?: any) => {
            const docIndex = data.findIndex((d: any) => {
                return Object.entries(filter).every(([key, value]) => {
                    if (key === '_id' && value instanceof ObjectId && d._id instanceof ObjectId) {
                        return d._id.equals(value);
                    }
                    return d[key] === value;
                });
            });

            if (docIndex !== -1) {
                const updateFields = (update as any).$set || {};
                data[docIndex] = { ...data[docIndex], ...updateFields };
                return { modifiedCount: 1, matchedCount: 1, acknowledged: true, upsertedCount: 0 };
            }

            // Handle upsert
            if (options?.upsert) {
                const id = new ObjectId();
                const updateFields = (update as any).$set || {};
                const newDoc = { ...updateFields, _id: id };
                data.push(newDoc);
                return { modifiedCount: 0, matchedCount: 0, acknowledged: true, upsertedCount: 1, upsertedId: id };
            }

            return { modifiedCount: 0, matchedCount: 0, acknowledged: true, upsertedCount: 0 };
        }),

        /**
         * Update multiple documents.
         */
        updateMany: vi.fn(async (filter: Filter<any>, update: UpdateFilter<any>) => {
            let modifiedCount = 0;

            data.forEach((doc, index) => {
                const matches = Object.entries(filter).every(([key, value]) => {
                    if (key === '_id' && value instanceof ObjectId && doc._id instanceof ObjectId) {
                        return doc._id.equals(value);
                    }
                    return doc[key] === value;
                });

                if (matches) {
                    const updateFields = (update as any).$set || {};
                    data[index] = { ...data[index], ...updateFields };
                    modifiedCount++;
                }
            });

            return { modifiedCount, matchedCount: modifiedCount, acknowledged: true };
        }),

        /**
         * Delete a single document.
         */
        deleteOne: vi.fn(async (filter: Filter<any>) => {
            const docIndex = data.findIndex((d: any) => {
                return Object.entries(filter).every(([key, value]) => {
                    if (key === '_id' && value instanceof ObjectId && d._id instanceof ObjectId) {
                        return d._id.equals(value);
                    }
                    return d[key] === value;
                });
            });

            if (docIndex !== -1) {
                data.splice(docIndex, 1);
                return { deletedCount: 1, acknowledged: true };
            }

            return { deletedCount: 0, acknowledged: true };
        }),

        /**
         * Delete multiple documents.
         */
        deleteMany: vi.fn(async (filter: Filter<any>) => {
            let deletedCount = 0;
            const indicesToDelete: number[] = [];

            data.forEach((doc, index) => {
                const matches = Object.entries(filter).every(([key, value]) => {
                    if (key === '_id' && value instanceof ObjectId && doc._id instanceof ObjectId) {
                        return doc._id.equals(value);
                    }
                    return doc[key] === value;
                });

                if (matches) {
                    indicesToDelete.push(index);
                }
            });

            // Delete in reverse order to maintain correct indices
            indicesToDelete.reverse().forEach(index => {
                data.splice(index, 1);
                deletedCount++;
            });

            return { deletedCount, acknowledged: true };
        }),

        /**
         * Count documents matching a filter.
         */
        countDocuments: vi.fn(async (filter: Filter<any> = {}) => {
            if (Object.keys(filter).length === 0) {
                return data.length;
            }

            return data.filter((doc: any) => {
                return Object.entries(filter).every(([key, value]) => {
                    if (key === '_id' && value instanceof ObjectId && doc._id instanceof ObjectId) {
                        return doc._id.equals(value);
                    }
                    return doc[key] === value;
                });
            }).length;
        }),

        /**
         * Create an index on the collection.
         */
        createIndex: vi.fn(async () => 'index_name')
    } as any;

    mockCollectionInstances.set(name, collection);
    return collection;
}

/**
 * Create a complete Mongoose module mock.
 *
 * Returns a mock that can be passed directly to vi.mock('mongoose').
 * Includes full connection, database, and Schema support.
 *
 * @returns Mongoose module mock
 *
 * @example
 * ```typescript
 * vi.mock('mongoose', () => createMockMongooseModule());
 * ```
 */
export function createMockMongooseModule() {
    return async (importOriginal: () => Promise<any>) => {
        const actual = await importOriginal();
        return {
            ...actual,
            default: {
                connection: {
                    db: {
                        collection: createMockCollection
                    }
                }
            }
        };
    };
}

/**
 * Get access to the underlying mock collections storage.
 *
 * Useful for assertions and inspection in tests.
 *
 * @returns Map of collection name to document array
 *
 * @example
 * ```typescript
 * const collections = getMockCollections();
 * expect(collections.get('users')).toHaveLength(5);
 * ```
 */
export function getMockCollections(): Map<string, any[]> {
    return mockCollections;
}

/**
 * Clear all mock collections.
 *
 * Should be called in beforeEach() or afterEach() to ensure test isolation.
 *
 * @example
 * ```typescript
 * beforeEach(() => {
 *     clearMockCollections();
 * });
 * ```
 */
export function clearMockCollections(): void {
    mockCollections.clear();
    mockCollectionInstances.clear();
}

/**
 * Create a mock collection with pre-populated data.
 *
 * Useful for setting up test fixtures.
 *
 * @param name - Collection name
 * @param documents - Initial documents
 *
 * @example
 * ```typescript
 * createMockCollectionWithData('users', [
 *     { _id: new ObjectId(), name: 'Alice', role: 'admin' },
 *     { _id: new ObjectId(), name: 'Bob', role: 'user' }
 * ]);
 * ```
 */
export function createMockCollectionWithData(name: string, documents: any[]): void {
    mockCollections.set(name, [...documents]);
}

/**
 * Inject an error into a specific collection operation.
 *
 * Useful for testing error handling paths.
 *
 * @param collectionName - Target collection
 * @param operation - Operation to fail (findOne, insertOne, etc.)
 * @param error - Error to throw
 *
 * @example
 * ```typescript
 * injectCollectionError('users', 'findOne', new Error('Connection lost'));
 *
 * await expect(db.findOne('users', { _id: id }))
 *     .rejects
 *     .toThrow('Connection lost');
 * ```
 */
export function injectCollectionError(
    collectionName: string,
    operation: string,
    error: Error
): void {
    const collection = createMockCollection(collectionName);
    const method = collection[operation as keyof typeof collection];

    if (typeof method !== 'function') {
        throw new Error(`Operation ${operation} does not exist on collection ${collectionName}`);
    }

    if ('mockRejectedValueOnce' in method && typeof (method as any).mockRejectedValueOnce === 'function') {
        (method as any).mockRejectedValueOnce(error);
        return;
    }

    vi.spyOn(collection, operation as any).mockRejectedValueOnce(error);
}

/**
 * Create a spy on a collection operation for verification.
 *
 * @param collectionName - Target collection
 * @param operation - Operation to spy on
 * @returns Vitest spy
 *
 * @example
 * ```typescript
 * const insertSpy = spyOnCollectionOperation('users', 'insertOne');
 *
 * await db.insertOne('users', { name: 'Alice' });
 *
 * expect(insertSpy).toHaveBeenCalledWith(expect.objectContaining({ name: 'Alice' }));
 * ```
 */
export function spyOnCollectionOperation(
    collectionName: string,
    operation: string
): any {
    const collection = createMockCollection(collectionName);
    return vi.spyOn(collection, operation as any);
}
