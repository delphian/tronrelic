/// <reference types="vitest" />

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type { IMenuNode, IDatabaseService } from '@tronrelic/types';
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
    registerModel(collectionName: string, model: any): void {}
    getModel(collectionName: string): any | undefined { return undefined; }

    // Migration methods (required by interface)
    async initializeMigrations(): Promise<void> {}
    async getMigrationsPending(): Promise<Array<{ id: string; description: string; source: string; filePath: string; timestamp: Date; dependencies: string[]; checksum?: string }>> { return []; }
    async getMigrationsCompleted(limit?: number): Promise<Array<{ migrationId: string; status: 'completed' | 'failed'; source: string; executedAt: Date; executionDuration: number; error?: string; errorStack?: string; checksum?: string }>> { return []; }
    async executeMigration(migrationId: string): Promise<void> {}
    async executeMigrationsAll(): Promise<void> {}
    isMigrationRunning(): boolean { return false; }

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

describe('MenuService - Namespace Support', () => {
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
     * Test: MenuService should create nodes in the default 'main' namespace when not specified.
     *
     * Verifies that nodes created without an explicit namespace are assigned
     * to the default 'main' namespace.
     */
    it('should create nodes in default main namespace when not specified', async () => {
        // Arrange: Initialize service
        await menuService.initialize();

        // Act: Create node without specifying namespace
        const node = await menuService.create({
            label: 'Test Node',
            url: '/test',
            order: 0,
            parent: null,
            enabled: true
        });

        // Assert: Verify node is in 'main' namespace
        expect(node.namespace).toBe('main');

        // Assert: Verify node appears in main namespace tree
        const mainTree = menuService.getTree('main');
        expect(mainTree.all).toContainEqual(expect.objectContaining({ label: 'Test Node' }));
    });

    /**
     * Test: MenuService should create nodes in custom namespaces.
     *
     * Verifies that nodes can be created in custom namespaces (e.g., 'footer', 'admin-sidebar')
     * and that they are isolated from other namespaces.
     */
    it('should create nodes in custom namespaces', async () => {
        // Arrange: Initialize service
        await menuService.initialize();

        // Act: Create nodes in different namespaces
        const mainNode = await menuService.create({
            namespace: 'main',
            label: 'Main Menu Item',
            url: '/main',
            order: 0,
            parent: null,
            enabled: true
        });

        const footerNode = await menuService.create({
            namespace: 'footer',
            label: 'Footer Link',
            url: '/footer',
            order: 0,
            parent: null,
            enabled: true
        });

        const adminNode = await menuService.create({
            namespace: 'admin-sidebar',
            label: 'Admin Tool',
            url: '/admin/tool',
            order: 0,
            parent: null,
            enabled: true
        });

        // Assert: Verify nodes are in correct namespaces
        expect(mainNode.namespace).toBe('main');
        expect(footerNode.namespace).toBe('footer');
        expect(adminNode.namespace).toBe('admin-sidebar');

        // Assert: Verify namespace isolation
        const mainTree = menuService.getTree('main');
        const footerTree = menuService.getTree('footer');
        const adminTree = menuService.getTree('admin-sidebar');

        // Main tree has 2 nodes (default Home + Main Menu Item)
        expect(mainTree.all).toHaveLength(2);
        expect(mainTree.all).toContainEqual(expect.objectContaining({ label: 'Main Menu Item' }));
        expect(mainTree.all).not.toContainEqual(expect.objectContaining({ label: 'Footer Link' }));

        // Footer tree has only footer node
        expect(footerTree.all).toHaveLength(1);
        expect(footerTree.all).toContainEqual(expect.objectContaining({ label: 'Footer Link' }));

        // Admin tree has only admin node
        expect(adminTree.all).toHaveLength(1);
        expect(adminTree.all).toContainEqual(expect.objectContaining({ label: 'Admin Tool' }));
    });

    /**
     * Test: MenuService should return empty tree for non-existent namespaces.
     *
     * Verifies that requesting a namespace that doesn't exist returns an empty
     * tree structure instead of throwing an error.
     */
    it('should return empty tree for non-existent namespace', async () => {
        // Arrange: Initialize service
        await menuService.initialize();

        // Act: Get tree for namespace that doesn't exist
        const tree = menuService.getTree('non-existent');

        // Assert: Verify empty tree structure
        expect(tree.roots).toHaveLength(0);
        expect(tree.all).toHaveLength(0);
        expect(tree.generatedAt).toBeInstanceOf(Date);
    });

    /**
     * Test: MenuService should support hierarchical structures within namespaces.
     *
     * Verifies that parent-child relationships work correctly within a namespace
     * and that getChildren() respects namespace boundaries.
     */
    it('should support hierarchical structures within namespaces', async () => {
        // Arrange: Initialize service
        await menuService.initialize();

        // Act: Create parent-child structure in footer namespace
        const footerParent = await menuService.create({
            namespace: 'footer',
            label: 'Company',
            url: '/company',
            order: 0,
            parent: null,
            enabled: true
        });

        const footerChild1 = await menuService.create({
            namespace: 'footer',
            label: 'About Us',
            url: '/company/about',
            order: 0,
            parent: footerParent._id!,
            enabled: true
        });

        const footerChild2 = await menuService.create({
            namespace: 'footer',
            label: 'Careers',
            url: '/company/careers',
            order: 1,
            parent: footerParent._id!,
            enabled: true
        });

        // Assert: Verify tree structure
        const footerTree = menuService.getTree('footer');
        expect(footerTree.roots).toHaveLength(1);
        expect(footerTree.roots[0].label).toBe('Company');
        expect(footerTree.roots[0].children).toHaveLength(2);
        expect(footerTree.roots[0].children[0].label).toBe('About Us');
        expect(footerTree.roots[0].children[1].label).toBe('Careers');

        // Assert: Verify getChildren respects namespace
        const children = menuService.getChildren(footerParent._id!, 'footer');
        expect(children).toHaveLength(2);
        expect(children[0].label).toBe('About Us');
        expect(children[1].label).toBe('Careers');
    });

    /**
     * Test: MenuService should update nodes across namespaces.
     *
     * Verifies that a node can be moved from one namespace to another via update,
     * and that it is removed from the old namespace and added to the new one.
     */
    it('should move nodes between namespaces via update', async () => {
        // Arrange: Create node in main namespace
        await menuService.initialize();

        const node = await menuService.create({
            namespace: 'main',
            label: 'Movable Item',
            url: '/movable',
            order: 0,
            parent: null,
            enabled: true
        });

        // Act: Update node to footer namespace
        const updated = await menuService.update(node._id!, {
            namespace: 'footer'
        });

        // Assert: Verify node moved to footer namespace
        expect(updated.namespace).toBe('footer');

        // Assert: Verify node removed from main namespace
        const mainTree = menuService.getTree('main');
        expect(mainTree.all).not.toContainEqual(expect.objectContaining({ label: 'Movable Item' }));

        // Assert: Verify node added to footer namespace
        const footerTree = menuService.getTree('footer');
        expect(footerTree.all).toContainEqual(expect.objectContaining({ label: 'Movable Item' }));
    });

    /**
     * Test: MenuService should delete nodes only from their namespace.
     *
     * Verifies that deleting a node removes it from its namespace but does not
     * affect nodes in other namespaces.
     */
    it('should delete nodes only from their namespace', async () => {
        // Arrange: Create nodes in different namespaces
        await menuService.initialize();

        const mainNode = await menuService.create({
            namespace: 'main',
            label: 'Main Item',
            url: '/main',
            order: 0,
            parent: null,
            enabled: true
        });

        const footerNode = await menuService.create({
            namespace: 'footer',
            label: 'Footer Item',
            url: '/footer',
            order: 0,
            parent: null,
            enabled: true
        });

        // Act: Delete main namespace node
        await menuService.delete(mainNode._id!);

        // Assert: Verify node removed from main namespace
        const mainTree = menuService.getTree('main');
        expect(mainTree.all).not.toContainEqual(expect.objectContaining({ label: 'Main Item' }));

        // Assert: Verify footer node unaffected
        const footerTree = menuService.getTree('footer');
        expect(footerTree.all).toContainEqual(expect.objectContaining({ label: 'Footer Item' }));
    });

    /**
     * Test: MenuService should list all available namespaces.
     *
     * Verifies that getNamespaces() returns all namespaces that have been created,
     * sorted alphabetically.
     */
    it('should list all available namespaces', async () => {
        // Arrange: Initialize and create nodes in multiple namespaces
        await menuService.initialize();

        await menuService.create({
            namespace: 'footer',
            label: 'Footer Item',
            url: '/footer',
            order: 0,
            parent: null,
            enabled: true
        });

        await menuService.create({
            namespace: 'admin-sidebar',
            label: 'Admin Item',
            url: '/admin',
            order: 0,
            parent: null,
            enabled: true
        });

        await menuService.create({
            namespace: 'main',
            label: 'Main Item',
            url: '/main',
            order: 0,
            parent: null,
            enabled: true
        });

        // Act: Get all namespaces
        const namespaces = menuService.getNamespaces();

        // Assert: Verify all namespaces are present and sorted
        expect(namespaces).toEqual(['admin-sidebar', 'footer', 'main']);
    });

    /**
     * Test: MenuService should persist namespace to database when persist=true.
     *
     * Verifies that custom namespaces are saved to the database when creating
     * persisted nodes, ensuring they survive service restarts.
     */
    it('should persist namespace to database when persist=true', async () => {
        // Arrange: Initialize service
        await menuService.initialize();

        // Act: Create persisted node in custom namespace
        const node = await menuService.create({
            namespace: 'footer',
            label: 'Persistent Footer',
            url: '/footer',
            order: 0,
            parent: null,
            enabled: true
        }, true); // persist=true

        // Assert: Verify node has correct namespace
        expect(node.namespace).toBe('footer');

        // Assert: Verify namespace persisted to database
        const collection = mockDatabase.getCollection('menu_nodes');
        const dbNode = await collection.findOne({ _id: new ObjectId(node._id!) });
        expect(dbNode).toBeDefined();
        expect(dbNode.namespace).toBe('footer');
    });

    /**
     * Test: MenuService should load nodes into correct namespaces during initialization.
     *
     * Verifies that when loading nodes from database on initialization, they are
     * correctly organized by namespace in the in-memory tree.
     */
    it('should load nodes into correct namespaces during initialization', async () => {
        // Arrange: Pre-populate database with nodes in different namespaces
        const collection = mockDatabase.getCollection('menu_nodes');
        await collection.insertOne({
            namespace: 'main',
            label: 'Main Home',
            url: '/',
            order: 0,
            parent: null,
            enabled: true
        });
        await collection.insertOne({
            namespace: 'footer',
            label: 'Privacy',
            url: '/privacy',
            order: 0,
            parent: null,
            enabled: true
        });
        await collection.insertOne({
            namespace: 'admin-sidebar',
            label: 'Settings',
            url: '/admin/settings',
            order: 0,
            parent: null,
            enabled: true
        });

        // Act: Initialize service (loads from database)
        await menuService.initialize();

        // Assert: Verify nodes loaded into correct namespaces
        const mainTree = menuService.getTree('main');
        expect(mainTree.all).toHaveLength(1);
        expect(mainTree.all[0].label).toBe('Main Home');

        const footerTree = menuService.getTree('footer');
        expect(footerTree.all).toHaveLength(1);
        expect(footerTree.all[0].label).toBe('Privacy');

        const adminTree = menuService.getTree('admin-sidebar');
        expect(adminTree.all).toHaveLength(1);
        expect(adminTree.all[0].label).toBe('Settings');

        // Assert: Verify namespace list
        const namespaces = menuService.getNamespaces();
        expect(namespaces).toEqual(['admin-sidebar', 'footer', 'main']);
    });

    /**
     * Test: MenuService should default to 'main' namespace for legacy nodes without namespace field.
     *
     * Verifies backward compatibility by ensuring nodes loaded from database without
     * a namespace field are assigned to the default 'main' namespace.
     */
    it('should default legacy nodes to main namespace', async () => {
        // Arrange: Pre-populate database with node missing namespace field
        const collection = mockDatabase.getCollection('menu_nodes');
        await collection.insertOne({
            // No namespace field
            label: 'Legacy Node',
            url: '/legacy',
            order: 0,
            parent: null,
            enabled: true
        });

        // Act: Initialize service
        await menuService.initialize();

        // Assert: Verify legacy node assigned to main namespace
        const mainTree = menuService.getTree('main');
        expect(mainTree.all).toContainEqual(expect.objectContaining({ label: 'Legacy Node' }));

        const legacyNode = mainTree.all.find(n => n.label === 'Legacy Node');
        expect(legacyNode?.namespace).toBe('main');
    });
});
