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
 * Shared filter matching logic for all mock operations.
 *
 * Supports MongoDB query operators: $in, $ne, $or, $regex, $exists, $gte, $lte,
 * RegExp, array contains, ObjectId comparison, and nested field paths.
 * Exported for reuse in custom IDatabaseService mocks.
 *
 * @param doc - Document to test
 * @param filter - MongoDB filter object
 * @returns True if document matches all filter criteria
 */
export function matchesFilter(doc: any, filter: Filter<any>): boolean {
    return Object.entries(filter).every(([key, value]) => {
        // Handle $or operator: { $or: [{ field1: value1 }, { field2: value2 }] }
        if (key === '$or' && Array.isArray(value)) {
            return value.some((subFilter: any) => matchesFilter(doc, subFilter));
        }

        // Handle $and operator: { $and: [{ field1: value1 }, { field2: value2 }] }
        if (key === '$and' && Array.isArray(value)) {
            return value.every((subFilter: any) => matchesFilter(doc, subFilter));
        }

        // Handle ObjectId comparison
        if (key === '_id' && value instanceof ObjectId && doc._id instanceof ObjectId) {
            return doc._id.equals(value);
        }

        // Handle RegExp (for MongoDB regex queries like { mimeType: /^image\// })
        if (value instanceof RegExp) {
            const docValue = getNestedValue(doc, key);
            return docValue != null && value.test(String(docValue));
        }

        // Handle object-based operators
        if (value && typeof value === 'object' && !(value instanceof ObjectId) && !(value instanceof Date)) {
            // Handle $regex operator: { field: { $regex: 'pattern', $options: 'i' } }
            if ('$regex' in value) {
                const pattern = (value as any).$regex;
                const options = (value as any).$options || '';
                const regex = new RegExp(pattern, options);
                const docValue = getNestedValue(doc, key);
                return docValue != null && regex.test(String(docValue));
            }

            // Handle $in operator: { field: { $in: [value1, value2] } }
            if ('$in' in value) {
                const inValues = (value as any).$in;
                const docValue = getNestedValue(doc, key);
                if (Array.isArray(docValue)) {
                    // Document field is array - check if any value in doc array matches any value in $in array
                    return docValue.some((dv: any) => inValues.includes(dv));
                }
                // Document field is scalar - check if it matches any value in $in array
                return inValues.includes(docValue);
            }

            // Handle $ne operator: { field: { $ne: value } }
            if ('$ne' in value) {
                const neValue = (value as any).$ne;
                const docValue = getNestedValue(doc, key);
                if (key === '_id') {
                    if (neValue instanceof ObjectId && doc._id instanceof ObjectId) {
                        return !doc._id.equals(neValue);
                    }
                }
                return docValue !== neValue;
            }

            // Handle $exists operator: { field: { $exists: true/false } }
            if ('$exists' in value) {
                const exists = (value as any).$exists;
                const docValue = getNestedValue(doc, key);
                return exists ? docValue !== undefined : docValue === undefined;
            }

            // Handle $gte operator: { field: { $gte: value } }
            if ('$gte' in value) {
                const gteValue = (value as any).$gte;
                const docValue = getNestedValue(doc, key);
                return docValue >= gteValue;
            }

            // Handle $lte operator: { field: { $lte: value } }
            if ('$lte' in value) {
                const lteValue = (value as any).$lte;
                const docValue = getNestedValue(doc, key);
                return docValue <= lteValue;
            }

            // Handle $gt operator: { field: { $gt: value } }
            if ('$gt' in value) {
                const gtValue = (value as any).$gt;
                const docValue = getNestedValue(doc, key);
                return docValue > gtValue;
            }

            // Handle $lt operator: { field: { $lt: value } }
            if ('$lt' in value) {
                const ltValue = (value as any).$lt;
                const docValue = getNestedValue(doc, key);
                return docValue < ltValue;
            }
        }

        // Handle nested field paths (e.g., 'user.name' or 'wallets.address')
        if (key.includes('.')) {
            const docValue = getNestedValue(doc, key);
            return docValue === value;
        }

        // Handle array contains queries (e.g., { oldSlugs: "/old-url" })
        if (Array.isArray(doc[key])) {
            return doc[key].includes(value);
        }

        // Simple equality
        return doc[key] === value;
    });
}

/**
 * Get a nested value from a document using dot notation.
 * Handles both simple paths (e.g., 'user.name') and array element paths (e.g., 'wallets.address').
 *
 * @param doc - Document to get value from
 * @param path - Dot-separated path
 * @returns The value at the path, or undefined if not found
 */
function getNestedValue(doc: any, path: string): any {
    const parts = path.split('.');
    let current = doc;

    for (const part of parts) {
        if (current == null) return undefined;

        // If current is an array, search for matching element
        if (Array.isArray(current)) {
            // For array fields, check if any element has the property
            const values = current.map(item => item?.[part]).filter(v => v !== undefined);
            if (values.length > 0) {
                current = values;
                continue;
            }
            return undefined;
        }

        current = current[part];
    }

    // If the final result is an array of values from array traversal, flatten for matching
    if (Array.isArray(current) && current.length === 1) {
        return current[0];
    }

    return current;
}

/**
 * Creates a thenable object that mimics Mongoose Query behavior.
 *
 * Mongoose queries are thenable (have a .then() method), allowing them to be
 * awaited directly without calling .exec(). This helper creates an object that:
 * - Can be awaited directly (via .then())
 * - Still supports .exec() for explicit execution
 *
 * @param resultFn - Function that returns the query result
 * @returns Object with then() and exec() methods
 */
function createThenable<T>(resultFn: () => T | Promise<T>) {
    return {
        then: (resolve: (value: T) => void, reject?: (error: any) => void) => {
            return Promise.resolve(resultFn()).then(resolve, reject);
        },
        exec: vi.fn(async () => resultFn())
    };
}

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
            this.data = data.filter((doc: any) => matchesFilter(doc, filter));
        }
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
        let result = data.find((d: any) => matchesFilter(d, filter));

        return {
            sort: vi.fn((sortSpec: Sort) => {
                // If sorting and multiple matches, re-find with sort
                const matches = data.filter((d: any) => matchesFilter(d, filter));
                if (matches.length > 0) {
                    const sortKey = Object.keys(sortSpec)[0];
                    const sortOrder = (sortSpec as any)[sortKey];
                    matches.sort((a, b) => {
                        if (a[sortKey] < b[sortKey]) return sortOrder === 1 ? -1 : 1;
                        if (a[sortKey] > b[sortKey]) return sortOrder === 1 ? 1 : -1;
                        return 0;
                    });
                    result = matches[0];
                }
                return {
                    lean: vi.fn(() => createThenable(() => result || null))
                };
            }),
            lean: vi.fn(() => createThenable(() => result || null))
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

        return data.filter((doc: any) => matchesFilter(doc, filter)).length;
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
            if (matchesFilter(doc, filter)) {
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
            if (matchesFilter(doc, filter)) {
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
            const doc = data.find((d: any) => matchesFilter(d, filter));
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
                if (matchesFilter(doc, filter)) {
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
            const docIndex = data.findIndex((d: any) => matchesFilter(d, filter));

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
                if (matchesFilter(doc, filter)) {
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

            return data.filter((doc: any) => matchesFilter(doc, filter)).length;
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
 * Mock MongoDB session for transaction support.
 *
 * Provides minimal session API to enable transaction-aware testing without
 * requiring a real MongoDB replica set. The withTransaction() method executes
 * the callback directly and handles errors appropriately.
 */
class MockMongooseSession {
    private _ended = false;

    /**
     * Execute a function within a transaction context.
     *
     * In the mock implementation, simply executes the callback and handles
     * errors. Real transaction commit/rollback is not simulated.
     *
     * @param fn - Async function to execute
     * @returns Promise that resolves when transaction completes
     * @throws Error if callback throws
     */
    public async withTransaction(fn: () => Promise<void>): Promise<void> {
        try {
            await fn();
            // Transaction committed successfully (mock)
        } catch (error) {
            // Transaction rolled back (mock)
            throw error;
        }
    }

    /**
     * End the session.
     *
     * Marks the session as ended. No actual cleanup needed in mock.
     */
    public async endSession(): Promise<void> {
        this._ended = true;
    }

    /**
     * Check if session has been ended.
     */
    public get ended(): boolean {
        return this._ended;
    }
}

/**
 * Create a complete Mongoose module mock.
 *
 * Returns a factory function that can be used with vi.mock('mongoose').
 * Includes full connection, database, Schema support, and transaction mocking.
 *
 * @returns Factory function for Vitest module mocking
 *
 * @example
 * ```typescript
 * // Option 1: With importOriginal (for partial mocking)
 * vi.mock('mongoose', async (importOriginal) => {
 *     const { createMockMongooseModule } = await import('./mocks/mongoose.js');
 *     return createMockMongooseModule()(importOriginal);
 * });
 *
 * // Option 2: Direct usage (full mock)
 * vi.mock('mongoose', () => createMockMongooseModule());
 * ```
 */
export function createMockMongooseModule() {
    // Return a factory that optionally accepts importOriginal
    return (importOriginal?: () => Promise<any>) => ({
        // Mock Schema class (needed for model definitions)
        Schema: class Schema {
            static Types = {
                ObjectId: 'ObjectId',
                String: 'String',
                Number: 'Number',
                Boolean: 'Boolean',
                Date: 'Date',
                Mixed: 'Mixed',
                Array: 'Array'
            };

            constructor(definition: any, options?: any) {
                // No-op in tests - just needs to exist for model definitions
            }
            index(fields: any, options?: any) {
                // No-op in tests - index creation is not needed
                return this;
            }
        },
        // Mock model() function to return MockMongooseModel instances
        model: vi.fn((modelName: string, schema: any, collection?: string) => {
            const collectionName = collection || modelName.toLowerCase() + 's';
            return new MockMongooseModel(modelName, collectionName);
        }),
        default: {
            /**
             * Start a new MongoDB session for transactions.
             *
             * Returns a mock session that supports withTransaction() and endSession().
             */
            startSession: vi.fn(async () => new MockMongooseSession()),

            connection: {
                readyState: 1, // 1 = connected
                db: {
                    collection: createMockCollection,
                    admin: vi.fn(() => ({
                        serverStatus: vi.fn().mockResolvedValue({})
                    }))
                },
                // Mock replica set topology for transaction support detection
                topology: {
                    description: {
                        type: 'ReplicaSetWithPrimary'
                    },
                    s: {
                        options: {
                            replicaSet: 'rs0'
                        }
                    }
                }
            }
        }
    });
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
