/// <reference types="vitest" />

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { initPagesModule, createPagesModuleRouter, createPublicPagesModuleRouter } from '../index.js';
import type { IDatabaseService, ICacheService, IMenuService } from '@tronrelic/types';
import { ObjectId } from 'mongodb';
import type { Router } from 'express';

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

    async del(key: string): Promise<void> {
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
    getTree = vi.fn(() => ({ all: [], roots: [] }));
    initialize = vi.fn();
    subscribe = vi.fn();
    unsubscribe = vi.fn();
    emit = vi.fn();
    setDatabase = vi.fn();
    getDatabase = vi.fn();
}

describe('Pages Module', () => {
    let mockDatabase: MockDatabaseService;
    let mockCache: MockCacheService;
    let mockMenu: MockMenuService;

    beforeEach(() => {
        vi.clearAllMocks();
        mockDatabase = new MockDatabaseService();
        mockCache = new MockCacheService();
        mockMenu = new MockMenuService();
    });

    // ============================================================================
    // Router Creation Tests
    // ============================================================================

    describe('createPagesModuleRouter', () => {
        it('should create admin router with all endpoints', () => {
            const router = createPagesModuleRouter(mockDatabase, mockCache);

            expect(router).toBeDefined();
            expect(typeof router).toBe('function'); // Express Router is a function
        });

        it('should use provided dependencies', () => {
            const router = createPagesModuleRouter(mockDatabase, mockCache);

            // Router should be created without errors
            expect(router).toBeTruthy();
        });
    });

    describe('createPublicPagesModuleRouter', () => {
        it('should create public router with public endpoints', () => {
            const router = createPublicPagesModuleRouter(mockDatabase, mockCache);

            expect(router).toBeDefined();
            expect(typeof router).toBe('function'); // Express Router is a function
        });

        it('should use provided dependencies', () => {
            const router = createPublicPagesModuleRouter(mockDatabase, mockCache);

            // Router should be created without errors
            expect(router).toBeTruthy();
        });
    });

    // ============================================================================
    // Module Initialization Tests
    // ============================================================================

    describe('initPagesModule', () => {
        it('should initialize module with all dependencies', () => {
            const result = initPagesModule({
                database: mockDatabase,
                cacheService: mockCache,
                menuService: mockMenu
            });

            expect(result).toBeDefined();
            expect(result.adminRouter).toBeDefined();
            expect(result.publicRouter).toBeDefined();
        });

        it('should return both admin and public routers', () => {
            const result = initPagesModule({
                database: mockDatabase,
                cacheService: mockCache,
                menuService: mockMenu
            });

            expect(typeof result.adminRouter).toBe('function');
            expect(typeof result.publicRouter).toBe('function');
        });

        it('should register menu item via MenuService', async () => {
            // Setup menu service to emit 'ready' event
            const subscribers = new Map<string, Function[]>();
            mockMenu.subscribe.mockImplementation((event: string, callback: Function) => {
                if (!subscribers.has(event)) {
                    subscribers.set(event, []);
                }
                subscribers.get(event)!.push(callback);
            });

            initPagesModule({
                database: mockDatabase,
                cacheService: mockCache,
                menuService: mockMenu
            });

            // Verify subscribe was called for 'ready' event
            expect(mockMenu.subscribe).toHaveBeenCalledWith('ready', expect.any(Function));

            // Simulate 'ready' event emission
            const readyCallbacks = subscribers.get('ready') || [];
            for (const callback of readyCallbacks) {
                await callback();
            }

            // Verify menu item creation was attempted
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

        it('should handle menu registration errors gracefully', async () => {
            mockMenu.create.mockRejectedValue(new Error('Menu creation failed'));

            const subscribers = new Map<string, Function[]>();
            mockMenu.subscribe.mockImplementation((event: string, callback: Function) => {
                if (!subscribers.has(event)) {
                    subscribers.set(event, []);
                }
                subscribers.get(event)!.push(callback);
            });

            // Should not throw during initialization
            expect(() => {
                initPagesModule({
                    database: mockDatabase,
                    cacheService: mockCache,
                    menuService: mockMenu
                });
            }).not.toThrow();

            // Simulate 'ready' event emission
            const readyCallbacks = subscribers.get('ready') || [];
            for (const callback of readyCallbacks) {
                // Should not throw even if menu creation fails
                await expect(callback()).resolves.not.toThrow();
            }
        });
    });

    // ============================================================================
    // Integration Tests
    // ============================================================================

    describe('full module initialization flow', () => {
        it('should create complete module with all routers and menu', () => {
            const result = initPagesModule({
                database: mockDatabase,
                cacheService: mockCache,
                menuService: mockMenu
            });

            // Verify both routers are created
            expect(result.adminRouter).toBeDefined();
            expect(result.publicRouter).toBeDefined();

            // Verify routers are Express Router instances (functions)
            expect(typeof result.adminRouter).toBe('function');
            expect(typeof result.publicRouter).toBe('function');

            // Verify menu service subscribe was called
            expect(mockMenu.subscribe).toHaveBeenCalled();
        });

        it('should handle multiple initializations', () => {
            // First initialization
            const result1 = initPagesModule({
                database: mockDatabase,
                cacheService: mockCache,
                menuService: mockMenu
            });

            // Second initialization (simulating hot reload)
            const result2 = initPagesModule({
                database: mockDatabase,
                cacheService: mockCache,
                menuService: mockMenu
            });

            // Both should succeed and create independent routers
            expect(result1.adminRouter).toBeDefined();
            expect(result2.adminRouter).toBeDefined();
            expect(result1.adminRouter).not.toBe(result2.adminRouter); // Different instances
        });
    });

    // ============================================================================
    // Dependency Injection Tests
    // ============================================================================

    describe('dependency injection', () => {
        it('should pass database service to routers', () => {
            const result = initPagesModule({
                database: mockDatabase,
                cacheService: mockCache,
                menuService: mockMenu
            });

            // Routers should be created successfully with database
            expect(result.adminRouter).toBeTruthy();
            expect(result.publicRouter).toBeTruthy();
        });

        it('should pass cache service to routers', () => {
            const result = initPagesModule({
                database: mockDatabase,
                cacheService: mockCache,
                menuService: mockMenu
            });

            // Routers should be created successfully with cache
            expect(result.adminRouter).toBeTruthy();
            expect(result.publicRouter).toBeTruthy();
        });

        it('should pass menu service for registration', () => {
            initPagesModule({
                database: mockDatabase,
                cacheService: mockCache,
                menuService: mockMenu
            });

            // Menu service should be used for registration
            expect(mockMenu.subscribe).toHaveBeenCalled();
        });
    });
});
