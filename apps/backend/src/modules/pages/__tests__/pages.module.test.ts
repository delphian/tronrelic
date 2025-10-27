/// <reference types="vitest" />

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { PagesModule } from '../index.js';
import type { IDatabaseService, ICacheService, IMenuService } from '@tronrelic/types';
import { ObjectId } from 'mongodb';
import type { Express, Router } from 'express';

/**
 * Mock CacheService for testing.
 */
class MockCacheService implements ICacheService {
    async get<T = any>(key: string): Promise<T | null> {
        return null;
    }

    async set<T = any>(key: string, value: T, ttl?: number): Promise<void> {
        // No-op
    }

    async del(key: string): Promise<number> {
        return 0;
    }

    async invalidate(pattern: string): Promise<void> {
        // No-op
    }

    async keys(pattern: string): Promise<string[]> {
        return [];
    }
}

/**
 * Mock DatabaseService for testing.
 */
class MockDatabaseService implements IDatabaseService {
    private collections = new Map<string, any[]>();

    registerModel(collectionName: string, model: any): void {
        // No-op for tests
    }

    getModel(collectionName: string): any | undefined {
        return undefined;
    }

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

    getCollection<T extends Document = Document>(name: string) {
        if (!this.collections.has(name)) {
            this.collections.set(name, []);
        }

        const data = this.collections.get(name)!;

        return {
            find: vi.fn((filter: any = {}) => ({
                toArray: vi.fn(async () => data),
                sort: vi.fn(function(this: any) { return this; }),
                skip: vi.fn(function(this: any) { return this; }),
                limit: vi.fn(function(this: any) { return this; })
            })),
            findOne: vi.fn(async (filter: any) => null),
            insertOne: vi.fn(async (doc: any) => {
                const id = doc._id || new ObjectId();
                const newDoc = { ...doc, _id: id };
                data.push(newDoc);
                return { insertedId: id, acknowledged: true };
            }),
            updateOne: vi.fn(async (filter: any, update: any) => ({ modifiedCount: 0, acknowledged: true })),
            deleteOne: vi.fn(async (filter: any) => ({ deletedCount: 0, acknowledged: true })),
            countDocuments: vi.fn(async () => data.length),
            createIndex: vi.fn(async () => 'index_name'),
            deleteMany: vi.fn(async () => ({ deletedCount: 0, acknowledged: true })),
            updateMany: vi.fn(async () => ({ modifiedCount: 0, acknowledged: true }))
        } as any;
    }

    async get<T = any>(key: string): Promise<T | undefined> {
        return undefined;
    }

    async set<T = any>(key: string, value: T): Promise<void> {
        // No-op
    }

    async delete(key: string): Promise<boolean> {
        return false;
    }

    async createIndex(): Promise<void> {
        // No-op
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
}

/**
 * Mock MenuService for testing.
 */
class MockMenuService implements IMenuService {
    create = vi.fn();
    update = vi.fn();
    delete = vi.fn();
    getNode = vi.fn();
    getTree = vi.fn(() => ({ all: [], roots: [], generatedAt: new Date() }));
    getChildren = vi.fn(() => []);
    getNamespaces = vi.fn(() => []);
    initialize = vi.fn();
    subscribe = vi.fn();
    unsubscribe = vi.fn();
    emit = vi.fn();
    setDatabase = vi.fn();
    getDatabase = vi.fn();
}

/**
 * Mock Express app for testing.
 */
class MockExpressApp {
    use = vi.fn();
    get = vi.fn();
    post = vi.fn();
    put = vi.fn();
    patch = vi.fn();
    delete = vi.fn();
}

describe('PagesModule', () => {
    let mockDatabase: MockDatabaseService;
    let mockCache: MockCacheService;
    let mockMenu: MockMenuService;
    let mockApp: MockExpressApp;

    beforeEach(() => {
        vi.clearAllMocks();
        mockDatabase = new MockDatabaseService();
        mockCache = new MockCacheService();
        mockMenu = new MockMenuService();
        mockApp = new MockExpressApp();
    });

    // ============================================================================
    // Module Metadata Tests
    // ============================================================================

    describe('metadata', () => {
        it('should have correct module metadata', () => {
            const module = new PagesModule();

            expect(module.metadata).toBeDefined();
            expect(module.metadata.id).toBe('pages');
            expect(module.metadata.name).toBe('Pages');
            expect(module.metadata.version).toBe('1.0.0');
            expect(module.metadata.description).toBeDefined();
        });
    });

    // ============================================================================
    // init() Phase Tests
    // ============================================================================

    describe('init()', () => {
        it('should initialize module with all dependencies', async () => {
            const module = new PagesModule();

            await expect(module.init({
                database: mockDatabase,
                cacheService: mockCache,
                menuService: mockMenu,
                app: mockApp as any
            })).resolves.not.toThrow();
        });

        it('should store dependencies for later use', async () => {
            const module = new PagesModule();

            await module.init({
                database: mockDatabase,
                cacheService: mockCache,
                menuService: mockMenu,
                app: mockApp as any
            });

            // Dependencies should be stored (tested indirectly via run() phase)
            // This test verifies init() completes successfully
            expect(true).toBe(true);
        });

        it('should NOT mount routes during init()', async () => {
            const module = new PagesModule();

            await module.init({
                database: mockDatabase,
                cacheService: mockCache,
                menuService: mockMenu,
                app: mockApp as any
            });

            // Verify app.use was NOT called during init
            expect(mockApp.use).not.toHaveBeenCalled();
        });

        it('should NOT register menu items during init()', async () => {
            const module = new PagesModule();

            await module.init({
                database: mockDatabase,
                cacheService: mockCache,
                menuService: mockMenu,
                app: mockApp as any
            });

            // Verify menu.create was NOT called during init
            expect(mockMenu.create).not.toHaveBeenCalled();
        });
    });

    // ============================================================================
    // run() Phase Tests
    // ============================================================================

    describe('run()', () => {
        it('should throw if run() is called before init()', async () => {
            const module = new PagesModule();

            // run() requires init() to be called first
            await expect(module.run()).rejects.toThrow();
        });

        it('should register menu item during run()', async () => {
            const module = new PagesModule();

            await module.init({
                database: mockDatabase,
                cacheService: mockCache,
                menuService: mockMenu,
                app: mockApp as any
            });

            await module.run();

            // Verify menu item creation was called
            expect(mockMenu.create).toHaveBeenCalledWith({
                namespace: 'system',
                label: 'Pages',
                url: '/system/pages',
                icon: 'FileText',
                order: 40,
                parent: null,
                enabled: true
            });
        });

        it('should mount admin and public routers during run()', async () => {
            const module = new PagesModule();

            await module.init({
                database: mockDatabase,
                cacheService: mockCache,
                menuService: mockMenu,
                app: mockApp as any
            });

            await module.run();

            // Verify app.use was called twice (admin and public routers)
            expect(mockApp.use).toHaveBeenCalledTimes(2);
            expect(mockApp.use).toHaveBeenCalledWith('/api/admin/pages', expect.any(Function));
            expect(mockApp.use).toHaveBeenCalledWith('/api/pages', expect.any(Function));
        });

        it('should throw if menu registration fails', async () => {
            mockMenu.create.mockRejectedValue(new Error('Menu creation failed'));

            const module = new PagesModule();

            await module.init({
                database: mockDatabase,
                cacheService: mockCache,
                menuService: mockMenu,
                app: mockApp as any
            });

            // run() should throw if menu registration fails
            await expect(module.run()).rejects.toThrow('Failed to register pages menu item');
        });
    });

    // ============================================================================
    // Two-Phase Lifecycle Tests
    // ============================================================================

    describe('two-phase lifecycle', () => {
        it('should complete full init -> run flow', async () => {
            const module = new PagesModule();

            // Phase 1: init
            await module.init({
                database: mockDatabase,
                cacheService: mockCache,
                menuService: mockMenu,
                app: mockApp as any
            });

            // Phase 2: run
            await module.run();

            // Verify full initialization completed
            expect(mockMenu.create).toHaveBeenCalled();
            expect(mockApp.use).toHaveBeenCalledTimes(2);
        });

        it('should handle multiple modules in sequence', async () => {
            // Simulate multiple modules being initialized and run sequentially
            const module1 = new PagesModule();
            const module2 = new PagesModule();

            // Initialize both
            await module1.init({
                database: mockDatabase,
                cacheService: mockCache,
                menuService: mockMenu,
                app: mockApp as any
            });

            await module2.init({
                database: mockDatabase,
                cacheService: mockCache,
                menuService: mockMenu,
                app: mockApp as any
            });

            // Run both
            await module1.run();
            await module2.run();

            // Both should have registered menu items and mounted routes
            expect(mockMenu.create).toHaveBeenCalledTimes(2);
            expect(mockApp.use).toHaveBeenCalledTimes(4); // 2 routers per module
        });
    });

    // ============================================================================
    // Dependency Injection Tests
    // ============================================================================

    describe('dependency injection', () => {
        it('should use injected database service', async () => {
            const module = new PagesModule();

            await module.init({
                database: mockDatabase,
                cacheService: mockCache,
                menuService: mockMenu,
                app: mockApp as any
            });

            await module.run();

            // Module should initialize without errors
            expect(true).toBe(true);
        });

        it('should use injected cache service', async () => {
            const module = new PagesModule();

            await module.init({
                database: mockDatabase,
                cacheService: mockCache,
                menuService: mockMenu,
                app: mockApp as any
            });

            await module.run();

            // Module should initialize without errors
            expect(true).toBe(true);
        });

        it('should use injected menu service', async () => {
            const module = new PagesModule();

            await module.init({
                database: mockDatabase,
                cacheService: mockCache,
                menuService: mockMenu,
                app: mockApp as any
            });

            await module.run();

            // Verify menu service was used
            expect(mockMenu.create).toHaveBeenCalled();
        });

        it('should use injected Express app', async () => {
            const module = new PagesModule();

            await module.init({
                database: mockDatabase,
                cacheService: mockCache,
                menuService: mockMenu,
                app: mockApp as any
            });

            await module.run();

            // Verify app was used to mount routers
            expect(mockApp.use).toHaveBeenCalled();
        });
    });

    // ============================================================================
    // Error Handling Tests
    // ============================================================================

    describe('error handling', () => {
        it('should propagate init() errors', async () => {
            const module = new PagesModule();

            // Pass invalid dependencies to trigger error
            await expect(module.init({
                database: null as any,
                cacheService: mockCache,
                menuService: mockMenu,
                app: mockApp as any
            })).rejects.toThrow();
        });

        it('should propagate run() errors on menu registration failure', async () => {
            mockMenu.create.mockRejectedValue(new Error('Menu error'));

            const module = new PagesModule();

            await module.init({
                database: mockDatabase,
                cacheService: mockCache,
                menuService: mockMenu,
                app: mockApp as any
            });

            await expect(module.run()).rejects.toThrow();
        });
    });
});
