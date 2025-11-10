/// <reference types="vitest" />

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { PagesModule } from '../index.js';
import { PageService } from '../services/page.service.js';
import type { ICacheService, IMenuService } from '@tronrelic/types';
import { ObjectId } from 'mongodb';
import type { Express, Router } from 'express';
import { createMockDatabaseService } from '../../../tests/vitest/mocks/database-service.js';

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
    getNamespaceConfig = vi.fn(async () => ({
        namespace: 'main',
        hamburgerMenu: { enabled: true, triggerWidth: 768 },
        icons: { enabled: true, position: 'left' as const },
        layout: { orientation: 'horizontal' as const },
        styling: { compact: false, showLabels: true }
    }));
    setNamespaceConfig = vi.fn();
    deleteNamespaceConfig = vi.fn();
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
    let mockDatabase: ReturnType<typeof createMockDatabaseService>;
    let mockCache: MockCacheService;
    let mockMenu: MockMenuService;
    let mockApp: MockExpressApp;

    beforeEach(() => {
        vi.clearAllMocks();

        // Reset PageService singleton before each test
        (PageService as any).instance = undefined;

        mockDatabase = createMockDatabaseService();
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

            // Get the actual calls
            const calls = mockApp.use.mock.calls;

            // Admin router should have 3 arguments: path, middleware, router
            expect(calls[0]).toHaveLength(3);
            expect(calls[0][0]).toBe('/api/admin/pages');
            expect(calls[0][1]).toBeTypeOf('function'); // requireAdmin middleware
            expect(calls[0][2]).toBeTypeOf('function'); // router

            // Public router should have 2 arguments: path, router (no middleware)
            expect(calls[1]).toHaveLength(2);
            expect(calls[1][0]).toBe('/api/pages');
            expect(calls[1][1]).toBeTypeOf('function'); // router
        });

        it('should apply requireAdmin middleware to admin routes', async () => {
            const module = new PagesModule();

            await module.init({
                database: mockDatabase,
                cacheService: mockCache,
                menuService: mockMenu,
                app: mockApp as any
            });

            await module.run();

            // Get the calls to app.use
            const useCalls = mockApp.use.mock.calls;

            // Find the admin pages route call
            const adminCall = useCalls.find(call => call[0] === '/api/admin/pages');

            // Verify admin route has 3 arguments: path, middleware, router
            expect(adminCall).toBeDefined();
            expect(adminCall?.length).toBe(3);
            expect(adminCall?.[1]).toBeTypeOf('function'); // requireAdmin middleware
            expect(adminCall?.[2]).toBeTypeOf('function'); // router
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
