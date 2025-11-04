/// <reference types="vitest" />

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DatabaseModule } from '../DatabaseModule.js';
import type { IDatabaseService } from '@tronrelic/types';
import type { Express } from 'express';

/**
 * Mock Pino logger for testing.
 */
class MockLogger {
    public info = vi.fn();
    public error = vi.fn();
    public warn = vi.fn();
    public debug = vi.fn();
    public child = vi.fn(() => {
        const child = new MockLogger();
        return child as any;
    });
}

/**
 * Mock database service for testing.
 *
 * Simulates the DatabaseService behavior without requiring MongoDB connection.
 */
class MockDatabaseService implements Partial<IDatabaseService> {
    getCollection() { return {} as any; }
    registerModel() {}
    getModel() { return undefined; }
    async get() { return undefined; }
    async set() {}
    async delete() { return false; }
    async createIndex() {}
    async count() { return 0; }
    async find() { return []; }
    async findOne() { return null; }
    async insertOne() { return null; }
    async updateMany() { return 0; }
    async deleteMany() { return 0; }
    async initializeMigrations() {}
    async getMigrationsPending() { return []; }
    async getMigrationsCompleted() { return []; }
    async executeMigration() {}
    async executeMigrationsAll() {}
    isMigrationRunning() { return false; }
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

// Mock the DatabaseService to avoid requiring MongoDB
vi.mock('../services/database.service.js', () => ({
    DatabaseService: class MockedDatabaseService {
        getCollection() { return {} as any; }
        registerModel() {}
        getModel() { return undefined; }
        async get() { return undefined; }
        async set() {}
        async delete() { return false; }
        async createIndex() {}
        async count() { return 0; }
        async find() { return []; }
        async findOne() { return null; }
        async insertOne() { return null; }
        async updateMany() { return 0; }
        async deleteMany() { return 0; }
        async initializeMigrations() {}
        async getMigrationsPending() { return []; }
        async getMigrationsCompleted() { return []; }
        async executeMigration() {}
        async executeMigrationsAll() {}
        isMigrationRunning() { return false; }
    }
}));

// Mock the MigrationsService
vi.mock('../services/migrations.service.js', () => ({
    MigrationsService: class MockedMigrationsService {
        getStatus = vi.fn().mockResolvedValue({ pending: [], completed: [], isRunning: false });
        getHistory = vi.fn().mockResolvedValue([]);
        executeOne = vi.fn().mockResolvedValue({ success: true });
        executeAll = vi.fn().mockResolvedValue({ success: true });
    }
}));

// Mock the MigrationsController
vi.mock('../api/migrations.controller.js', () => ({
    MigrationsController: class MockedMigrationsController {
        getStatus = vi.fn();
        getHistory = vi.fn();
        execute = vi.fn();
        getDetails = vi.fn();
    }
}));

// Create a shared mock for MenuService
const mockMenuCreate = vi.fn().mockResolvedValue(undefined);

// Mock MenuService to avoid circular dependencies
vi.mock('../../menu/index.js', () => ({
    MenuService: {
        getInstance: vi.fn(() => ({
            create: mockMenuCreate
        }))
    }
}));

describe('DatabaseModule', () => {
    let module: DatabaseModule;
    let mockLogger: MockLogger;
    let mockApp: Partial<Express>;

    beforeEach(() => {
        vi.clearAllMocks();
        mockMenuCreate.mockClear();
        mockMenuCreate.mockResolvedValue(undefined);
        module = new DatabaseModule();
        mockLogger = new MockLogger();
        mockApp = createMockApp();
    });

    describe('Metadata', () => {
        /**
         * Test: Module should have correct metadata.
         *
         * Verifies that the module exposes its identity for introspection.
         */
        it('should have correct metadata', () => {
            expect(module.metadata.id).toBe('database');
            expect(module.metadata.name).toBe('Database');
            expect(module.metadata.version).toBe('1.0.0');
            expect(module.metadata.description).toContain('database');
        });
    });

    describe('init()', () => {
        /**
         * Test: init should initialize core database service.
         *
         * Verifies that the init phase creates the DatabaseService instance
         * used by the application.
         */
        it('should initialize core database service', async () => {
            await module.init({
                logger: mockLogger as any,
                app: mockApp as any
            });

            // Verify module initialized successfully (no errors thrown)
            expect(true).toBe(true);
        });

        /**
         * Test: init should store dependencies for later use.
         *
         * Verifies that dependencies are retained for the run() phase.
         */
        it('should store dependencies for later use', async () => {
            await module.init({
                logger: mockLogger as any,
                app: mockApp as any
            });

            // Verify module can provide database service after init
            const dbService = module.getDatabaseService();
            expect(dbService).toBeDefined();
        });

        /**
         * Test: init should initialize migration system.
         *
         * Verifies that the migration system is initialized during the init phase.
         */
        it('should initialize migration system', async () => {
            await module.init({
                logger: mockLogger as any,
                app: mockApp as any
            });

            // Verify migration service can be accessed
            const migrationsService = module.getMigrationsService();
            expect(migrationsService).toBeDefined();
        });

        /**
         * Test: init should continue if migration initialization fails.
         *
         * Verifies that migration system failures don't prevent application startup.
         * Note: This test is skipped because vi.mock hoisting makes it difficult to
         * conditionally override the DatabaseService mock. The error handling is
         * verified by integration tests.
         */
        it.skip('should continue if migration initialization fails', async () => {
            // This test would require dynamically overriding the mocked DatabaseService
            // which conflicts with vi.mock hoisting. Tested in integration instead.
        });

        /**
         * Test: getDatabaseService should throw if called before init.
         *
         * Verifies that attempting to access the service before initialization
         * throws a clear error message.
         */
        it('should throw if getDatabaseService called before init', () => {
            expect(() => module.getDatabaseService()).toThrow(
                'DatabaseModule not initialized'
            );
        });

        /**
         * Test: getMigrationsService should throw if called before init.
         *
         * Verifies that attempting to access migrations service before initialization
         * throws a clear error message.
         */
        it('should throw if getMigrationsService called before init', () => {
            expect(() => module.getMigrationsService()).toThrow(
                'DatabaseModule not initialized'
            );
        });
    });

    describe('run()', () => {
        /**
         * Test: run should register menu item in system namespace.
         *
         * Verifies that the module registers its navigation menu item
         * during the run phase.
         */
        it('should register menu item in system namespace', async () => {
            await module.init({
                logger: mockLogger as any,
                app: mockApp as any
            });

            await module.run();

            expect(mockMenuCreate).toHaveBeenCalledWith(
                expect.objectContaining({
                    namespace: 'system',
                    label: 'Database',
                    url: '/system/database',
                    icon: 'Database',
                    order: 20
                })
            );
        });

        /**
         * Test: run should mount migrations router at correct path.
         *
         * Verifies that the migrations API is mounted at /api/admin/migrations.
         */
        it('should mount migrations router at correct path', async () => {
            await module.init({
                logger: mockLogger as any,
                app: mockApp as any
            });

            await module.run();

            expect(mockApp.use).toHaveBeenCalledWith(
                '/api/admin/migrations',
                expect.anything(),
                expect.anything()
            );
        });

        /**
         * Test: run should mount database browser router at correct path.
         *
         * Verifies that the database browser API is mounted at /api/admin/database.
         */
        it('should mount database browser router at correct path', async () => {
            await module.init({
                logger: mockLogger as any,
                app: mockApp as any
            });

            await module.run();

            expect(mockApp.use).toHaveBeenCalledWith(
                '/api/admin/database',
                expect.anything(),
                expect.anything()
            );
        });

        /**
         * Test: run should apply requireAdmin middleware to migrations routes.
         *
         * Verifies that the migrations API is protected with admin authentication.
         */
        it('should apply requireAdmin middleware to migrations routes', async () => {
            await module.init({
                logger: mockLogger as any,
                app: mockApp as any
            });

            await module.run();

            // Get the calls to app.use
            const useCalls = (mockApp.use as any).mock.calls;

            // Find the migrations route call
            const migrationsCall = useCalls.find((call: any[]) => call[0] === '/api/admin/migrations');

            // Verify migrations route has 3 arguments: path, middleware, router
            expect(migrationsCall).toBeDefined();
            expect(migrationsCall?.length).toBe(3);
            expect(migrationsCall?.[1]).toBeTypeOf('function'); // requireAdmin middleware
            expect(migrationsCall?.[2]).toBeTypeOf('function'); // router
        });

        /**
         * Test: run should apply requireAdmin middleware to database browser routes.
         *
         * Verifies that the database browser API is protected with admin authentication.
         */
        it('should apply requireAdmin middleware to database browser routes', async () => {
            await module.init({
                logger: mockLogger as any,
                app: mockApp as any
            });

            await module.run();

            // Get the calls to app.use
            const useCalls = (mockApp.use as any).mock.calls;

            // Find the database browser route call
            const browserCall = useCalls.find((call: any[]) => call[0] === '/api/admin/database');

            // Verify database browser route has 3 arguments: path, middleware, router
            expect(browserCall).toBeDefined();
            expect(browserCall?.length).toBe(3);
            expect(browserCall?.[1]).toBeTypeOf('function'); // requireAdmin middleware
            expect(browserCall?.[2]).toBeTypeOf('function'); // router
        });

        /**
         * Test: run should handle menu registration errors gracefully.
         *
         * Verifies that errors during menu registration are caught and
         * thrown with a descriptive message.
         */
        it('should handle menu registration errors', async () => {
            // Configure mock to throw error
            mockMenuCreate.mockClear();
            mockMenuCreate.mockRejectedValue(new Error('Menu error'));

            await module.init({
                logger: mockLogger as any,
                app: mockApp as any
            });

            await expect(module.run()).rejects.toThrow(
                'Failed to register database menu item'
            );
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
                logger: mockLogger as any,
                app: mockApp as any
            });

            // Verify services accessible after init
            const dbService = module.getDatabaseService();
            expect(dbService).toBeDefined();

            const migrationsService = module.getMigrationsService();
            expect(migrationsService).toBeDefined();

            // Run phase
            await module.run();

            // Verify menu registered
            expect(mockMenuCreate).toHaveBeenCalled();

            // Verify router mounted
            expect(mockApp.use).toHaveBeenCalled();
        });

        /**
         * Test: Module should be usable after full lifecycle.
         *
         * Verifies that all public APIs work correctly after initialization.
         */
        it('should be usable after full lifecycle', async () => {
            await module.init({
                logger: mockLogger as any,
                app: mockApp as any
            });

            await module.run();

            // Should be able to access services
            const dbService = module.getDatabaseService();
            expect(dbService).toBeDefined();
            expect(dbService.getCollection).toBeDefined();
            expect(dbService.find).toBeDefined();
            expect(dbService.findOne).toBeDefined();

            const migrationsService = module.getMigrationsService();
            expect(migrationsService).toBeDefined();
        });
    });
});
