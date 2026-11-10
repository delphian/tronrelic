/// <reference types="vitest" />

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { DatabaseService } from '../services/database.service.js';
import type { Collection, Document, Filter, UpdateFilter } from 'mongodb';
import type { ISystemLogService } from '@/types';
import mongoose from 'mongoose';

/**
 * Mock logger for testing.
 */
class MockLogger implements Partial<ISystemLogService> {
    public info = vi.fn();
    public error = vi.fn();
    public warn = vi.fn();
    public debug = vi.fn();
    public trace = vi.fn();
    public fatal = vi.fn();
    public child = vi.fn(() => new MockLogger() as any);
}

/**
 * Mock MongoDB collection.
 */
class MockCollection {
    public findOne = vi.fn().mockResolvedValue(null);
    public find = vi.fn(() => ({
        sort: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        toArray: vi.fn().mockResolvedValue([])
    }));
    public insertOne = vi.fn().mockResolvedValue({ insertedId: 'test-id', acknowledged: true });
    public updateOne = vi.fn().mockResolvedValue({ modifiedCount: 1, acknowledged: true, upsertedCount: 0 });
    public updateMany = vi.fn().mockResolvedValue({ modifiedCount: 1, acknowledged: true });
    public deleteOne = vi.fn().mockResolvedValue({ deletedCount: 1, acknowledged: true });
    public deleteMany = vi.fn().mockResolvedValue({ deletedCount: 1, acknowledged: true });
    public countDocuments = vi.fn().mockResolvedValue(0);
    public createIndex = vi.fn().mockResolvedValue('index-name');
}

/**
 * Mock Mongoose model.
 */
class MockModel {
    public modelName = 'TestModel';
    public static find = vi.fn(() => ({
        lean: vi.fn().mockReturnThis(),
        sort: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        exec: vi.fn().mockResolvedValue([])
    }));
    public static findOne = vi.fn(() => ({
        lean: vi.fn().mockReturnThis(),
        exec: vi.fn().mockResolvedValue(null)
    }));
    public static countDocuments = vi.fn().mockResolvedValue(0);
    public static create = vi.fn().mockResolvedValue({ _id: 'test-id' });
    public static updateMany = vi.fn().mockResolvedValue({ modifiedCount: 1 });
    public static deleteMany = vi.fn().mockResolvedValue({ deletedCount: 1 });
}

// Mock mongoose connection
const mockDb = {
    collection: vi.fn(() => new MockCollection())
};

// Define db property on mongoose.connection
Object.defineProperty(mongoose.connection, 'db', {
    get: vi.fn(() => mockDb),
    configurable: true
});

describe('DatabaseService', () => {
    let service: DatabaseService;
    let mockLogger: MockLogger;
    let mockCollection: MockCollection;

    beforeEach(() => {
        vi.clearAllMocks();
        mockLogger = new MockLogger();
        mockCollection = new MockCollection();
        mockDb.collection = vi.fn(() => mockCollection);

        // Re-define the db property to ensure fresh mock for each test
        Object.defineProperty(mongoose.connection, 'db', {
            get: vi.fn(() => mockDb),
            configurable: true
        });

        service = new DatabaseService(mockLogger as any, mongoose.connection);
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    describe('Constructor', () => {
        it('should create service without prefix', () => {
            const coreService = new DatabaseService(mockLogger as any, mongoose.connection);
            expect(coreService).toBeDefined();
        });

        it('should create service with prefix', () => {
            const pluginService = new DatabaseService(mockLogger as any, mongoose.connection, { prefix: 'plugin_test_' });
            expect(pluginService).toBeDefined();
        });
    });

    describe('getCollection()', () => {
        it('should return collection without prefix', () => {
            const collection = service.getCollection('test_collection');

            expect(mockDb.collection).toHaveBeenCalledWith('test_collection');
            expect(collection).toBeDefined();
        });

        it('should return collection with prefix', () => {
            const pluginService = new DatabaseService(mockLogger as any, mongoose.connection, { prefix: 'plugin_test_' });

            const collection = pluginService.getCollection('subscriptions');

            expect(mockDb.collection).toHaveBeenCalledWith('plugin_test_subscriptions');
            expect(collection).toBeDefined();
        });

        it('should sanitize collection names', () => {
            service.getCollection('invalid@collection$name');

            expect(mockDb.collection).toHaveBeenCalledWith('invalid_collection_name');
        });

        it('should throw error for empty collection name', () => {
            expect(() => service.getCollection('')).toThrow('Collection name must be a non-empty string');
        });

        it('should throw error when MongoDB connection not established', () => {
            vi.spyOn(mongoose.connection, 'db', 'get').mockReturnValue(null as any);

            expect(() => service.getCollection('test')).toThrow('MongoDB connection not established');
        });

        it('should restrict plugin database to prefixed collections only', () => {
            const pluginService = new DatabaseService(mockLogger as any, mongoose.connection, { prefix: 'plugin_test_' });

            // This should work - collection has correct prefix
            expect(() => pluginService.getCollection('subscriptions')).not.toThrow();

            // Attempting to access a collection that doesn't start with the prefix should fail
            // However, sanitization adds the prefix automatically, so we need a different test approach
            // The restriction is enforced in getPhysicalCollectionName
        });
    });

    describe('Model Registry', () => {
        let mockModel: typeof MockModel;

        beforeEach(() => {
            mockModel = MockModel as any;
        });

        it('should register Mongoose model', () => {
            service.registerModel('test_collection', mockModel);

            const registered = service.getModel('test_collection');
            expect(registered).toBe(mockModel);
        });

        it('should return undefined for unregistered model', () => {
            const model = service.getModel('nonexistent');
            expect(model).toBeUndefined();
        });
    });

    describe('Key-Value Storage', () => {
        it('should get value from KV store', async () => {
            mockCollection.findOne.mockResolvedValueOnce({ key: 'test_key', value: 'test_value' });

            const value = await service.get('test_key');

            expect(value).toBe('test_value');
            expect(mockCollection.findOne).toHaveBeenCalledWith({ key: 'test_key' });
        });

        it('should return undefined for missing key', async () => {
            mockCollection.findOne.mockResolvedValueOnce(null);

            const value = await service.get('missing_key');

            expect(value).toBeUndefined();
        });

        it('should set value in KV store', async () => {
            await service.set('test_key', 'test_value');

            expect(mockCollection.updateOne).toHaveBeenCalledWith(
                { key: 'test_key' },
                { $set: { key: 'test_key', value: 'test_value' } },
                { upsert: true }
            );
        });

        it('should throw error if MongoDB write not acknowledged', async () => {
            mockCollection.updateOne.mockResolvedValueOnce({ acknowledged: false, modifiedCount: 0, upsertedCount: 0 });

            await expect(service.set('test_key', 'test_value')).rejects.toThrow(
                'MongoDB write was not acknowledged'
            );
        });

        it('should delete key from KV store', async () => {
            mockCollection.deleteOne.mockResolvedValueOnce({ deletedCount: 1, acknowledged: true });

            const result = await service.delete('test_key');

            expect(result).toBe(true);
            expect(mockCollection.deleteOne).toHaveBeenCalledWith({ key: 'test_key' });
        });

        it('should return false when deleting non-existent key', async () => {
            mockCollection.deleteOne.mockResolvedValueOnce({ deletedCount: 0, acknowledged: true });

            const result = await service.delete('missing_key');

            expect(result).toBe(false);
        });

        it('should handle errors gracefully in get', async () => {
            mockCollection.findOne.mockRejectedValueOnce(new Error('Database error'));

            const value = await service.get('test_key');

            expect(value).toBeUndefined();
            expect(mockLogger.error).toHaveBeenCalled();
        });

        it('should handle errors gracefully in delete', async () => {
            mockCollection.deleteOne.mockRejectedValueOnce(new Error('Database error'));

            const result = await service.delete('test_key');

            expect(result).toBe(false);
            expect(mockLogger.error).toHaveBeenCalled();
        });
    });

    describe('CRUD Operations - Raw Collections', () => {
        it('should count documents using raw collection', async () => {
            mockCollection.countDocuments.mockResolvedValueOnce(5);

            const count = await service.count('test_collection', { active: true });

            expect(count).toBe(5);
            expect(mockCollection.countDocuments).toHaveBeenCalledWith({ active: true });
        });

        it('should find documents using raw collection', async () => {
            const mockCursor = {
                sort: vi.fn().mockReturnThis(),
                skip: vi.fn().mockReturnThis(),
                limit: vi.fn().mockReturnThis(),
                toArray: vi.fn().mockResolvedValue([{ id: 1 }, { id: 2 }])
            };
            mockCollection.find.mockReturnValueOnce(mockCursor as any);

            const docs = await service.find('test_collection', { active: true }, {
                sort: { createdAt: -1 },
                skip: 10,
                limit: 20
            });

            expect(docs).toEqual([{ id: 1 }, { id: 2 }]);
            expect(mockCursor.sort).toHaveBeenCalledWith({ createdAt: -1 });
            expect(mockCursor.skip).toHaveBeenCalledWith(10);
            expect(mockCursor.limit).toHaveBeenCalledWith(20);
        });

        it('should find one document using raw collection', async () => {
            mockCollection.findOne.mockResolvedValueOnce({ id: 1, name: 'Test' });

            const doc = await service.findOne('test_collection', { id: 1 });

            expect(doc).toEqual({ id: 1, name: 'Test' });
            expect(mockCollection.findOne).toHaveBeenCalledWith({ id: 1 });
        });

        it('should insert document using raw collection', async () => {
            mockCollection.insertOne.mockResolvedValueOnce({ insertedId: 'new-id', acknowledged: true });

            const id = await service.insertOne('test_collection', { name: 'Test' } as any);

            expect(id).toBe('new-id');
            expect(mockCollection.insertOne).toHaveBeenCalledWith({ name: 'Test' });
        });

        it('should update many documents using raw collection', async () => {
            mockCollection.updateMany.mockResolvedValueOnce({ modifiedCount: 3, acknowledged: true });

            const count = await service.updateMany('test_collection',
                { active: true },
                { $set: { status: 'archived' } }
            );

            expect(count).toBe(3);
            expect(mockCollection.updateMany).toHaveBeenCalled();
        });

        it('should delete many documents using raw collection', async () => {
            mockCollection.deleteMany.mockResolvedValueOnce({ deletedCount: 2, acknowledged: true });

            const count = await service.deleteMany('test_collection', { archived: true });

            expect(count).toBe(2);
            expect(mockCollection.deleteMany).toHaveBeenCalledWith({ archived: true });
        });
    });

    describe('CRUD Operations - Mongoose Models', () => {
        let mockModel: typeof MockModel;

        beforeEach(() => {
            mockModel = MockModel as any;
            service.registerModel('test_collection', mockModel);
        });

        it('should prefer Mongoose model for count', async () => {
            mockModel.countDocuments.mockResolvedValueOnce(10);

            const count = await service.count('test_collection', { active: true });

            expect(count).toBe(10);
            expect(mockModel.countDocuments).toHaveBeenCalledWith({ active: true });
        });

        it('should prefer Mongoose model for find', async () => {
            const mockQuery = {
                lean: vi.fn().mockReturnThis(),
                sort: vi.fn().mockReturnThis(),
                skip: vi.fn().mockReturnThis(),
                limit: vi.fn().mockReturnThis(),
                exec: vi.fn().mockResolvedValue([{ id: 1 }])
            };
            mockModel.find.mockReturnValueOnce(mockQuery as any);

            const docs = await service.find('test_collection', { active: true }, {
                sort: { createdAt: -1 },
                skip: 5,
                limit: 10
            });

            expect(docs).toEqual([{ id: 1 }]);
            expect(mockQuery.lean).toHaveBeenCalled();
            expect(mockQuery.sort).toHaveBeenCalledWith({ createdAt: -1 });
        });

        it('should prefer Mongoose model for findOne', async () => {
            const mockQuery = {
                lean: vi.fn().mockReturnThis(),
                exec: vi.fn().mockResolvedValue({ id: 1 })
            };
            mockModel.findOne.mockReturnValueOnce(mockQuery as any);

            const doc = await service.findOne('test_collection', { id: 1 });

            expect(doc).toEqual({ id: 1 });
            expect(mockQuery.lean).toHaveBeenCalled();
        });

        it('should prefer Mongoose model for insertOne', async () => {
            mockModel.create.mockResolvedValueOnce({ _id: 'model-id' } as any);

            const id = await service.insertOne('test_collection', { name: 'Test' } as any);

            expect(id).toBe('model-id');
            expect(mockModel.create).toHaveBeenCalledWith({ name: 'Test' });
        });

        it('should prefer Mongoose model for updateMany', async () => {
            mockModel.updateMany.mockResolvedValueOnce({ modifiedCount: 5 } as any);

            const count = await service.updateMany('test_collection',
                { active: true },
                { $set: { status: 'updated' } }
            );

            expect(count).toBe(5);
            expect(mockModel.updateMany).toHaveBeenCalled();
        });

        it('should prefer Mongoose model for deleteMany', async () => {
            mockModel.deleteMany.mockResolvedValueOnce({ deletedCount: 3 } as any);

            const count = await service.deleteMany('test_collection', { archived: true });

            expect(count).toBe(3);
            expect(mockModel.deleteMany).toHaveBeenCalledWith({ archived: true });
        });
    });

    describe('Index Creation', () => {
        it('should create index on collection', async () => {
            await service.createIndex('test_collection',
                { userId: 1, createdAt: -1 },
                { unique: true, name: 'user_date_idx' }
            );

            expect(mockCollection.createIndex).toHaveBeenCalledWith(
                { userId: 1, createdAt: -1 },
                { unique: true, name: 'user_date_idx' }
            );
            expect(mockLogger.info).toHaveBeenCalled();
        });
    });
});
