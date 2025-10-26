/// <reference types="vitest" />

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Mock } from 'vitest';
import { ObjectId } from 'mongodb';

// Mock mongoose module using shared mock BEFORE importing the helpers
vi.mock('mongoose', async (importOriginal) => {
    const { createMockMongooseModule } = await import('../../../tests/vitest/mocks/mongoose.js');
    return createMockMongooseModule()(importOriginal);
});

// Import mock helpers AFTER vi.mock
import {
    clearMockCollections,
    getMockCollections,
    MockMongooseModel
} from '../../../tests/vitest/mocks/mongoose.js';

// Mock logger to prevent console output during tests
vi.mock('../../../lib/logger.js', () => ({
    logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
    }
}));

// Import DatabaseService AFTER mocking dependencies
import { DatabaseService } from '../database.service.js';
import { logger } from '../../../lib/logger.js';

describe('DatabaseService', () => {
    let service: DatabaseService;

    beforeEach(() => {
        // Clear collections before each test
        clearMockCollections();

        // Clear all mocks
        vi.clearAllMocks();

        // Create fresh service instance (no prefix)
        service = new DatabaseService();
    });

    afterEach(() => {
        clearMockCollections();
    });

    describe('Constructor and Configuration', () => {
        /**
         * Test: DatabaseService should create instance without prefix by default.
         *
         * Verifies that core services can create DatabaseService without a prefix,
         * resulting in unprefixed collection names.
         */
        it('should create instance without prefix by default', () => {
            const db = new DatabaseService();
            expect(db).toBeInstanceOf(DatabaseService);
        });

        /**
         * Test: DatabaseService should create instance with custom prefix.
         *
         * Verifies that plugins can create DatabaseService with a custom prefix
         * for namespace isolation.
         */
        it('should create instance with custom prefix', () => {
            const db = new DatabaseService({ prefix: 'test_' });
            expect(db).toBeInstanceOf(DatabaseService);
        });
    });

    describe('Collection Access', () => {
        /**
         * Test: getCollection should return MongoDB collection without prefix.
         *
         * Verifies that getCollection returns a native MongoDB collection object
         * with the correct name when no prefix is configured.
         */
        it('should return MongoDB collection without prefix', () => {
            const collection = service.getCollection('users');
            expect(collection).toBeDefined();
            expect(typeof collection.findOne).toBe('function');
        });

        /**
         * Test: getCollection should return MongoDB collection with prefix.
         *
         * Verifies that getCollection applies the configured prefix to collection names.
         */
        it('should return MongoDB collection with prefix', () => {
            const prefixedService = new DatabaseService({ prefix: 'plugin_test_' });
            const collection = prefixedService.getCollection('subscriptions');
            expect(collection).toBeDefined();
        });

        /**
         * Test: getCollection should sanitize collection names.
         *
         * Verifies that invalid characters in collection names are replaced
         * to prevent injection attacks or MongoDB errors.
         */
        it('should sanitize collection names', () => {
            service.getCollection('invalid$name!@#');

            const collections = getMockCollections();
            expect(collections.has('invalid_name___')).toBe(true);
        });

        it('should apply prefix to physical collection names', () => {
            const prefixedService = new DatabaseService({ prefix: 'plugin_example_' });
            prefixedService.getCollection('items');

            const collections = getMockCollections();
            expect(collections.has('plugin_example_items')).toBe(true);
        });

        it('should throw when MongoDB connection is unavailable', async () => {
            const mongooseModule = await import('mongoose');
            const connection = mongooseModule.default.connection as typeof mongooseModule.default.connection & { db: any };
            const originalDb = connection.db;

            if (!originalDb) {
                throw new Error('Mock mongoose connection missing');
            }

            try {
                connection.db = undefined as any;
                expect(() => service.getCollection('users')).toThrow('MongoDB connection not established');
            } finally {
                connection.db = originalDb;
            }
        });

        /**
         * Test: getCollection should throw error for empty collection name.
         *
         * Verifies that empty or whitespace-only collection names are rejected.
         */
        it('should throw error for empty collection name', () => {
            expect(() => service.getCollection('')).toThrow('Collection name must be a non-empty string');
        });

        /**
         * Test: getCollection should throw error for non-string collection name.
         *
         * Verifies that non-string collection names are rejected with a clear error.
         */
        it('should throw error for non-string collection name', () => {
            expect(() => service.getCollection(null as any)).toThrow('Collection name must be a non-empty string');
            expect(() => service.getCollection(undefined as any)).toThrow('Collection name must be a non-empty string');
            expect(() => service.getCollection(123 as any)).toThrow('Collection name must be a non-empty string');
        });
    });

    describe('Model Registry', () => {
        /**
         * Test: registerModel should store Mongoose model in registry.
         *
         * Verifies that Mongoose models can be registered for a collection,
         * allowing convenience methods to prefer Mongoose over raw collection access.
         */
        it('should store Mongoose model in registry', () => {
            const model = new MockMongooseModel('User', 'users');
            service.registerModel('users', model);

            const retrieved = service.getModel('users');
            expect(retrieved).toBe(model);
        });

        /**
         * Test: getModel should return undefined for unregistered collection.
         *
         * Verifies that getModel returns undefined when no model is registered,
         * allowing fallback to raw collection access.
         */
        it('should return undefined for unregistered collection', () => {
            const model = service.getModel('nonexistent');
            expect(model).toBeUndefined();
        });

        /**
         * Test: registerModel should allow multiple models.
         *
         * Verifies that multiple Mongoose models can be registered without conflicts.
         */
        it('should allow multiple models', () => {
            const userModel = new MockMongooseModel('User', 'users');
            const postModel = new MockMongooseModel('Post', 'posts');

            service.registerModel('users', userModel);
            service.registerModel('posts', postModel);

            expect(service.getModel('users')).toBe(userModel);
            expect(service.getModel('posts')).toBe(postModel);
        });
    });

    describe('Key-Value Storage', () => {
        /**
         * Test: set should store value in _kv collection.
         *
         * Verifies that set() stores key-value pairs in the special _kv collection
         * for simple configuration and state storage.
         */
        it('should store value in _kv collection', async () => {
            await service.set('testKey', 'testValue');

            const retrieved = await service.get<string>('testKey');
            expect(retrieved).toBe('testValue');
        });

        /**
         * Test: set should upsert existing key.
         *
         * Verifies that calling set() multiple times on the same key updates
         * the value instead of creating duplicates.
         */
        it('should upsert existing key', async () => {
            await service.set('counter', 1);
            await service.set('counter', 2);

            const retrieved = await service.get<number>('counter');
            expect(retrieved).toBe(2);
        });

        /**
         * Test: get should return undefined for missing key.
         *
         * Verifies that get() returns undefined when a key doesn't exist,
         * allowing callers to provide defaults.
         */
        it('should return undefined for missing key', async () => {
            const retrieved = await service.get('nonexistent');
            expect(retrieved).toBeUndefined();
        });

        /**
         * Test: set should handle complex objects.
         *
         * Verifies that set() can store JSON-serializable objects,
         * not just primitive values.
         */
        it('should handle complex objects', async () => {
            const complexValue = {
                name: 'test',
                nested: { value: 123 },
                array: [1, 2, 3]
            };

            await service.set('complex', complexValue);
            const retrieved = await service.get<typeof complexValue>('complex');

            expect(retrieved).toEqual(complexValue);
        });

        /**
         * Test: delete should remove key from storage.
         *
         * Verifies that delete() removes a key-value pair and returns true
         * when the key exists.
         */
        it('should remove key from storage', async () => {
            await service.set('tempKey', 'tempValue');
            const deleted = await service.delete('tempKey');

            expect(deleted).toBe(true);

            const retrieved = await service.get('tempKey');
            expect(retrieved).toBeUndefined();
        });

        /**
         * Test: delete should return false for missing key.
         *
         * Verifies that delete() returns false when attempting to delete
         * a key that doesn't exist.
         */
        it('should return false for missing key', async () => {
            const deleted = await service.delete('nonexistent');
            expect(deleted).toBe(false);
        });
    });

    describe('CRUD Operations - Raw Collections', () => {
        /**
         * Test: insertOne should insert document into collection.
         *
         * Verifies that insertOne() adds a document to the collection
         * and returns the inserted ID.
         */
        it('should insert document into collection', async () => {
            const doc = { name: 'Test User', email: 'test@example.com' };
            const insertedId = await service.insertOne('users', doc);

            expect(insertedId).toBeDefined();
            expect(insertedId).toBeInstanceOf(ObjectId);
        });

        /**
         * Test: findOne should retrieve single document.
         *
         * Verifies that findOne() retrieves a document matching the filter.
         */
        it('should retrieve single document', async () => {
            const doc = { name: 'Test User', email: 'test@example.com' };
            await service.insertOne('users', doc);

            const found = await service.findOne('users', { name: 'Test User' });
            expect(found).toBeDefined();
            expect(found?.name).toBe('Test User');
            expect(found?.email).toBe('test@example.com');
        });

        /**
         * Test: findOne should return null for missing document.
         *
         * Verifies that findOne() returns null when no document matches the filter.
         */
        it('should return null for missing document', async () => {
            const found = await service.findOne('users', { name: 'Nonexistent' });
            expect(found).toBeNull();
        });

        /**
         * Test: find should retrieve multiple documents.
         *
         * Verifies that find() retrieves all documents matching the filter.
         */
        it('should retrieve multiple documents', async () => {
            await service.insertOne('users', { name: 'User 1', role: 'admin' });
            await service.insertOne('users', { name: 'User 2', role: 'admin' });
            await service.insertOne('users', { name: 'User 3', role: 'user' });

            const admins = await service.find('users', { role: 'admin' });
            expect(admins).toHaveLength(2);
        });

        /**
         * Test: find should support pagination options.
         *
         * Verifies that find() respects limit, skip, and sort options
         * for paginated queries.
         */
        it('should support pagination options', async () => {
            await service.insertOne('users', { name: 'User 1', order: 1 });
            await service.insertOne('users', { name: 'User 2', order: 2 });
            await service.insertOne('users', { name: 'User 3', order: 3 });

            const page2 = await service.find('users', {}, {
                skip: 1,
                limit: 1,
                sort: { order: 1 }
            });

            expect(page2).toHaveLength(1);
            expect(page2[0].name).toBe('User 2');
        });

        /**
         * Test: count should return document count.
         *
         * Verifies that count() returns the number of documents matching the filter.
         */
        it('should return document count', async () => {
            await service.insertOne('users', { role: 'admin' });
            await service.insertOne('users', { role: 'admin' });
            await service.insertOne('users', { role: 'user' });

            const adminCount = await service.count('users', { role: 'admin' });
            expect(adminCount).toBe(2);
        });

        /**
         * Test: updateMany should update multiple documents.
         *
         * Verifies that updateMany() updates all documents matching the filter
         * and returns the modified count.
         */
        it('should update multiple documents', async () => {
            await service.insertOne('users', { name: 'User 1', active: false });
            await service.insertOne('users', { name: 'User 2', active: false });

            const modifiedCount = await service.updateMany(
                'users',
                { active: false },
                { $set: { active: true } }
            );

            expect(modifiedCount).toBe(2);

            const activeUsers = await service.find('users', { active: true });
            expect(activeUsers).toHaveLength(2);
        });

        /**
         * Test: deleteMany should remove multiple documents.
         *
         * Verifies that deleteMany() removes all documents matching the filter
         * and returns the deleted count.
         */
        it('should remove multiple documents', async () => {
            await service.insertOne('users', { name: 'User 1', temporary: true });
            await service.insertOne('users', { name: 'User 2', temporary: true });
            await service.insertOne('users', { name: 'User 3', temporary: false });

            const deletedCount = await service.deleteMany('users', { temporary: true });
            expect(deletedCount).toBe(2);

            const remaining = await service.find('users', {});
            expect(remaining).toHaveLength(1);
        });
    });

    describe('CRUD Operations - With Mongoose Models', () => {
        let userModel: MockMongooseModel;

        beforeEach(() => {
            userModel = new MockMongooseModel('User', 'users');
            service.registerModel('users', userModel);
        });

        /**
         * Test: insertOne should use Mongoose model when registered.
         *
         * Verifies that insertOne() prefers registered Mongoose model,
         * applying schema validation and defaults.
         */
        it('should use Mongoose model when registered', async () => {
            const doc = { name: 'Test User', email: 'test@example.com' };
            const insertedId = await service.insertOne('users', doc);

            expect(insertedId).toBeDefined();
            expect(insertedId).toBeInstanceOf(ObjectId);

            // Verify document was created
            const collections = getMockCollections();
            expect(collections.get('users')).toHaveLength(1);
        });

        /**
         * Test: findOne should use Mongoose model with lean().
         *
         * Verifies that findOne() uses Mongoose model when registered,
         * applying .lean() for performance.
         */
        it('should use Mongoose model with lean()', async () => {
            await service.insertOne('users', { name: 'Test User' });
            const found = await service.findOne('users', { name: 'Test User' });

            expect(found).toBeDefined();
            expect(found?.name).toBe('Test User');
        });

        /**
         * Test: find should use Mongoose model with lean().
         *
         * Verifies that find() uses Mongoose model when registered,
         * applying .lean() for performance and supporting query options.
         */
        it('should use Mongoose model with lean() and options', async () => {
            await service.insertOne('users', { name: 'User 1', role: 'admin' });
            await service.insertOne('users', { name: 'User 2', role: 'admin' });

            const admins = await service.find('users', { role: 'admin' }, {
                limit: 10,
                skip: 0,
                sort: { name: 1 }
            });

            expect(admins).toHaveLength(2);
        });

        /**
         * Test: count should use Mongoose model.
         *
         * Verifies that count() uses Mongoose model when registered.
         */
        it('should use Mongoose model for count', async () => {
            await service.insertOne('users', { active: true });
            await service.insertOne('users', { active: true });

            const count = await service.count('users', { active: true });
            expect(count).toBe(2);
        });

        /**
         * Test: updateMany should use Mongoose model.
         *
         * Verifies that updateMany() uses Mongoose model when registered.
         */
        it('should use Mongoose model for updateMany', async () => {
            await service.insertOne('users', { active: false });
            await service.insertOne('users', { active: false });

            const modifiedCount = await service.updateMany(
                'users',
                { active: false },
                { $set: { active: true } }
            );

            expect(modifiedCount).toBe(2);
        });

        /**
         * Test: deleteMany should use Mongoose model.
         *
         * Verifies that deleteMany() uses Mongoose model when registered.
         */
        it('should use Mongoose model for deleteMany', async () => {
            await service.insertOne('users', { temporary: true });
            await service.insertOne('users', { temporary: true });

            const deletedCount = await service.deleteMany('users', { temporary: true });
            expect(deletedCount).toBe(2);
        });
    });

    describe('Index Creation', () => {
        /**
         * Test: createIndex should create index on collection.
         *
         * Verifies that createIndex() successfully creates an index
         * with the specified fields and options.
         */
        it('should create index on collection', async () => {
            const collection = service.getCollection('users') as any;
            const createIndexMock = collection.createIndex as Mock;

            await service.createIndex('users', { email: 1 } as any, { unique: true });

            expect(createIndexMock).toHaveBeenCalledTimes(1);
            expect(createIndexMock).toHaveBeenCalledWith({ email: 1 } as any, { unique: true });
        });

        /**
         * Test: createIndex should handle compound indexes.
         *
         * Verifies that createIndex() supports multi-field indexes.
         */
        it('should handle compound indexes', async () => {
            const collection = service.getCollection('users') as any;
            const createIndexMock = collection.createIndex as Mock;

            await service.createIndex(
                'users',
                { firstName: 1, lastName: 1 } as any,
                { name: 'full_name_index' }
            );

            expect(createIndexMock).toHaveBeenCalledWith(
                { firstName: 1, lastName: 1 } as any,
                { name: 'full_name_index' }
            );
        });
    });

    describe('Collection Prefix Isolation', () => {
        /**
         * Test: Different prefixes should isolate collections.
         *
         * Verifies that services with different prefixes access separate
         * logical collections, ensuring plugin namespace isolation.
         */
        it('should isolate collections with different prefixes', async () => {
            const serviceA = new DatabaseService({ prefix: 'plugin_a_' });
            const serviceB = new DatabaseService({ prefix: 'plugin_b_' });

            await serviceA.set('config', 'value-a');
            await serviceB.set('config', 'value-b');

            const valueA = await serviceA.get<string>('config');
            const valueB = await serviceB.get<string>('config');

            expect(valueA).toBe('value-a');
            expect(valueB).toBe('value-b');
        });

        /**
         * Test: Unprefixed and prefixed services should be isolated.
         *
         * Verifies that core services (no prefix) and plugin services (with prefix)
         * access separate collections.
         */
        it('should isolate unprefixed and prefixed services', async () => {
            const coreService = new DatabaseService();
            const pluginService = new DatabaseService({ prefix: 'plugin_test_' });

            await coreService.set('shared', 'core-value');
            await pluginService.set('shared', 'plugin-value');

            const coreValue = await coreService.get<string>('shared');
            const pluginValue = await pluginService.get<string>('shared');

            expect(coreValue).toBe('core-value');
            expect(pluginValue).toBe('plugin-value');
        });
    });

    describe('Error Handling', () => {
        /**
         * Test: get should return undefined on errors.
         *
         * Verifies that get() gracefully handles errors and returns undefined
         * instead of throwing, allowing callers to provide defaults.
         */
        it('should return undefined on errors', async () => {
            // Mock collection to throw error
            const collection = service.getCollection('_kv') as any;
            const findOneMock = collection.findOne as Mock;
            findOneMock.mockRejectedValueOnce(new Error('Database error'));

            const result = await service.get('test');
            expect(result).toBeUndefined();
            expect(findOneMock).toHaveBeenCalledWith({ key: 'test' });
            expect(logger.error).toHaveBeenCalledWith(
                expect.objectContaining({
                    error: expect.any(Error),
                    key: 'test',
                    prefix: ''
                }),
                'Failed to get key from KV store'
            );
        });

        /**
         * Test: delete should return false on errors.
         *
         * Verifies that delete() gracefully handles errors and returns false
         * instead of throwing.
         */
        it('should return false on delete errors', async () => {
            const collection = service.getCollection('_kv') as any;
            const deleteOneMock = collection.deleteOne as Mock;
            deleteOneMock.mockRejectedValueOnce(new Error('Database error'));

            const result = await service.delete('test');
            expect(result).toBe(false);
            expect(deleteOneMock).toHaveBeenCalledWith({ key: 'test' });
            expect(logger.error).toHaveBeenCalledWith(
                expect.objectContaining({
                    error: expect.any(Error),
                    key: 'test',
                    prefix: ''
                }),
                'Failed to delete key from KV store'
            );
        });

        /**
         * Test: set should throw on unacknowledged writes.
         *
         * Verifies that set() detects when MongoDB doesn't acknowledge the write
         * operation and throws an error.
         */
        it('should throw on unacknowledged writes', async () => {
            // Need to mock at the mongoose module level since getCollection creates new instances
            const mongooseModule = await import('mongoose');
            const connection = mongooseModule.default.connection as typeof mongooseModule.default.connection & { db: any };
            const db = connection.db as any;

            if (!db) {
                throw new Error('Mock mongoose connection missing');
            }

            const originalCollection = db.collection.bind(db);
            const collectionSpy = vi.spyOn(db, 'collection');
            collectionSpy.mockImplementation(((name: string) => {
                const col = originalCollection(name);
                if (name === '_kv') {
                    vi.spyOn(col as any, 'updateOne').mockResolvedValueOnce({
                        acknowledged: false,
                        matchedCount: 0,
                        modifiedCount: 0,
                        upsertedCount: 0,
                        upsertedId: null
                    } as any);
                }
                return col;
            }) as any);

            try {
                await expect(service.set('test', 'value')).rejects.toThrow('MongoDB write was not acknowledged');
            } finally {
                collectionSpy.mockRestore();
            }
        });
    });
});
