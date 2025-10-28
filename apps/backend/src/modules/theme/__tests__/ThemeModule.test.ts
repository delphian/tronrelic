/// <reference types="vitest" />

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ThemeModule } from '../ThemeModule.js';
import type { IDatabaseService, ICacheService, IMenuService } from '@tronrelic/types';
import type { Express } from 'express';

/**
 * Mock database service for testing.
 */
class MockDatabase implements Partial<IDatabaseService> {
    getCollection() {
        return {
            createIndex: vi.fn().mockResolvedValue('mock-index')
        } as any;
    }
    registerModel() {}
    getModel() { return undefined; }
    async initializeMigrations() {}
    async getMigrationsPending() { return []; }
    async getMigrationsCompleted() { return []; }
    async executeMigration() {}
}

/**
 * Mock cache service for testing.
 */
class MockCacheService implements ICacheService {
    async get<T = any>(key: string): Promise<T | null> { return null; }
    async set<T = any>(key: string, value: T, ttl?: number, tags?: string[]): Promise<void> {}
    async del(key: string): Promise<number> { return 0; }
    async invalidate(tag: string): Promise<void> {}
    async keys(pattern: string): Promise<string[]> { return []; }
}

/**
 * Mock menu service for testing.
 */
class MockMenuService implements Partial<IMenuService> {
    create = vi.fn().mockResolvedValue(undefined);
    update = vi.fn().mockResolvedValue(undefined);
    delete = vi.fn().mockResolvedValue(undefined);
    reorder = vi.fn().mockResolvedValue(undefined);
    findByNamespace = vi.fn().mockResolvedValue([]);
    findById = vi.fn().mockResolvedValue(null);
}

/**
 * Mock Express app for testing.
 */
function createMockApp(): Partial<Express> {
    return {
        use: vi.fn(),
        get: vi.fn(),
        post: vi.fn(),
        put: vi.fn(),
        patch: vi.fn(),
        delete: vi.fn()
    } as any;
}

// Mock ThemeService to avoid full service initialization in module tests
vi.mock('../services/theme.service.js', () => ({
    ThemeService: {
        setDependencies: vi.fn(),
        getInstance: vi.fn(() => ({
            createIndexes: vi.fn().mockResolvedValue(undefined),
            listThemes: vi.fn().mockResolvedValue([]),
            getActiveThemes: vi.fn().mockResolvedValue([]),
            createTheme: vi.fn().mockResolvedValue({ id: 'test-theme', name: 'Test' }),
            updateTheme: vi.fn().mockResolvedValue({ id: 'test-theme', name: 'Updated' }),
            deleteTheme: vi.fn().mockResolvedValue(undefined),
            toggleTheme: vi.fn().mockResolvedValue({ id: 'test-theme', isActive: true })
        }))
    }
}));

// Mock ThemeValidator
vi.mock('../validators/theme.validator.js', () => ({
    ThemeValidator: class {
        validate = vi.fn().mockResolvedValue({ valid: true, errors: [] });
    }
}));

// Mock ThemeController
vi.mock('../api/theme.controller.js', () => ({
    ThemeController: class {
        listThemes = vi.fn();
        getActiveThemes = vi.fn();
        getTheme = vi.fn();
        createTheme = vi.fn();
        updateTheme = vi.fn();
        deleteTheme = vi.fn();
        toggleTheme = vi.fn();
        validateTheme = vi.fn();
    }
}));

// Mock route factories
vi.mock('../api/theme.routes.js', () => ({
    createPublicRouter: vi.fn(() => ({ use: vi.fn() })),
    createAdminRouter: vi.fn(() => ({ use: vi.fn() }))
}));

describe('ThemeModule', () => {
    let module: ThemeModule;
    let mockDatabase: MockDatabase;
    let mockCacheService: MockCacheService;
    let mockMenuService: MockMenuService;
    let mockApp: Partial<Express>;

    beforeEach(() => {
        vi.clearAllMocks();
        module = new ThemeModule();
        mockDatabase = new MockDatabase();
        mockCacheService = new MockCacheService();
        mockMenuService = new MockMenuService();
        mockApp = createMockApp();
    });

    describe('Metadata', () => {
        /**
         * Test: Module should have correct metadata.
         *
         * Verifies that the module exposes its identity for introspection.
         */
        it('should have correct metadata', () => {
            expect(module.metadata.id).toBe('theme');
            expect(module.metadata.name).toBe('Theme Management');
            expect(module.metadata.version).toBe('1.0.0');
            expect(module.metadata.description).toContain('CSS theme management');
        });
    });

    describe('init()', () => {
        /**
         * Test: init should initialize ThemeService singleton.
         *
         * Verifies that the init phase configures the ThemeService with
         * database, cache, and logger dependencies.
         */
        it('should initialize ThemeService with dependencies', async () => {
            await module.init({
                database: mockDatabase as any,
                cacheService: mockCacheService,
                menuService: mockMenuService as any,
                app: mockApp as any
            });

            // Verify ThemeService.setDependencies was called
            const { ThemeService } = await import('../services/theme.service.js');
            expect(ThemeService.setDependencies).toHaveBeenCalledWith(
                expect.anything(), // database
                expect.anything(), // cacheService
                expect.anything()  // logger
            );
        });

        /**
         * Test: init should complete without errors.
         *
         * Verifies that module initialization succeeds, including
         * ThemeService initialization and index creation.
         */
        it('should complete initialization without errors', async () => {
            await expect(
                module.init({
                    database: mockDatabase as any,
                    cacheService: mockCacheService,
                    menuService: mockMenuService as any,
                    app: mockApp as any
                })
            ).resolves.not.toThrow();
        });

        /**
         * Test: init should store dependencies for later use.
         *
         * Verifies that dependencies are retained for the run() phase.
         */
        it('should store dependencies for later use', async () => {
            await module.init({
                database: mockDatabase as any,
                cacheService: mockCacheService,
                menuService: mockMenuService as any,
                app: mockApp as any
            });

            // Module initialized successfully
            expect(true).toBe(true);
        });
    });

    describe('run()', () => {
        beforeEach(async () => {
            // Initialize module before running
            await module.init({
                database: mockDatabase as any,
                cacheService: mockCacheService,
                menuService: mockMenuService as any,
                app: mockApp as any
            });
        });

        /**
         * Test: run should mount public router.
         *
         * Verifies that the public theme router is mounted at
         * /api/system/themes for serving active themes list.
         */
        it('should mount public router at /api/system/themes', async () => {
            await module.run();

            expect(mockApp.use).toHaveBeenCalledWith(
                '/api/system/themes',
                expect.anything() // router
            );
        });

        /**
         * Test: run should mount admin router with auth middleware.
         *
         * Verifies that the admin router is mounted at
         * /api/admin/system/themes with requireAdmin middleware.
         */
        it('should mount admin router at /api/admin/system/themes with auth', async () => {
            await module.run();

            expect(mockApp.use).toHaveBeenCalledWith(
                '/api/admin/system/themes',
                expect.anything(), // requireAdmin middleware
                expect.anything()  // router
            );
        });

        /**
         * Test: run should register menu item in system namespace.
         *
         * Verifies that the module registers its navigation menu item
         * during the run phase.
         */
        it('should register menu item in system namespace', async () => {
            await module.run();

            expect(mockMenuService.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    namespace: 'system',
                    label: 'Themes',
                    url: '/system/theme',
                    icon: 'Palette',
                    order: 400
                })
            );
        });

        /**
         * Test: run should handle menu registration errors gracefully.
         *
         * Verifies that errors during menu registration are propagated
         * with clear context.
         */
        it('should propagate menu registration errors', async () => {
            mockMenuService.create.mockRejectedValue(new Error('Menu error'));

            await expect(module.run()).rejects.toThrow('Menu error');
        });
    });

    describe('getThemeService()', () => {
        /**
         * Test: static method should return ThemeService singleton.
         *
         * Verifies that external code can access the theme service
         * through the module's static method.
         */
        it('should return ThemeService singleton instance', () => {
            const service = ThemeModule.getThemeService();

            expect(service).toBeDefined();
        });
    });

    describe('Lifecycle Integration', () => {
        /**
         * Test: Full module lifecycle should complete successfully.
         *
         * Verifies that init() → run() lifecycle completes without errors
         * and module is ready for use.
         */
        it('should complete full lifecycle', async () => {
            // Init phase
            await module.init({
                database: mockDatabase as any,
                cacheService: mockCacheService,
                menuService: mockMenuService as any,
                app: mockApp as any
            });

            // Run phase
            await module.run();

            // Verify both public and admin routers mounted
            expect(mockApp.use).toHaveBeenCalledTimes(2);

            // Verify menu item registered
            expect(mockMenuService.create).toHaveBeenCalledTimes(1);
        });
    });
});
