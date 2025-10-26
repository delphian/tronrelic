/// <reference types="vitest" />

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type { IDatabaseService } from '@tronrelic/types';
import { ObjectId } from 'mongodb';

/**
 * Mock WebSocketService for testing real-time updates.
 * Must be defined before MenuService import due to vi.mock hoisting.
 */
vi.mock('../../../services/websocket.service.js', () => ({
    WebSocketService: {
        getInstance: vi.fn(() => ({
            emit: vi.fn()
        }))
    }
}));

// Import MenuService AFTER mocking dependencies
import { MenuService } from '../menu.service.js';

/**
 * Mock IDatabaseService implementation for testing MenuService.
 *
 * Provides in-memory storage for menu nodes and tracks method calls
 * for verification in tests. Implements the full IDatabaseService interface
 * but only the methods used by MenuService are actively implemented.
 */
class MockPluginDatabase implements IDatabaseService {
    // Model registry (not used by MenuService but required by interface)
    registerModel(collectionName: string, model: any): void {
        // No-op for tests
    }

    getModel(collectionName: string): any | undefined {
        // No-op for tests
        return undefined;
    }

    // Migration methods (not used by MenuService but required by interface)
    async initializeMigrations(): Promise<void> {
        // No-op for tests
    }

    async getMigrationsPending(): Promise<Array<{ id: string; description: string; source: string; filePath: string; timestamp: Date; dependencies: string[]; checksum?: string }>> {
        return [];
    }

    async getMigrationsCompleted(limit?: number): Promise<Array<{ migrationId: string; status: 'completed' | 'failed'; source: string; executedAt: Date; executionDuration: number; error?: string; errorStack?: string; checksum?: string }>> {
        return [];
    }

    async executeMigration(migrationId: string): Promise<void> {
        // No-op for tests
    }

    async executeMigrationsAll(): Promise<void> {
        // No-op for tests
    }

    isMigrationRunning(): boolean {
        return false;
    }

    private collections = new Map<string, any[]>();

    getCollection<T extends Document = Document>(name: string) {
        if (!this.collections.has(name)) {
            this.collections.set(name, []);
        }

        const data = this.collections.get(name)!;

        return {
            find: vi.fn((filter: any = {}) => ({
                toArray: vi.fn(async () => {
                    if (Object.keys(filter).length === 0) {
                        return data;
                    }
                    return data.filter((doc: any) => {
                        return Object.entries(filter).every(([key, value]) => {
                            if (key === '_id' && value instanceof ObjectId) {
                                return doc._id.equals(value);
                            }
                            return doc[key] === value;
                        });
                    });
                }),
                sort: vi.fn(function(this: any) { return this; }),
                skip: vi.fn(function(this: any) { return this; }),
                limit: vi.fn(function(this: any) { return this; })
            })),
            findOne: vi.fn(async (filter: any) => {
                const doc = data.find((d: any) => {
                    return Object.entries(filter).every(([key, value]) => {
                        if (key === '_id' && value instanceof ObjectId) {
                            return d._id.equals(value);
                        }
                        return d[key] === value;
                    });
                });
                return doc || null;
            }),
            insertOne: vi.fn(async (doc: any) => {
                const id = new ObjectId();
                const newDoc = { ...doc, _id: id };
                data.push(newDoc);
                return { insertedId: id, acknowledged: true };
            }),
            updateOne: vi.fn(async (filter: any, update: any) => {
                const docIndex = data.findIndex((d: any) => {
                    return Object.entries(filter).every(([key, value]) => {
                        if (key === '_id' && value instanceof ObjectId) {
                            return d._id.equals(value);
                        }
                        return d[key] === value;
                    });
                });

                if (docIndex !== -1) {
                    const updateFields = update.$set || {};
                    data[docIndex] = { ...data[docIndex], ...updateFields };
                    return { modifiedCount: 1, acknowledged: true };
                }

                return { modifiedCount: 0, acknowledged: true };
            }),
            deleteOne: vi.fn(async (filter: any) => {
                const docIndex = data.findIndex((d: any) => {
                    return Object.entries(filter).every(([key, value]) => {
                        if (key === '_id' && value instanceof ObjectId) {
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
            countDocuments: vi.fn(async () => data.length),
            createIndex: vi.fn(async () => 'index_name'),
            deleteMany: vi.fn(async () => ({ deletedCount: 0, acknowledged: true })),
            updateMany: vi.fn(async () => ({ modifiedCount: 0, acknowledged: true }))
        } as any;
    }

    async get<T = any>(key: string): Promise<T | undefined> {
        const collection = this.getCollection('_kv');
        const doc = await collection.findOne({ key });
        return doc?.value;
    }

    async set<T = any>(key: string, value: T): Promise<void> {
        const collection = this.getCollection('_kv');
        await collection.updateOne(
            { key },
            { $set: { key, value } },
            { upsert: true }
        );
    }

    async delete(key: string): Promise<boolean> {
        const collection = this.getCollection('_kv');
        const result = await collection.deleteOne({ key });
        return result.deletedCount > 0;
    }

    async createIndex(): Promise<void> {
        // No-op for tests
    }

    async count(): Promise<number> {
        return 0;
    }

    async find(): Promise<any[]> {
        return [];
    }

    async findOne(): Promise<any> {
        return null;
    }

    async insertOne(): Promise<any> {
        return new ObjectId();
    }

    async updateMany(): Promise<number> {
        return 0;
    }

    async deleteMany(): Promise<number> {
        return 0;
    }

    /**
     * Clear all collections for test isolation.
     */
    clear(): void {
        this.collections.clear();
    }
}

describe('MenuService', () => {
    let menuService: MenuService;
    let mockDatabase: MockPluginDatabase;

    beforeEach(() => {
        // Clear all mocks before each test
        vi.clearAllMocks();

        // Create fresh mock database
        mockDatabase = new MockPluginDatabase();

        // Reset singleton and inject mock database
        (MenuService as any).instance = undefined;
        MenuService.setDatabase(mockDatabase);
        menuService = MenuService.getInstance();
    });

    afterEach(() => {
        // Clean up after each test
        mockDatabase.clear();
    });

    /**
     * Test: MenuService should load menu nodes from database during initialization.
     *
     * Verifies that initialize() loads nodes from the database collection
     * and populates the in-memory tree.
     */
    it('should load menu nodes from database during initialization', async () => {
        // Arrange: Pre-populate mock database with sample nodes
        const collection = mockDatabase.getCollection('menu_nodes');
        await collection.insertOne({
            label: 'Home',
            url: '/',
            order: 0,
            parent: null,
            enabled: true
        });
        await collection.insertOne({
            label: 'Dashboard',
            url: '/dashboard',
            order: 1,
            parent: null,
            enabled: true
        });

        // Act: Initialize the menu service
        await menuService.initialize();

        // Assert: Verify nodes are accessible in the tree
        const tree = menuService.getTree();
        expect(tree.all).toHaveLength(2);
        expect(tree.roots).toHaveLength(2);
        expect(tree.roots[0].label).toBe('Home');
        expect(tree.roots[1].label).toBe('Dashboard');
    });

    /**
     * Test: MenuService should create default Home node when database is empty.
     *
     * Verifies that initialize() creates a default root node if the menu
     * tree is empty on first startup.
     */
    it('should create default Home node when database is empty', async () => {
        // Arrange: Empty database (default state)

        // Act: Initialize with empty database
        await menuService.initialize();

        // Assert: Verify default Home node was created
        const tree = menuService.getTree();
        expect(tree.all).toHaveLength(1);
        expect(tree.roots).toHaveLength(1);
        expect(tree.roots[0].label).toBe('Home');
        expect(tree.roots[0].url).toBe('/');
        expect(tree.roots[0].enabled).toBe(true);
    });

    /**
     * Test: MenuService should create memory-only menu nodes by default.
     *
     * Verifies that create() without persist flag creates in-memory entries
     * that don't touch the database (for runtime plugin pages).
     */
    it('should create memory-only menu nodes by default', async () => {
        // Arrange: Initialize with empty database
        await menuService.initialize();

        const newNodeData = {
            label: 'Plugin Page',
            url: '/plugins/example',
            order: 100,
            parent: null,
            enabled: true
        };

        // Act: Create a memory-only node (persist=false by default)
        const result = await menuService.create(newNodeData);

        // Assert: Verify returned node has ID
        expect(result._id).toBeDefined();
        expect(result.label).toBe('Plugin Page');
        expect(result.url).toBe('/plugins/example');

        // Assert: Verify node exists in the in-memory tree
        const node = menuService.getNode(result._id!);
        expect(node).toBeDefined();
        expect(node?.label).toBe('Plugin Page');

        // Assert: Verify node was NOT persisted to database
        const collection = mockDatabase.getCollection('menu_nodes');
        const dbNode = await collection.findOne({ label: 'Plugin Page' });
        expect(dbNode).toBeNull();
    });

    /**
     * Test: MenuService should persist menu nodes when persist=true.
     *
     * Verifies that create() with persist=true saves to database
     * (for admin-created entries that survive restarts).
     */
    it('should persist menu nodes when persist=true', async () => {
        // Arrange: Initialize with empty database
        await menuService.initialize();

        const newNodeData = {
            label: 'Admin Entry',
            url: '/admin-page',
            order: 10,
            parent: null,
            enabled: true
        };

        // Act: Create a persisted node (persist=true)
        const result = await menuService.create(newNodeData, true);

        // Assert: Verify returned node has ID
        expect(result._id).toBeDefined();
        expect(result.label).toBe('Admin Entry');

        // Assert: Verify node exists in the in-memory tree
        const node = menuService.getNode(result._id!);
        expect(node).toBeDefined();

        // Assert: Verify node WAS persisted to database
        const collection = mockDatabase.getCollection('menu_nodes');
        const dbNode = await collection.findOne({ label: 'Admin Entry' });
        expect(dbNode).toBeDefined();
        expect(dbNode.label).toBe('Admin Entry');
    });

    /**
     * Test: MenuService should update memory-only nodes without database writes.
     *
     * Verifies that update() without persist flag only modifies in-memory tree.
     */
    it('should update memory-only nodes without database writes', async () => {
        // Arrange: Create memory-only node
        await menuService.initialize();
        const created = await menuService.create({
            label: 'Original',
            url: '/original',
            order: 0,
            parent: null,
            enabled: true
        }); // persist=false (default)

        // Act: Update the node without persisting
        const updated = await menuService.update(created._id!, {
            label: 'Updated',
            url: '/updated'
        }); // persist=false (default)

        // Assert: Verify updated node has new values
        expect(updated.label).toBe('Updated');
        expect(updated.url).toBe('/updated');

        // Assert: Verify in-memory tree reflects changes
        const node = menuService.getNode(created._id!);
        expect(node?.label).toBe('Updated');

        // Assert: Verify database was NOT touched (node never existed there)
        const collection = mockDatabase.getCollection('menu_nodes');
        const dbNode = await collection.findOne({ _id: new ObjectId(created._id!) });
        expect(dbNode).toBeNull();
    });

    /**
     * Test: MenuService should update persisted nodes in both memory and database.
     *
     * Verifies that update() with persist=true modifies both in-memory tree
     * and database storage.
     */
    it('should update persisted nodes in both memory and database', async () => {
        // Arrange: Create persisted node
        await menuService.initialize();
        const created = await menuService.create({
            label: 'Original',
            url: '/original',
            order: 0,
            parent: null,
            enabled: true
        }, true); // persist=true

        // Act: Update the node with persistence
        const updated = await menuService.update(created._id!, {
            label: 'Updated',
            url: '/updated'
        }, true); // persist=true

        // Assert: Verify updated node has new values
        expect(updated.label).toBe('Updated');
        expect(updated.url).toBe('/updated');

        // Assert: Verify in-memory tree reflects changes
        const node = menuService.getNode(created._id!);
        expect(node?.label).toBe('Updated');

        // Assert: Verify database reflects changes
        const collection = mockDatabase.getCollection('menu_nodes');
        const dbNode = await collection.findOne({ _id: new ObjectId(created._id!) });
        expect(dbNode).toBeDefined();
        expect(dbNode.label).toBe('Updated');
        expect(dbNode.url).toBe('/updated');
    });

    /**
     * Test: MenuService should delete memory-only nodes without database writes.
     *
     * Verifies that delete() without persist flag only removes from in-memory tree.
     */
    it('should delete memory-only nodes without database writes', async () => {
        // Arrange: Create memory-only node
        await menuService.initialize();
        const created = await menuService.create({
            label: 'ToDelete',
            url: '/delete',
            order: 0,
            parent: null,
            enabled: true
        }); // persist=false (default)

        // Act: Delete the node without persisting
        await menuService.delete(created._id!); // persist=false (default)

        // Assert: Verify node removed from in-memory tree
        const node = menuService.getNode(created._id!);
        expect(node).toBeUndefined();

        // Assert: Verify database was NOT touched (node never existed there)
        const collection = mockDatabase.getCollection('menu_nodes');
        const dbNode = await collection.findOne({ _id: new ObjectId(created._id!) });
        expect(dbNode).toBeNull();
    });

    /**
     * Test: MenuService should delete persisted nodes from both memory and database.
     *
     * Verifies that delete() with persist=true removes from both in-memory tree
     * and database storage.
     */
    it('should delete persisted nodes from both memory and database', async () => {
        // Arrange: Create persisted node
        await menuService.initialize();
        const created = await menuService.create({
            label: 'ToDelete',
            url: '/delete',
            order: 0,
            parent: null,
            enabled: true
        }, true); // persist=true

        // Verify it exists in database before deletion
        const collection = mockDatabase.getCollection('menu_nodes');
        const beforeDelete = await collection.findOne({ _id: new ObjectId(created._id!) });
        expect(beforeDelete).toBeDefined();

        // Act: Delete the node with persistence
        await menuService.delete(created._id!, true); // persist=true

        // Assert: Verify node removed from in-memory tree
        const node = menuService.getNode(created._id!);
        expect(node).toBeUndefined();

        // Assert: Verify node removed from database
        const dbNode = await collection.findOne({ _id: new ObjectId(created._id!) });
        expect(dbNode).toBeNull();
    });

    /**
     * Test: MenuService should support hierarchical menu structures.
     *
     * Verifies that parent-child relationships are maintained correctly
     * in the tree structure for both memory-only and persisted entries.
     */
    it('should build hierarchical tree with parent-child relationships', async () => {
        // Arrange: Create parent and child nodes (memory-only by default)
        await menuService.initialize();

        const parent = await menuService.create({
            label: 'Admin',
            url: '/admin',
            order: 0,
            parent: null,
            enabled: true
        }); // memory-only

        const child = await menuService.create({
            label: 'Users',
            url: '/admin/users',
            order: 0,
            parent: parent._id!,
            enabled: true
        }); // memory-only

        // Act: Get the tree
        const tree = menuService.getTree();

        // Assert: Verify tree structure (includes default Home node)
        expect(tree.roots).toHaveLength(2); // Default Home + Admin
        const adminNode = tree.roots.find(r => r.label === 'Admin');
        expect(adminNode).toBeDefined();
        expect(adminNode!.children).toHaveLength(1);
        expect(adminNode!.children[0].label).toBe('Users');
        expect(adminNode!.children[0]._id).toBe(child._id);
    });

    /**
     * Test: MenuService should allow subscribers to validate operations.
     *
     * Verifies that before:* events allow subscribers to halt operations
     * by setting validation.continue = false.
     */
    it('should allow subscribers to halt create operations', async () => {
        // Arrange: Subscribe to before:create and halt if label is 'Forbidden'
        await menuService.initialize();

        menuService.subscribe('before:create', async (event) => {
            if (event.node.label === 'Forbidden') {
                event.validation.continue = false;
                event.validation.error = 'Label is forbidden';
            }
        });

        // Act & Assert: Attempt to create forbidden node
        await expect(menuService.create({
            label: 'Forbidden',
            url: '/forbidden',
            order: 0,
            parent: null,
            enabled: true
        })).rejects.toThrow('Label is forbidden');

        // Assert: Verify node was NOT created
        const tree = menuService.getTree();
        const forbiddenNode = tree.all.find(n => n.label === 'Forbidden');
        expect(forbiddenNode).toBeUndefined();
    });
});
