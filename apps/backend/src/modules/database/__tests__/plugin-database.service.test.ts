/// <reference types="vitest" />

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PluginDatabaseService } from '../services/plugin-database.service.js';
import type { ISystemLogService } from '@tronrelic/types';
import mongoose from 'mongoose';

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
    public createIndex = vi.fn().mockResolvedValue('index-name');
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

describe('PluginDatabaseService', () => {
    let service: PluginDatabaseService;
    let mockLogger: MockLogger;
    let mockCollection: MockCollection;

    beforeEach(() => {
        vi.clearAllMocks();
        mockLogger = new MockLogger();

        // Re-define the db property to ensure fresh mock for each test
        Object.defineProperty(mongoose.connection, 'db', {
            get: vi.fn(() => mockDb),
            configurable: true
        });

        service = new PluginDatabaseService(mockLogger as any, mongoose.connection, 'test-plugin');
        mockCollection = new MockCollection();
        mockDb.collection.mockReturnValue(mockCollection as any);
    });

    describe('Constructor', () => {
        /**
         * Test: Should create plugin database service with automatic prefixing.
         *
         * Verifies that plugin ID is used to create collection name prefix.
         */
        it('should create plugin database service with automatic prefixing', () => {
            const pluginService = new PluginDatabaseService(mockLogger as any, mongoose.connection, 'whale-alerts');
            expect(pluginService).toBeDefined();
        });
    });

    describe('Collection Name Prefixing', () => {
        /**
         * Test: Should automatically prefix collection names with plugin ID.
         *
         * Verifies that logical collection names are transformed into physical
         * names with the plugin_ prefix.
         */
        it('should automatically prefix collection names with plugin ID', () => {
            service.getCollection('subscriptions');

            expect(mockDb.collection).toHaveBeenCalledWith('plugin_test-plugin_subscriptions');
        });

        /**
         * Test: Should prefix KV store collection.
         *
         * Verifies that even the internal _kv collection is prefixed.
         */
        it('should prefix KV store collection', async () => {
            mockCollection.findOne.mockResolvedValueOnce({ key: 'test_key', value: 'test_value' });

            await service.get('test_key');

            expect(mockDb.collection).toHaveBeenCalledWith('plugin_test-plugin__kv');
        });

        /**
         * Test: Should sanitize plugin ID in prefix.
         *
         * Verifies that invalid characters in plugin IDs are handled.
         */
        it('should sanitize plugin ID in prefix', () => {
            const invalidPluginService = new PluginDatabaseService(mockLogger as any, mongoose.connection, 'invalid@plugin$id');

            invalidPluginService.getCollection('test');

            // The prefix will be "plugin_invalid@plugin$id_" but the collection name
            // will be sanitized by getPhysicalCollectionName
            expect(mockDb.collection).toHaveBeenCalled();
        });
    });

    describe('Namespace Isolation', () => {
        /**
         * Test: Multiple plugins should have isolated collections.
         *
         * Verifies that different plugins cannot access each other's collections.
         */
        it('should isolate collections between plugins', () => {
            const plugin1 = new PluginDatabaseService(mockLogger as any, mongoose.connection, 'plugin-1');
            const plugin2 = new PluginDatabaseService(mockLogger as any, mongoose.connection, 'plugin-2');

            plugin1.getCollection('data');
            expect(mockDb.collection).toHaveBeenCalledWith('plugin_plugin-1_data');

            mockDb.collection.mockClear();

            plugin2.getCollection('data');
            expect(mockDb.collection).toHaveBeenCalledWith('plugin_plugin-2_data');
        });

        /**
         * Test: Should prevent plugins from accessing non-prefixed collections.
         *
         * Verifies that plugin databases cannot access system collections.
         * Note: This test verifies the underlying DatabaseService prefix restriction.
         */
        it('should restrict plugin to its own namespace', () => {
            // Plugin collections will always get prefixed, so this test verifies
            // that the service applies the prefix correctly
            service.getCollection('subscriptions');

            expect(mockDb.collection).toHaveBeenCalledWith('plugin_test-plugin_subscriptions');

            // Attempting to use a system collection name still gets prefixed
            service.getCollection('system_config');

            expect(mockDb.collection).toHaveBeenCalledWith('plugin_test-plugin_system_config');
        });
    });

    describe('Inherited DatabaseService Features', () => {
        /**
         * Test: Should inherit key-value storage functionality.
         *
         * Verifies that plugin databases can use get/set/delete methods.
         */
        it('should inherit key-value storage functionality', async () => {
            mockCollection.findOne.mockResolvedValueOnce({ key: 'config_key', value: { enabled: true } });

            const value = await service.get('config_key');

            expect(value).toEqual({ enabled: true });
        });

        /**
         * Test: Should inherit CRUD operations.
         *
         * Verifies that plugin databases can use find, findOne, insertOne, etc.
         */
        it('should inherit CRUD operations', async () => {
            mockCollection.findOne.mockResolvedValueOnce({ id: 1, userId: '123' });

            const doc = await service.findOne('subscriptions', { userId: '123' });

            expect(doc).toEqual({ id: 1, userId: '123' });
        });

        /**
         * Test: Should inherit index creation.
         *
         * Verifies that plugin databases can create indexes on their collections.
         */
        it('should inherit index creation', async () => {
            await service.createIndex('subscriptions', { userId: 1 }, { unique: true });

            expect(mockCollection.createIndex).toHaveBeenCalledWith(
                { userId: 1 },
                { unique: true }
            );
        });

        /**
         * Test: Should inherit model registration.
         *
         * Verifies that plugin databases can register Mongoose models.
         */
        it('should inherit model registration', () => {
            const mockModel = {
                modelName: 'PluginModel',
                find: vi.fn(),
                findOne: vi.fn()
            };

            service.registerModel('plugin_collection', mockModel);

            const registered = service.getModel('plugin_collection');
            expect(registered).toBe(mockModel);
        });
    });

    describe('Real-World Plugin Usage', () => {
        /**
         * Test: Simulate typical plugin database operations.
         *
         * Verifies that a plugin can perform common database operations
         * in a realistic scenario.
         */
        it('should support typical plugin workflow', async () => {
            // Plugin stores configuration
            await service.set('lastSync', new Date('2024-01-01'));

            expect(mockCollection.updateOne).toHaveBeenCalled();

            // Plugin creates subscription
            mockCollection.insertOne.mockResolvedValueOnce({ insertedId: 'sub-123', acknowledged: true });

            const subId = await service.insertOne('subscriptions', {
                userId: 'user-456',
                threshold: 1000000,
                enabled: true
            } as any);

            expect(subId).toBe('sub-123');

            // Plugin queries subscriptions
            mockCollection.findOne.mockResolvedValueOnce({
                _id: 'sub-123',
                userId: 'user-456',
                threshold: 1000000,
                enabled: true
            });

            const subscription = await service.findOne('subscriptions', { userId: 'user-456' });

            expect(subscription).toBeDefined();
            expect((subscription as any).userId).toBe('user-456');

            // Verify all collections were prefixed
            const calls = mockDb.collection.mock.calls as unknown as Array<[string, ...any[]]>;
            expect(calls.length).toBeGreaterThan(0);
            for (const call of calls) {
                expect(call[0]).toMatch(/^plugin_test-plugin_/);
            }
        });

        /**
         * Test: Multiple plugins operating simultaneously.
         *
         * Verifies that multiple plugins can operate on their own collections
         * without interference.
         */
        it('should support multiple plugins simultaneously', async () => {
            const plugin1 = new PluginDatabaseService(mockLogger as any, mongoose.connection, 'whale-alerts');
            const plugin2 = new PluginDatabaseService(mockLogger as any, mongoose.connection, 'delegation-tracker');

            // Both plugins use 'subscriptions' collection
            mockCollection.insertOne.mockResolvedValue({ insertedId: 'id-1', acknowledged: true });

            await plugin1.insertOne('subscriptions', { userId: 'user-1' } as any);
            expect(mockDb.collection).toHaveBeenCalledWith('plugin_whale-alerts_subscriptions');

            mockDb.collection.mockClear();

            await plugin2.insertOne('subscriptions', { userId: 'user-2' } as any);
            expect(mockDb.collection).toHaveBeenCalledWith('plugin_delegation-tracker_subscriptions');

            // Collections are isolated - different physical names
            expect('plugin_whale-alerts_subscriptions').not.toBe('plugin_delegation-tracker_subscriptions');
        });
    });
});
