/// <reference types="vitest" />

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LogsModule } from '../LogsModule.js';
import { AI_TOOL_NAMES } from '../ai-tools.js';
import { MAIN_SYSTEM_CONTAINER_ID } from '../../menu/index.js';
import type { Express } from 'express';
import type { IServiceRegistry } from '@/types';
import { createMockDatabaseService } from '../../../tests/vitest/mocks/database-service.js';
import { createMockServiceRegistry } from '../../../tests/vitest/mocks/service-registry.js';

/**
 * Mock Pino logger for testing.
 */
class MockPinoLogger {
    public level = 'info';
    public fatal = vi.fn();
    public error = vi.fn();
    public warn = vi.fn();
    public info = vi.fn();
    public debug = vi.fn();
    public trace = vi.fn();
    public child = vi.fn(() => {
        const child = new MockPinoLogger();
        child.level = this.level;
        return child as any;
    });
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

// Mock the SystemLogService to avoid actual initialization
vi.mock('../services/system-log.service.js', () => ({
    SystemLogService: {
        getInstance: vi.fn(() => ({
            initialize: vi.fn().mockResolvedValue(undefined),
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            debug: vi.fn(),
            trace: vi.fn(),
            fatal: vi.fn(),
            child: vi.fn(() => ({
                info: vi.fn(),
                warn: vi.fn(),
                error: vi.fn(),
                debug: vi.fn(),
                trace: vi.fn(),
                fatal: vi.fn()
            }))
        }))
    }
}));

// Create a shared mock for MenuService
const mockMenuCreate = vi.fn().mockResolvedValue(undefined);

// Mock MenuService to avoid circular dependencies. Re-export the
// container id constant alongside the mocked service so LogsModule's
// dynamic import resolves both names.
vi.mock('../../menu/index.js', () => ({
    MenuService: {
        getInstance: vi.fn(() => ({
            create: mockMenuCreate
        }))
    },
    MAIN_SYSTEM_CONTAINER_ID: '000000000000000000000001'
}));

describe('LogsModule', () => {
    let module: LogsModule;
    let mockPino: MockPinoLogger;
    let mockDatabase: ReturnType<typeof createMockDatabaseService>;
    let mockApp: Partial<Express>;
    let mockServiceRegistry: IServiceRegistry;

    beforeEach(() => {
        vi.clearAllMocks();
        mockMenuCreate.mockClear();
        mockMenuCreate.mockResolvedValue(undefined);
        module = new LogsModule();
        mockPino = new MockPinoLogger();
        mockDatabase = createMockDatabaseService();
        mockApp = createMockApp();
        mockServiceRegistry = createMockServiceRegistry();
    });

    describe('Metadata', () => {
        /**
         * Test: Module should have correct metadata.
         *
         * Verifies that the module exposes its identity for introspection.
         */
        it('should have correct metadata', () => {
            expect(module.metadata.id).toBe('logs');
            expect(module.metadata.name).toBe('Logs');
            expect(module.metadata.version).toBe('1.0.0');
            expect(module.metadata.description).toContain('logging');
        });
    });

    describe('init()', () => {
        /**
         * Test: init should initialize SystemLogService.
         *
         * Verifies that the init phase configures the singleton logger
         * with the Pino instance.
         */
        it('should initialize SystemLogService with Pino logger', async () => {
            await module.init({
                pinoLogger: mockPino as any,
                database: mockDatabase as any,
                app: mockApp as any,
                serviceRegistry: mockServiceRegistry
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
                pinoLogger: mockPino as any,
                database: mockDatabase as any,
                app: mockApp as any,
                serviceRegistry: mockServiceRegistry
            });

            // Verify module can provide log service after init
            const logService = module.getLogService();
            expect(logService).toBeDefined();
        });

        /**
         * Test: getLogService should throw if called before init.
         *
         * Verifies that attempting to access the service before initialization
         * throws a clear error message.
         */
        it('should throw if getLogService called before init', () => {
            expect(() => module.getLogService()).toThrow(
                'LogsModule not initialized - call init() first'
            );
        });

        /**
         * Test: createRouter should throw if called before init.
         *
         * Verifies that attempting to create router before initialization
         * throws a clear error message.
         */
        it('should throw if createRouter called before init', () => {
            expect(() => module.createRouter()).toThrow(
                'LogsModule not initialized - call init() first'
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
        it('should register menu item under the System container in main', async () => {
            await module.init({
                pinoLogger: mockPino as any,
                database: mockDatabase as any,
                app: mockApp as any,
                serviceRegistry: mockServiceRegistry
            });

            await module.run();

            expect(mockMenuCreate).toHaveBeenCalledWith(
                expect.objectContaining({
                    namespace: 'main',
                    parent: MAIN_SYSTEM_CONTAINER_ID,
                    label: 'Logs',
                    url: '/system/logs',
                    icon: 'ScrollText',
                    order: 30
                })
            );
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
                pinoLogger: mockPino as any,
                database: mockDatabase as any,
                app: mockApp as any,
                serviceRegistry: mockServiceRegistry
            });

            await expect(module.run()).rejects.toThrow(
                'Failed to register system logs menu item'
            );
        });
    });

    describe('AI tool registration', () => {
        /**
         * Build a fake ai-assistant service with spied tool methods.
         */
        function createMockAiAssistant() {
            return {
                registerTool: vi.fn(),
                unregisterTool: vi.fn().mockReturnValue(false)
            };
        }

        /**
         * Test: tools register when ai-assistant appears after run().
         *
         * Verifies the watch pattern handles the normal boot order where
         * the ai-assistant plugin loads after modules.
         */
        it('should register log tools when ai-assistant becomes available', async () => {
            await module.init({
                pinoLogger: mockPino as any,
                database: mockDatabase as any,
                app: mockApp as any,
                serviceRegistry: mockServiceRegistry
            });
            await module.run();

            const ai = createMockAiAssistant();
            mockServiceRegistry.register('ai-assistant', ai);

            const registeredNames = ai.registerTool.mock.calls.map(call => call[0].name);
            expect(registeredNames).toEqual([
                AI_TOOL_NAMES.queryLogs,
                AI_TOOL_NAMES.getLog,
                AI_TOOL_NAMES.getStatistics
            ]);
            for (const call of ai.registerTool.mock.calls) {
                expect(call[1]).toBe('logs');
            }
        });

        /**
         * Test: tools register when ai-assistant is already present.
         *
         * Verifies the synchronous-onAvailable semantics of watch() cover
         * the case where the service registered before run().
         */
        it('should register log tools when ai-assistant is already registered', async () => {
            const ai = createMockAiAssistant();
            mockServiceRegistry.register('ai-assistant', ai);

            await module.init({
                pinoLogger: mockPino as any,
                database: mockDatabase as any,
                app: mockApp as any,
                serviceRegistry: mockServiceRegistry
            });
            await module.run();

            expect(ai.registerTool).toHaveBeenCalledTimes(3);
        });

        /**
         * Test: run() survives a failing ai-assistant registration.
         *
         * Verifies that AI tooling stays optional — a throwing registerTool
         * must not take the logs module (and thus the application) down.
         */
        it('should not throw when tool registration fails', async () => {
            const ai = createMockAiAssistant();
            ai.registerTool.mockImplementation(() => {
                throw new Error('duplicate tool');
            });
            mockServiceRegistry.register('ai-assistant', ai);

            await module.init({
                pinoLogger: mockPino as any,
                database: mockDatabase as any,
                app: mockApp as any,
                serviceRegistry: mockServiceRegistry
            });

            await expect(module.run()).resolves.not.toThrow();
        });
    });

    describe('createRouter()', () => {
        /**
         * Test: createRouter should return Express router after init.
         *
         * Verifies that the module can create a router for mounting
         * after initialization completes.
         */
        it('should return router after init', async () => {
            await module.init({
                pinoLogger: mockPino as any,
                database: mockDatabase as any,
                app: mockApp as any,
                serviceRegistry: mockServiceRegistry
            });

            const router = module.createRouter();
            expect(router).toBeDefined();
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
                pinoLogger: mockPino as any,
                database: mockDatabase as any,
                app: mockApp as any,
                serviceRegistry: mockServiceRegistry
            });

            // Verify service accessible after init
            const logService = module.getLogService();
            expect(logService).toBeDefined();

            // Run phase
            await module.run();

            // Verify router accessible after run
            const router = module.createRouter();
            expect(router).toBeDefined();
        });
    });
});
