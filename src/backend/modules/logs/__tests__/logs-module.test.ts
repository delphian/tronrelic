/// <reference types="vitest" />

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LogsModule } from '../LogsModule.js';
import { AI_TOOL_NAMES } from '../ai-tools.js';
import { isValidMonitorLevels } from '../user-settings.js';
import { LOG_MONITOR_LEVELS_SETTING } from '@/types';
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
        it('should have correct metadata', () => {
            expect(module.metadata.id).toBe('logs');
            expect(module.metadata.name).toBe('Logs');
            expect(module.metadata.version).toBe('1.0.0');
            expect(module.metadata.description).toContain('logging');
        });
    });

    describe('init()', () => {
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

        it('should throw if getLogService called before init', () => {
            expect(() => module.getLogService()).toThrow(
                'LogsModule not initialized - call init() first'
            );
        });

        it('should throw if createRouter called before init', () => {
            expect(() => module.createRouter()).toThrow(
                'LogsModule not initialized - call init() first'
            );
        });
    });

    describe('run()', () => {
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
         * Build a fake core `'ai-tools'` registry with spied tool methods.
         */
        function createMockAiToolRegistry() {
            return {
                registerTool: vi.fn(),
                unregisterTool: vi.fn().mockReturnValue(false)
            };
        }

        /**
         * Covers the boot order where the AI tools module publishes the registry
         * after this module's run() sets up the watch.
         */
        it('should register log tools when the ai-tools registry becomes available', async () => {
            await module.init({
                pinoLogger: mockPino as any,
                database: mockDatabase as any,
                app: mockApp as any,
                serviceRegistry: mockServiceRegistry
            });
            await module.run();

            const ai = createMockAiToolRegistry();
            mockServiceRegistry.register('ai-tools', ai);

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
         * The synchronous-onAvailable semantics of watch() cover the case where
         * the registry registered before run().
         */
        it('should register log tools when the ai-tools registry is already registered', async () => {
            const ai = createMockAiToolRegistry();
            mockServiceRegistry.register('ai-tools', ai);

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
         * AI tooling stays optional — a throwing registerTool must not take the
         * logs module (and thus the application) down.
         */
        it('should not throw when tool registration fails', async () => {
            const ai = createMockAiToolRegistry();
            ai.registerTool.mockImplementation(() => {
                throw new Error('duplicate tool');
            });
            mockServiceRegistry.register('ai-tools', ai);

            await module.init({
                pinoLogger: mockPino as any,
                database: mockDatabase as any,
                app: mockApp as any,
                serviceRegistry: mockServiceRegistry
            });

            await expect(module.run()).resolves.not.toThrow();
        });
    });

    describe('Log viewer severity preference', () => {
        /**
         * Build a fake `'user-settings'` store with a spied registerDefinition.
         */
        function createMockUserSettings() {
            return { registerDefinition: vi.fn() };
        }

        /**
         * Covers the boot order where the identity module publishes the store
         * after this module's run() sets up the watch.
         */
        it('should register the preference when the user-settings store becomes available', async () => {
            await module.init({
                pinoLogger: mockPino as any,
                database: mockDatabase as any,
                app: mockApp as any,
                serviceRegistry: mockServiceRegistry
            });
            await module.run();

            const settings = createMockUserSettings();
            mockServiceRegistry.register('user-settings', settings);

            expect(settings.registerDefinition).toHaveBeenCalledTimes(1);
            const definition = settings.registerDefinition.mock.calls[0][0];
            expect(definition.namespace).toBe(LOG_MONITOR_LEVELS_SETTING.namespace);
            expect(definition.key).toBe(LOG_MONITOR_LEVELS_SETTING.key);
            expect(definition.userWritable).toBe(true);
            expect(definition.defaultValue).toEqual(['error']);
        });

        /** A display preference can never take the logs module down. */
        it('should not throw when preference registration fails', async () => {
            const settings = createMockUserSettings();
            settings.registerDefinition.mockImplementation(() => {
                throw new Error('store unavailable');
            });
            mockServiceRegistry.register('user-settings', settings);

            await module.init({
                pinoLogger: mockPino as any,
                database: mockDatabase as any,
                app: mockApp as any,
                serviceRegistry: mockServiceRegistry
            });

            await expect(module.run()).resolves.not.toThrow();
        });

        /**
         * The value comes from an untrusted request body, so anything other than
         * a short list of real levels must be rejected before it is stored.
         */
        it('should accept only lists of distinct known levels', () => {
            expect(isValidMonitorLevels(['error', 'warn'])).toBe(true);
            expect(isValidMonitorLevels([])).toBe(true);
            expect(isValidMonitorLevels(['error', 'error'])).toBe(false);
            expect(isValidMonitorLevels(['silent'])).toBe(false);
            expect(isValidMonitorLevels('error')).toBe(false);
            expect(isValidMonitorLevels([{ level: 'error' }])).toBe(false);
            expect(isValidMonitorLevels(null)).toBe(false);
        });
    });

    describe('createRouter()', () => {
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
