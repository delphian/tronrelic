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
    getMockCollections
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

// Import PluginDatabaseService AFTER mocking dependencies
import { PluginDatabaseService } from '../plugin-database.service.js';

describe('PluginDatabaseService', () => {
    let service: PluginDatabaseService;

    beforeEach(() => {
        // Clear collections before each test
        clearMockCollections();

        // Clear all mocks
        vi.clearAllMocks();

        // Create fresh service instance with plugin ID
        service = new PluginDatabaseService('test-plugin');
    });

    afterEach(() => {
        clearMockCollections();
    });

    describe('Constructor and Inheritance', () => {
        /**
         * Test: PluginDatabaseService should extend DatabaseService.
         *
         * Verifies that PluginDatabaseService inherits all DatabaseService functionality
         * while adding automatic collection name prefixing.
         */
        it('should extend DatabaseService', () => {
            expect(service).toBeInstanceOf(PluginDatabaseService);
            expect(typeof service.getCollection).toBe('function');
            expect(typeof service.get).toBe('function');
            expect(typeof service.set).toBe('function');
        });

        /**
         * Test: PluginDatabaseService should automatically prefix collections.
         *
         * Verifies that the constructor applies the "plugin_{id}_" prefix pattern
         * to all collection operations.
         */
        it('should automatically prefix collections', async () => {
            // Set a value in the _kv collection
            await service.set('config', 'test-value');

            // The physical collection name should be prefixed
            const collectionNames = Array.from(getMockCollections().keys());
            expect(collectionNames).toContain('plugin_test-plugin__kv');
        });

        /**
         * Test: Different plugin IDs should create isolated services.
         *
         * Verifies that each plugin gets its own isolated namespace,
         * preventing data conflicts between plugins.
         */
        it('should create isolated services for different plugin IDs', async () => {
            const pluginA = new PluginDatabaseService('plugin-a');
            const pluginB = new PluginDatabaseService('plugin-b');

            await pluginA.set('config', 'value-a');
            await pluginB.set('config', 'value-b');

            const valueA = await pluginA.get<string>('config');
            const valueB = await pluginB.get<string>('config');

            expect(valueA).toBe('value-a');
            expect(valueB).toBe('value-b');

            // Verify separate physical collections
            const collectionNames = Array.from(getMockCollections().keys());
            expect(collectionNames).toContain('plugin_plugin-a__kv');
            expect(collectionNames).toContain('plugin_plugin-b__kv');
        });
    });

    describe('Collection Naming', () => {
        /**
         * Test: Logical collection names should be prefixed automatically.
         *
         * Verifies that when a plugin accesses a logical collection name like "subscriptions",
         * it's automatically prefixed to "plugin_{id}_subscriptions".
         */
        it('should prefix logical collection names', async () => {
            const collection = service.getCollection('subscriptions');
            await collection.insertOne({ userId: '123', enabled: true });

            // Check that the prefixed collection exists
            const collectionNames = Array.from(getMockCollections().keys());
            expect(collectionNames).toContain('plugin_test-plugin_subscriptions');
        });

        /**
         * Test: Special _kv collection should be prefixed.
         *
         * Verifies that the key-value store collection is also prefixed,
         * ensuring complete isolation.
         */
        it('should prefix _kv collection', async () => {
            await service.set('lastSync', new Date().toISOString());

            const collectionNames = Array.from(getMockCollections().keys());
            expect(collectionNames).toContain('plugin_test-plugin__kv');
        });

        /**
         * Test: Plugin ID with special characters should be sanitized.
         *
         * Verifies that plugin IDs with hyphens, underscores, and other valid
         * characters are preserved in the prefix.
         */
        it('should handle plugin IDs with special characters', async () => {
            const specialPlugin = new PluginDatabaseService('whale-alerts_v2');
            await specialPlugin.set('config', 'test');

            const collectionNames = Array.from(getMockCollections().keys());
            expect(collectionNames).toContain('plugin_whale-alerts_v2__kv');
        });
    });

    describe('Key-Value Storage with Prefix', () => {
        /**
         * Test: set/get should work with prefixed collections.
         *
         * Verifies that the key-value storage methods work correctly
         * with automatic collection prefixing.
         */
        it('should work with prefixed collections', async () => {
            await service.set('apiKey', 'secret-123');
            const retrieved = await service.get<string>('apiKey');

            expect(retrieved).toBe('secret-123');
        });

        /**
         * Test: delete should work with prefixed collections.
         *
         * Verifies that delete() correctly removes keys from the prefixed
         * _kv collection.
         */
        it('should delete from prefixed collections', async () => {
            await service.set('tempKey', 'tempValue');
            const deleted = await service.delete('tempKey');

            expect(deleted).toBe(true);

            const retrieved = await service.get('tempKey');
            expect(retrieved).toBeUndefined();
        });

        /**
         * Test: Multiple plugins should have isolated key-value stores.
         *
         * Verifies that plugins can use the same key names without conflicts
         * due to collection prefixing.
         */
        it('should have isolated key-value stores', async () => {
            const pluginA = new PluginDatabaseService('plugin-a');
            const pluginB = new PluginDatabaseService('plugin-b');

            await pluginA.set('lastSync', '2024-01-01');
            await pluginB.set('lastSync', '2024-02-01');

            const syncA = await pluginA.get<string>('lastSync');
            const syncB = await pluginB.get<string>('lastSync');

            expect(syncA).toBe('2024-01-01');
            expect(syncB).toBe('2024-02-01');
        });
    });

    describe('CRUD Operations with Prefix', () => {
        /**
         * Test: insertOne should use prefixed collection name.
         *
         * Verifies that insertOne() correctly inserts into the prefixed collection.
         */
        it('should use prefixed collection name for insertOne', async () => {
            const doc = { userId: '123', threshold: 1000 };
            const insertedId = await service.insertOne('subscriptions', doc);

            expect(insertedId).toBeDefined();
            expect(insertedId).toBeInstanceOf(ObjectId);

            // Verify document is in prefixed collection
            const collection = service.getCollection('subscriptions');
            const found = await collection.findOne({ userId: '123' });
            expect(found).toBeDefined();
            expect(found?.threshold).toBe(1000);
        });

        /**
         * Test: findOne should retrieve from prefixed collection.
         *
         * Verifies that findOne() queries the correct prefixed collection.
         */
        it('should retrieve from prefixed collection', async () => {
            await service.insertOne('subscriptions', { userId: '456', enabled: true });

            const found = await service.findOne('subscriptions', { userId: '456' });
            expect(found).toBeDefined();
            expect(found?.enabled).toBe(true);
        });

        /**
         * Test: find should retrieve multiple documents from prefixed collection.
         *
         * Verifies that find() operates on the prefixed collection.
         */
        it('should retrieve multiple documents from prefixed collection', async () => {
            await service.insertOne('alerts', { type: 'whale', enabled: true });
            await service.insertOne('alerts', { type: 'price', enabled: true });
            await service.insertOne('alerts', { type: 'whale', enabled: false });

            const activeWhaleAlerts = await service.find('alerts', {
                type: 'whale',
                enabled: true
            });

            expect(activeWhaleAlerts).toHaveLength(1);
        });

        /**
         * Test: updateMany should update documents in prefixed collection.
         *
         * Verifies that updateMany() operates on the correct prefixed collection.
         */
        it('should update documents in prefixed collection', async () => {
            await service.insertOne('subscriptions', { userId: '123', active: false });
            await service.insertOne('subscriptions', { userId: '456', active: false });

            const modifiedCount = await service.updateMany(
                'subscriptions',
                { active: false },
                { $set: { active: true } }
            );

            expect(modifiedCount).toBe(2);
        });

        /**
         * Test: deleteMany should remove documents from prefixed collection.
         *
         * Verifies that deleteMany() operates on the correct prefixed collection.
         */
        it('should remove documents from prefixed collection', async () => {
            await service.insertOne('temp', { session: 'abc', expires: Date.now() });
            await service.insertOne('temp', { session: 'def', expires: Date.now() });

            const deletedCount = await service.deleteMany('temp', {});
            expect(deletedCount).toBe(2);

            const remaining = await service.find('temp', {});
            expect(remaining).toHaveLength(0);
        });

        /**
         * Test: count should count documents in prefixed collection.
         *
         * Verifies that count() operates on the correct prefixed collection.
         */
        it('should count documents in prefixed collection', async () => {
            await service.insertOne('events', { type: 'transaction' });
            await service.insertOne('events', { type: 'transaction' });
            await service.insertOne('events', { type: 'block' });

            const txCount = await service.count('events', { type: 'transaction' });
            expect(txCount).toBe(2);
        });
    });

    describe('Index Creation with Prefix', () => {
        /**
         * Test: createIndex should create index on prefixed collection.
         *
         * Verifies that createIndex() creates indexes on the correct
         * prefixed collection name.
         */
        it('should create index on prefixed collection', async () => {
            const collection = service.getCollection('subscriptions') as any;
            const createIndexMock = collection.createIndex as Mock;

            await service.createIndex('subscriptions', { userId: 1 } as any, { unique: true });

            expect(createIndexMock).toHaveBeenCalledTimes(1);
            expect(createIndexMock).toHaveBeenCalledWith({ userId: 1 } as any, { unique: true });
        });

        /**
         * Test: createIndex should handle compound indexes with prefix.
         *
         * Verifies that compound indexes work correctly with prefixed collections.
         */
        it('should handle compound indexes with prefix', async () => {
            const collection = service.getCollection('events') as any;
            const createIndexMock = collection.createIndex as Mock;

            await service.createIndex(
                'events',
                { type: 1, timestamp: -1 } as any,
                { name: 'type_timestamp_idx' }
            );

            expect(createIndexMock).toHaveBeenCalledWith(
                { type: 1, timestamp: -1 } as any,
                { name: 'type_timestamp_idx' }
            );
        });
    });

    describe('Plugin Isolation Scenarios', () => {
        /**
         * Test: Multiple plugins should not interfere with each other.
         *
         * Verifies complete isolation between plugins using the same
         * logical collection names.
         */
        it('should not interfere with other plugins', async () => {
            const whalePlugin = new PluginDatabaseService('whale-alerts');
            const pricePlugin = new PluginDatabaseService('price-alerts');

            // Both use "subscriptions" collection
            await whalePlugin.insertOne('subscriptions', {
                userId: '123',
                threshold: 1000000
            });

            await pricePlugin.insertOne('subscriptions', {
                userId: '123',
                coin: 'TRX',
                price: 0.10
            });

            // Each should only see their own data
            const whaleSubscriptions = await whalePlugin.find('subscriptions', {});
            const priceSubscriptions = await pricePlugin.find('subscriptions', {});

            expect(whaleSubscriptions).toHaveLength(1);
            expect(priceSubscriptions).toHaveLength(1);

            expect(whaleSubscriptions[0]).toHaveProperty('threshold');
            expect(priceSubscriptions[0]).toHaveProperty('coin');
        });

        /**
         * Test: Plugin data should persist independently.
         *
         * Verifies that operations on one plugin's data don't affect another plugin,
         * even when using the same logical collection names.
         */
        it('should persist data independently', async () => {
            const pluginA = new PluginDatabaseService('plugin-a');
            const pluginB = new PluginDatabaseService('plugin-b');

            // Plugin A creates data
            await pluginA.insertOne('data', { value: 'A' });
            await pluginA.insertOne('data', { value: 'A2' });

            // Plugin B creates data
            await pluginB.insertOne('data', { value: 'B' });

            // Delete from Plugin A shouldn't affect Plugin B
            await pluginA.deleteMany('data', {});

            const pluginAData = await pluginA.find('data', {});
            const pluginBData = await pluginB.find('data', {});

            expect(pluginAData).toHaveLength(0);
            expect(pluginBData).toHaveLength(1);
            expect(pluginBData[0].value).toBe('B');
        });

        /**
         * Test: Plugin KV stores should be completely isolated.
         *
         * Verifies that key-value storage is isolated between plugins,
         * allowing them to use the same keys without conflicts.
         */
        it('should have completely isolated KV stores', async () => {
            const pluginA = new PluginDatabaseService('plugin-a');
            const pluginB = new PluginDatabaseService('plugin-b');

            // Both use same keys
            await pluginA.set('enabled', true);
            await pluginA.set('lastRun', '2024-01-01');

            await pluginB.set('enabled', false);
            await pluginB.set('lastRun', '2024-02-01');

            // Each should retrieve their own values
            expect(await pluginA.get('enabled')).toBe(true);
            expect(await pluginB.get('enabled')).toBe(false);

            expect(await pluginA.get('lastRun')).toBe('2024-01-01');
            expect(await pluginB.get('lastRun')).toBe('2024-02-01');

            // Deleting from one shouldn't affect the other
            await pluginA.delete('enabled');

            expect(await pluginA.get('enabled')).toBeUndefined();
            expect(await pluginB.get('enabled')).toBe(false);
        });
    });

    describe('Real-World Plugin Scenarios', () => {
        /**
         * Test: Plugin should support typical subscription pattern.
         *
         * Verifies a realistic plugin scenario: storing user subscriptions
         * with CRUD operations.
         */
        it('should support typical subscription pattern', async () => {
            const whalePlugin = new PluginDatabaseService('whale-alerts');

            // Install: Create indexes
            await whalePlugin.createIndex('subscriptions', { userId: 1 } as any, { unique: true });

            // User subscribes
            await whalePlugin.insertOne('subscriptions', {
                userId: 'user-123',
                threshold: 100000,
                enabled: true,
                createdAt: new Date()
            });

            // User updates threshold
            await whalePlugin.updateMany(
                'subscriptions',
                { userId: 'user-123' },
                { $set: { threshold: 500000 } }
            );

            // Fetch active subscriptions
            const activeSubscriptions = await whalePlugin.find('subscriptions', { enabled: true });
            expect(activeSubscriptions).toHaveLength(1);
            expect(activeSubscriptions[0].threshold).toBe(500000);

            // User unsubscribes
            await whalePlugin.deleteMany('subscriptions', { userId: 'user-123' });

            const remaining = await whalePlugin.find('subscriptions', {});
            expect(remaining).toHaveLength(0);
        });

        /**
         * Test: Plugin should support configuration storage.
         *
         * Verifies a realistic plugin scenario: storing and updating
         * plugin configuration via key-value store.
         */
        it('should support configuration storage', async () => {
            const plugin = new PluginDatabaseService('my-plugin');

            // Init: Set default config
            await plugin.set('config', {
                maxRetries: 3,
                timeout: 5000,
                enabled: true
            });

            // Runtime: Read config
            const config = await plugin.get<any>('config');
            expect(config.maxRetries).toBe(3);

            // Admin: Update config
            await plugin.set('config', {
                ...config,
                maxRetries: 5,
                timeout: 10000
            });

            const updatedConfig = await plugin.get<any>('config');
            expect(updatedConfig.maxRetries).toBe(5);
            expect(updatedConfig.timeout).toBe(10000);
        });

        /**
         * Test: Plugin should support event storage and querying.
         *
         * Verifies a realistic plugin scenario: storing transaction events
         * and querying with filters and pagination.
         */
        it('should support event storage and querying', async () => {
            const plugin = new PluginDatabaseService('transaction-tracker');

            // Store events
            await plugin.insertOne('events', {
                txId: 'tx1',
                type: 'transfer',
                amount: 1000000,
                timestamp: Date.now()
            });

            await plugin.insertOne('events', {
                txId: 'tx2',
                type: 'transfer',
                amount: 5000000,
                timestamp: Date.now()
            });

            await plugin.insertOne('events', {
                txId: 'tx3',
                type: 'contract',
                amount: 100000,
                timestamp: Date.now()
            });

            // Query by type
            const transfers = await plugin.find('events', { type: 'transfer' });
            expect(transfers).toHaveLength(2);

            // Query with pagination
            const page1 = await plugin.find('events', {}, {
                limit: 2,
                skip: 0,
                sort: { timestamp: -1 }
            });
            expect(page1).toHaveLength(2);

            // Count events
            const totalTransfers = await plugin.count('events', { type: 'transfer' });
            expect(totalTransfers).toBe(2);
        });
    });

    describe('Model Registry with Prefix', () => {
        /**
         * Test: registerModel should work with prefixed collections.
         *
         * Verifies that Mongoose models can be registered for prefixed collections,
         * enabling schema validation and middleware for plugin collections.
         */
        it('should work with prefixed collections', () => {
            const mockModel = {
                modelName: 'Subscription',
                countDocuments: vi.fn(),
                find: vi.fn(),
                findOne: vi.fn(),
                create: vi.fn(),
                updateMany: vi.fn(),
                deleteMany: vi.fn()
            };

            service.registerModel('subscriptions', mockModel);

            const retrieved = service.getModel('subscriptions');
            expect(retrieved).toBe(mockModel);
        });

        /**
         * Test: Different plugins should have separate model registries.
         *
         * Verifies that model registration is isolated per plugin instance,
         * preventing conflicts between plugins.
         */
        it('should have separate model registries per plugin', () => {
            const pluginA = new PluginDatabaseService('plugin-a');
            const pluginB = new PluginDatabaseService('plugin-b');

            const modelA = { modelName: 'ModelA' };
            const modelB = { modelName: 'ModelB' };

            pluginA.registerModel('data', modelA);
            pluginB.registerModel('data', modelB);

            expect(pluginA.getModel('data')).toBe(modelA);
            expect(pluginB.getModel('data')).toBe(modelB);
        });
    });
});
