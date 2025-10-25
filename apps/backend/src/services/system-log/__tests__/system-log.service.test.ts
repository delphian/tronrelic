/// <reference types="vitest" />

import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import type pino from 'pino';
import type { ISystemLogQuery, ISaveLogData, LogLevel } from '@tronrelic/types';
import { SystemLogService } from '../system-log.service.js';
import { SystemLog } from '../database/SystemLog.js';

/**
 * Mock Pino logger implementation for testing.
 *
 * Provides a minimal Pino-compatible interface with spy functions to verify
 * that the service properly delegates logging calls to the underlying logger.
 * Also tracks level changes to verify runtime configuration updates.
 */
class MockPinoLogger {
    public level: string = 'info';
    public fatal = vi.fn();
    public error = vi.fn();
    public warn = vi.fn();
    public info = vi.fn();
    public debug = vi.fn();
    public trace = vi.fn();
    public child = vi.fn((bindings: pino.Bindings) => {
        const childLogger = new MockPinoLogger();
        childLogger.level = this.level;
        return childLogger;
    });
}

// Mock the SystemLog model - must be defined inline in vi.mock() factory
vi.mock('../database/SystemLog.js', () => ({
    SystemLog: {
        create: vi.fn(),
        find: vi.fn(() => ({
            sort: vi.fn(() => ({
                skip: vi.fn(() => ({
                    limit: vi.fn(() => ({
                        lean: vi.fn(() => ({
                            exec: vi.fn()
                        }))
                    }))
                }))
            }))
        })),
        findById: vi.fn(() => ({
            lean: vi.fn(() => ({
                exec: vi.fn()
            }))
        })),
        findByIdAndUpdate: vi.fn(() => ({
            lean: vi.fn(() => ({
                exec: vi.fn()
            })),
            exec: vi.fn()
        })),
        countDocuments: vi.fn(() => ({
            exec: vi.fn()
        })),
        aggregate: vi.fn(() => ({
            exec: vi.fn()
        })),
        deleteMany: vi.fn(() => ({
            exec: vi.fn()
        }))
    }
}));

describe('SystemLogService', () => {
    let service: SystemLogService;
    let mockPino: MockPinoLogger;
    let consoleLogSpy: Mock;
    let consoleWarnSpy: Mock;
    let consoleErrorSpy: Mock;
    let consoleDebugSpy: Mock;

    beforeEach(() => {
        // Clear all mocks before each test
        vi.clearAllMocks();

        // Create fresh mock Pino logger
        mockPino = new MockPinoLogger();

        // Spy on console methods for fallback testing
        consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        consoleDebugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});

        // Reset singleton
        (SystemLogService as any).instance = undefined;
        service = SystemLogService.getInstance();

        // Reset SystemLog mock to default behavior
        vi.mocked(SystemLog.find).mockReturnValue({
            sort: vi.fn().mockReturnValue({
                skip: vi.fn().mockReturnValue({
                    limit: vi.fn().mockReturnValue({
                        lean: vi.fn().mockReturnValue({
                            exec: vi.fn().mockResolvedValue([])
                        })
                    })
                })
            })
        } as any);

        vi.mocked(SystemLog.countDocuments).mockReturnValue({
            exec: vi.fn().mockResolvedValue(0)
        } as any);
    });

    afterEach(() => {
        // Reset singleton and restore console
        (SystemLogService as any).instance = undefined;
        vi.restoreAllMocks();
    });

    // ========================================================================
    // Singleton Pattern Tests
    // ========================================================================

    describe('Singleton Pattern', () => {
        /**
         * Test: SystemLogService should create singleton instance on first getInstance call.
         *
         * Verifies that getInstance() creates a new instance and stores it as the singleton.
         */
        it('should create singleton instance on first getInstance call', () => {
            expect(service).toBeInstanceOf(SystemLogService);
        });

        /**
         * Test: SystemLogService should return same instance on subsequent getInstance calls.
         *
         * Verifies that getInstance() always returns the same singleton instance,
         * ensuring consistent state across the application.
         */
        it('should return same instance on subsequent getInstance calls', () => {
            const instance1 = SystemLogService.getInstance();
            const instance2 = SystemLogService.getInstance();
            expect(instance1).toBe(instance2);
            expect(instance1).toBe(service);
        });
    });

    // ========================================================================
    // Initialization Tests
    // ========================================================================

    describe('Initialization', () => {
        /**
         * Test: Should throw error if initialized without Pino logger.
         *
         * Verifies that calling initialize() without a logger argument throws
         * a clear error guiding developers to provide the required dependency.
         */
        it('should throw error if initialized without Pino logger', async () => {
            await expect(service.initialize()).rejects.toThrow(
                'SystemLogService.initialize() requires a Pino logger instance'
            );
        });

        /**
         * Test: Should successfully initialize with Pino logger.
         *
         * Verifies that initialize() accepts a Pino logger and logs a confirmation message.
         */
        it('should successfully initialize with Pino logger', async () => {
            await service.initialize(mockPino as any);
            expect(mockPino.info).toHaveBeenCalledWith('SystemLogService initialized');
        });

        /**
         * Test: Should not initialize twice.
         *
         * Verifies that calling initialize() multiple times does not re-initialize
         * or call the Pino logger again, preventing duplicate initialization.
         */
        it('should not initialize twice', async () => {
            await service.initialize(mockPino as any);
            expect(mockPino.info).toHaveBeenCalledTimes(1);

            // Clear the mock and try initializing again
            mockPino.info.mockClear();
            await service.initialize(mockPino as any);

            // Should not call info again
            expect(mockPino.info).not.toHaveBeenCalled();
        });
    });

    // ========================================================================
    // Log Level Management Tests
    // ========================================================================

    describe('Log Level Management', () => {
        /**
         * Test: Should default to 'debug' level when not initialized.
         *
         * Verifies that the level getter returns 'debug' before initialization.
         */
        it('should default to "debug" level when not initialized', () => {
            expect(service.level).toBe('debug');
        });

        /**
         * Test: Should return Pino level after initialization.
         *
         * Verifies that the level getter returns the Pino logger's level after initialization.
         */
        it('should return Pino level after initialization', async () => {
            mockPino.level = 'warn';
            await service.initialize(mockPino as any);
            expect(service.level).toBe('warn');
        });

        /**
         * Test: Should update Pino level when level setter is called.
         *
         * Verifies that setting the level property updates the underlying Pino logger's level.
         */
        it('should update Pino level when level setter is called', async () => {
            await service.initialize(mockPino as any);
            service.level = 'error';
            expect(mockPino.level).toBe('error');
        });

        /**
         * Test: Should not crash when setting level before initialization.
         *
         * Verifies that setting the level before initialization does not throw an error.
         */
        it('should not crash when setting level before initialization', () => {
            expect(() => {
                service.level = 'warn';
            }).not.toThrow();
        });

        /**
         * Test: Should apply log level from SystemConfig during initialization.
         *
         * Verifies that initialize() reads logLevel from SystemConfig and applies it
         * to the Pino logger, enabling runtime log level configuration.
         */
        it('should apply log level from SystemConfig during initialization', async () => {
            // Mock SystemConfigService.getConfig() to return a config with logLevel 'debug'
            const mockSystemConfigService = {
                getConfig: vi.fn().mockResolvedValue({
                    key: 'system',
                    siteUrl: 'http://localhost:3000',
                    systemLogsMaxCount: 1000000,
                    systemLogsRetentionDays: 30,
                    logLevel: 'debug',
                    updatedAt: new Date()
                })
            };

            // Mock the dynamic import of SystemConfigService
            vi.doMock('../../system-config/system-config.service.js', () => ({
                SystemConfigService: {
                    getInstance: vi.fn().mockReturnValue(mockSystemConfigService)
                }
            }));

            mockPino.level = 'info'; // Start with 'info'
            await service.initialize(mockPino as any);

            // Wait for async applyLogLevelFromConfig to complete
            await new Promise(resolve => setTimeout(resolve, 50));

            // Verify level was changed to 'debug' from SystemConfig
            expect(mockPino.level).toBe('debug');
        });

        /**
         * Test: applyLogLevelFromConfig() should update logger level.
         *
         * Verifies that calling applyLogLevelFromConfig() manually updates the
         * Pino logger level based on the current SystemConfig value.
         */
        it('should update logger level when applyLogLevelFromConfig is called', async () => {
            // Mock SystemConfigService.getConfig() to return a config with logLevel 'warn'
            const mockSystemConfigService = {
                getConfig: vi.fn().mockResolvedValue({
                    key: 'system',
                    siteUrl: 'http://localhost:3000',
                    systemLogsMaxCount: 1000000,
                    systemLogsRetentionDays: 30,
                    logLevel: 'warn',
                    updatedAt: new Date()
                })
            };

            // Mock the dynamic import of SystemConfigService
            vi.doMock('../../system-config/system-config.service.js', () => ({
                SystemConfigService: {
                    getInstance: vi.fn().mockReturnValue(mockSystemConfigService)
                }
            }));

            await service.initialize(mockPino as any);
            mockPino.level = 'info'; // Set to 'info' after initialization

            // Manually call applyLogLevelFromConfig
            await service.applyLogLevelFromConfig();

            // Verify level was updated to 'warn' from SystemConfig
            expect(mockPino.level).toBe('warn');
        });

        /**
         * Test: applyLogLevelFromConfig() should handle missing SystemConfig gracefully.
         *
         * Verifies that if SystemConfig is unavailable or fails to load, the method
         * logs a warning but doesn't throw an error or crash the application.
         */
        it('should handle SystemConfig errors gracefully', async () => {
            // Mock SystemConfigService to throw an error
            const mockSystemConfigService = {
                getConfig: vi.fn().mockRejectedValue(new Error('Database unavailable'))
            };

            vi.doMock('../../system-config/system-config.service.js', () => ({
                SystemConfigService: {
                    getInstance: vi.fn().mockReturnValue(mockSystemConfigService)
                }
            }));

            await service.initialize(mockPino as any);

            // Should not throw
            await expect(service.applyLogLevelFromConfig()).resolves.toBeUndefined();

            // Should log warning to stderr
            expect(consoleWarnSpy).toHaveBeenCalledWith(
                'Failed to apply log level from SystemConfig, using default:',
                expect.any(Error)
            );
        });
    });

    // ========================================================================
    // Logging Methods Tests (Before Initialization)
    // ========================================================================

    describe('Logging Methods (Before Initialization)', () => {
        /**
         * Test: info() should fall back to console.log before initialization.
         */
        it('should fall back to console.log for info() before initialization', () => {
            service.info('Test message');
            expect(consoleLogSpy).toHaveBeenCalledWith('[INFO]', 'Test message', undefined);
        });

        /**
         * Test: warn() should fall back to console.warn before initialization.
         */
        it('should fall back to console.warn for warn() before initialization', () => {
            service.warn('Test warning');
            expect(consoleWarnSpy).toHaveBeenCalledWith('[WARN]', 'Test warning', undefined);
        });

        /**
         * Test: error() should fall back to console.error before initialization.
         */
        it('should fall back to console.error for error() before initialization', () => {
            service.error('Test error');
            expect(consoleErrorSpy).toHaveBeenCalledWith('[ERROR]', 'Test error', undefined);
        });

        /**
         * Test: debug() should fall back to console.debug before initialization.
         */
        it('should fall back to console.debug for debug() before initialization', () => {
            service.debug('Test debug');
            expect(consoleDebugSpy).toHaveBeenCalledWith('[DEBUG]', 'Test debug', undefined);
        });

        /**
         * Test: trace() should fall back to console.debug before initialization.
         */
        it('should fall back to console.debug for trace() before initialization', () => {
            service.trace('Test trace');
            expect(consoleDebugSpy).toHaveBeenCalledWith('[TRACE]', 'Test trace', undefined);
        });

        /**
         * Test: fatal() should fall back to console.error before initialization.
         */
        it('should fall back to console.error for fatal() before initialization', () => {
            service.fatal('Test fatal');
            expect(consoleErrorSpy).toHaveBeenCalledWith('[FATAL]', 'Test fatal', undefined);
        });
    });

    // ========================================================================
    // Logging Methods Tests (After Initialization)
    // ========================================================================

    describe('Logging Methods (After Initialization)', () => {
        beforeEach(async () => {
            await service.initialize(mockPino as any);
        });

        /**
         * Test: info() should delegate to Pino logger.
         */
        it('should delegate info() to Pino logger', () => {
            service.info('Test message');
            expect(mockPino.info).toHaveBeenCalledWith('Test message', undefined);
        });

        /**
         * Test: info() should support structured logging with object.
         */
        it('should support structured logging with object in info()', () => {
            const metadata = { userId: 123 };
            service.info(metadata, 'User logged in');
            expect(mockPino.info).toHaveBeenCalledWith(metadata, 'User logged in');
        });

        /**
         * Test: warn() should delegate to Pino logger.
         */
        it('should delegate warn() to Pino logger', () => {
            service.warn('Test warning');
            expect(mockPino.warn).toHaveBeenCalledWith('Test warning', undefined);
        });

        /**
         * Test: warn() should support structured logging with object.
         */
        it('should support structured logging with object in warn()', () => {
            const metadata = { service: 'auth' };
            service.warn(metadata, 'Rate limit exceeded');
            expect(mockPino.warn).toHaveBeenCalledWith(metadata, 'Rate limit exceeded');
        });

        /**
         * Test: error() should delegate to Pino logger.
         */
        it('should delegate error() to Pino logger', () => {
            service.error('Test error');
            expect(mockPino.error).toHaveBeenCalledWith('Test error', undefined);
        });

        /**
         * Test: error() should support structured logging with object.
         */
        it('should support structured logging with object in error()', () => {
            const error = new Error('Database connection failed');
            service.error({ error }, 'DB error');
            expect(mockPino.error).toHaveBeenCalledWith({ error }, 'DB error');
        });

        /**
         * Test: debug() should delegate to Pino logger.
         */
        it('should delegate debug() to Pino logger', () => {
            service.debug('Test debug');
            expect(mockPino.debug).toHaveBeenCalledWith('Test debug', undefined);
        });

        /**
         * Test: trace() should delegate to Pino logger.
         */
        it('should delegate trace() to Pino logger', () => {
            service.trace('Test trace');
            expect(mockPino.trace).toHaveBeenCalledWith('Test trace', undefined);
        });

        /**
         * Test: fatal() should delegate to Pino logger.
         */
        it('should delegate fatal() to Pino logger', () => {
            service.fatal('Test fatal');
            expect(mockPino.fatal).toHaveBeenCalledWith('Test fatal', undefined);
        });
    });

    // ========================================================================
    // MongoDB Integration Tests
    // ========================================================================

    describe('MongoDB Integration', () => {
        beforeEach(async () => {
            await service.initialize(mockPino as any);
        });

        /**
         * Test: warn() should save log to MongoDB with structured logging.
         *
         * Uses the recommended Pino pattern: logger.warn(obj, message)
         * This ensures both context metadata and message are captured correctly.
         */
        it('should save warn() logs to MongoDB with structured logging', async () => {
            service.warn({ component: 'test' }, 'Test warning');

            // Wait for async saveLog call
            await new Promise(resolve => setTimeout(resolve, 10));

            expect(SystemLog.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    level: 'warn',
                    message: 'Test warning',
                    service: 'tronrelic-backend',
                    context: { component: 'test' },
                    resolved: false
                })
            );
        });

        /**
         * Test: error() should save log to MongoDB with structured logging.
         */
        it('should save error() logs to MongoDB with structured logging', async () => {
            const error = new Error('Test error');
            service.error({ error }, 'Test error');

            // Wait for async saveLog call
            await new Promise(resolve => setTimeout(resolve, 10));

            expect(SystemLog.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    level: 'error',
                    message: 'Test error',
                    service: 'tronrelic-backend',
                    resolved: false
                })
            );
        });

        /**
         * Test: fatal() should save log to MongoDB as fatal level with structured logging.
         */
        it('should save fatal() logs to MongoDB as fatal level with structured logging', async () => {
            service.fatal({ critical: true }, 'Test fatal');

            // Wait for async saveLog call
            await new Promise(resolve => setTimeout(resolve, 10));

            expect(SystemLog.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    level: 'fatal',
                    message: 'Test fatal',
                    context: { critical: true },
                    resolved: false
                })
            );
        });

        /**
         * Test: info() should save log to MongoDB when log level permits.
         */
        it('should save info() logs to MongoDB when log level permits', async () => {
            service.info({ metadata: 'test' }, 'Test info');

            // Wait for async saveLog call
            await new Promise(resolve => setTimeout(resolve, 10));

            // Info logs are now saved to database when level permits (default is 'info')
            expect(SystemLog.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    level: 'info',
                    message: 'Test info',
                    context: { metadata: 'test' },
                    resolved: false
                })
            );
        });

        /**
         * Test: debug() should NOT save log to MongoDB.
         */
        it('should NOT save debug() logs to MongoDB', async () => {
            service.debug('Test debug');

            // Wait to ensure no async call is made
            await new Promise(resolve => setTimeout(resolve, 10));

            expect(SystemLog.create).not.toHaveBeenCalled();
        });

        /**
         * Test: Should extract service from metadata.
         */
        it('should extract service from metadata', async () => {
            service.error({ service: 'custom-service' }, 'Custom service error');

            await new Promise(resolve => setTimeout(resolve, 10));

            expect(SystemLog.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    service: 'custom-service'
                })
            );
        });

        /**
         * Test: Should extract service from pluginId.
         */
        it('should extract service from pluginId', async () => {
            service.error({ pluginId: 'whale-alerts' }, 'Plugin error');

            await new Promise(resolve => setTimeout(resolve, 10));

            expect(SystemLog.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    service: 'whale-alerts'
                })
            );
        });

        /**
         * Test: Should extract service from pluginTitle.
         */
        it('should extract service from pluginTitle', async () => {
            service.error({ pluginTitle: 'Whale Alerts' }, 'Plugin error');

            await new Promise(resolve => setTimeout(resolve, 10));

            expect(SystemLog.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    service: 'Whale Alerts'
                })
            );
        });

        /**
         * Test: Should append module to service name.
         */
        it('should append module to service name', async () => {
            service.error({ module: 'blockchain' }, 'Module error');

            await new Promise(resolve => setTimeout(resolve, 10));

            expect(SystemLog.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    service: 'tronrelic-backend:blockchain'
                })
            );
        });

        /**
         * Test: Should handle MongoDB save failures gracefully.
         */
        it('should handle MongoDB save failures gracefully', async () => {
            vi.mocked(SystemLog.create).mockRejectedValueOnce(new Error('DB error'));

            // Should not throw
            expect(() => service.error('Test error')).not.toThrow();

            await new Promise(resolve => setTimeout(resolve, 10));

            // Should log to stderr
            expect(consoleErrorSpy).toHaveBeenCalledWith(
                'Failed to save log entry to MongoDB:',
                expect.any(Error)
            );
        });
    });

    // ========================================================================
    // Child Logger Tests
    // ========================================================================

    describe('Child Logger', () => {
        /**
         * Test: Should create child logger before initialization.
         */
        it('should create child logger before initialization', () => {
            const child = service.child({ module: 'test' });
            expect(child).toBeInstanceOf(SystemLogService);
            expect(child).not.toBe(service);
        });

        /**
         * Test: Should create child logger after initialization.
         */
        it('should create child logger after initialization', async () => {
            await service.initialize(mockPino as any);
            const child = service.child({ module: 'test' });

            expect(child).toBeInstanceOf(SystemLogService);
            expect(child).not.toBe(service);
            expect(mockPino.child).toHaveBeenCalledWith({ module: 'test' });
        });

        /**
         * Test: Child logger should delegate to Pino child.
         */
        it('should delegate child logger calls to Pino child', async () => {
            await service.initialize(mockPino as any);
            const child = service.child({ module: 'test' });

            // The child should have its own Pino instance
            child.info('Child log');

            // Should have called child() on parent Pino
            expect(mockPino.child).toHaveBeenCalled();
        });

        /**
         * Test: Child logger bindings should be preserved in MongoDB logs.
         */
        it('should preserve child logger bindings in MongoDB logs', async () => {
            await service.initialize(mockPino as any);

            // Create child logger with pluginId
            const childLogger = service.child({ pluginId: 'whale-alerts', pluginTitle: 'Whale Alerts' });

            // Log an error without additional metadata
            childLogger.error('Plugin error occurred');

            await new Promise(resolve => setTimeout(resolve, 10));

            // Should save with child bindings
            expect(SystemLog.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    service: 'whale-alerts',
                    context: expect.objectContaining({
                        pluginId: 'whale-alerts',
                        pluginTitle: 'Whale Alerts'
                    })
                })
            );
        });

        /**
         * Test: Call-time metadata should override child logger bindings.
         */
        it('should allow call-time metadata to override child bindings', async () => {
            await service.initialize(mockPino as any);

            // Create child logger with module binding
            const childLogger = service.child({ module: 'blockchain' });

            // Log with call-time override
            childLogger.error({ module: 'markets', extra: 'data' }, 'Override test');

            await new Promise(resolve => setTimeout(resolve, 10));

            // Call-time metadata should take precedence
            expect(SystemLog.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    service: 'tronrelic-backend:markets',
                    context: expect.objectContaining({
                        module: 'markets',
                        extra: 'data'
                    })
                })
            );
        });

        /**
         * Test: Nested child loggers should merge bindings.
         */
        it('should merge bindings in nested child loggers', async () => {
            await service.initialize(mockPino as any);

            // Create parent child logger
            const parentChild = service.child({ pluginId: 'test-plugin' });

            // Create nested child
            const nestedChild = parentChild.child({ service: 'observer' });

            // Log from nested child
            nestedChild.error('Nested error');

            await new Promise(resolve => setTimeout(resolve, 10));

            // Should have both parent and child bindings, child takes precedence
            expect(SystemLog.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    service: 'observer',
                    context: expect.objectContaining({
                        pluginId: 'test-plugin',
                        service: 'observer'
                    })
                })
            );
        });
    });

    // ========================================================================
    // saveLog() Tests
    // ========================================================================

    describe('saveLog()', () => {
        /**
         * Test: Should save log with all fields.
         */
        it('should save log with all fields', async () => {
            const logData: ISaveLogData = {
                level: 'error',
                message: 'Test error message',
                metadata: { userId: 123, action: 'login' },
                timestamp: new Date('2025-01-01T00:00:00.000Z')
            };

            await service.saveLog(logData);

            expect(SystemLog.create).toHaveBeenCalledWith({
                timestamp: logData.timestamp,
                level: 'error',
                message: 'Test error message',
                service: 'tronrelic-backend',
                context: { userId: 123, action: 'login' },
                resolved: false
            } as any);
        });

        /**
         * Test: Should handle saveLog errors gracefully.
         */
        it('should handle saveLog errors gracefully', async () => {
            vi.mocked(SystemLog.create).mockRejectedValueOnce(new Error('DB error'));

            // Should not throw
            await expect(service.saveLog({
                level: 'error',
                message: 'Test',
                metadata: {},
                timestamp: new Date()
            })).resolves.toBeUndefined();

            expect(consoleErrorSpy).toHaveBeenCalledWith(
                'Failed to save log entry to MongoDB:',
                expect.any(Error)
            );
        });
    });

    // ========================================================================
    // getLogs() Tests
    // ========================================================================

    describe('getLogs()', () => {
        /**
         * Test: Should fetch logs with default pagination.
         */
        it('should fetch logs with default pagination', async () => {
            const mockLogs = [
                { _id: '1', message: 'Log 1' },
                { _id: '2', message: 'Log 2' }
            ];

            const execMock = vi.fn().mockResolvedValue(mockLogs);
            const countExecMock = vi.fn().mockResolvedValue(2);

            vi.mocked(SystemLog.find).mockReturnValue({
                sort: vi.fn().mockReturnValue({
                    skip: vi.fn().mockReturnValue({
                        limit: vi.fn().mockReturnValue({
                            lean: vi.fn().mockReturnValue({
                                exec: execMock
                            })
                        })
                    })
                })
            } as any);

            vi.mocked(SystemLog.countDocuments).mockReturnValue({
                exec: countExecMock
            } as any);

            const result = await service.getLogs();

            expect(result).toEqual({
                logs: mockLogs,
                total: 2,
                page: 1,
                limit: 50,
                totalPages: 1,
                hasNextPage: false,
                hasPrevPage: false
            });
        });

        /**
         * Test: Should filter logs by level.
         */
        it('should filter logs by level', async () => {
            const query: ISystemLogQuery = {
                levels: ['error', 'warn']
            };

            const execMock = vi.fn().mockResolvedValue([]);
            const countExecMock = vi.fn().mockResolvedValue(0);

            vi.mocked(SystemLog.find).mockReturnValue({
                sort: vi.fn().mockReturnValue({
                    skip: vi.fn().mockReturnValue({
                        limit: vi.fn().mockReturnValue({
                            lean: vi.fn().mockReturnValue({
                                exec: execMock
                            })
                        })
                    })
                })
            } as any);

            vi.mocked(SystemLog.countDocuments).mockReturnValue({
                exec: countExecMock
            } as any);

            await service.getLogs(query);

            expect(SystemLog.find).toHaveBeenCalledWith({
                level: { $in: ['error', 'warn'] }
            });
        });

        /**
         * Test: Should filter logs by service.
         */
        it('should filter logs by service', async () => {
            const query: ISystemLogQuery = {
                service: 'whale-alerts'
            };

            const execMock = vi.fn().mockResolvedValue([]);
            const countExecMock = vi.fn().mockResolvedValue(0);

            vi.mocked(SystemLog.find).mockReturnValue({
                sort: vi.fn().mockReturnValue({
                    skip: vi.fn().mockReturnValue({
                        limit: vi.fn().mockReturnValue({
                            lean: vi.fn().mockReturnValue({
                                exec: execMock
                            })
                        })
                    })
                })
            } as any);

            vi.mocked(SystemLog.countDocuments).mockReturnValue({
                exec: countExecMock
            } as any);

            await service.getLogs(query);

            expect(SystemLog.find).toHaveBeenCalledWith({
                service: 'whale-alerts'
            });
        });

        /**
         * Test: Should filter logs by resolved status.
         */
        it('should filter logs by resolved status', async () => {
            const query: ISystemLogQuery = {
                resolved: false
            };

            const execMock = vi.fn().mockResolvedValue([]);
            const countExecMock = vi.fn().mockResolvedValue(0);

            vi.mocked(SystemLog.find).mockReturnValue({
                sort: vi.fn().mockReturnValue({
                    skip: vi.fn().mockReturnValue({
                        limit: vi.fn().mockReturnValue({
                            lean: vi.fn().mockReturnValue({
                                exec: execMock
                            })
                        })
                    })
                })
            } as any);

            vi.mocked(SystemLog.countDocuments).mockReturnValue({
                exec: countExecMock
            } as any);

            await service.getLogs(query);

            expect(SystemLog.find).toHaveBeenCalledWith({
                resolved: false
            });
        });

        /**
         * Test: Should filter logs by date range.
         */
        it('should filter logs by date range', async () => {
            const startDate = new Date('2025-01-01');
            const endDate = new Date('2025-01-31');

            const query: ISystemLogQuery = {
                startDate,
                endDate
            };

            const execMock = vi.fn().mockResolvedValue([]);
            const countExecMock = vi.fn().mockResolvedValue(0);

            vi.mocked(SystemLog.find).mockReturnValue({
                sort: vi.fn().mockReturnValue({
                    skip: vi.fn().mockReturnValue({
                        limit: vi.fn().mockReturnValue({
                            lean: vi.fn().mockReturnValue({
                                exec: execMock
                            })
                        })
                    })
                })
            } as any);

            vi.mocked(SystemLog.countDocuments).mockReturnValue({
                exec: countExecMock
            } as any);

            await service.getLogs(query);

            expect(SystemLog.find).toHaveBeenCalledWith({
                timestamp: {
                    $gte: startDate,
                    $lte: endDate
                }
            });
        });

        /**
         * Test: Should handle pagination correctly.
         */
        it('should handle pagination correctly', async () => {
            const query: ISystemLogQuery = {
                page: 2,
                limit: 10
            };

            const mockLogs = Array.from({ length: 10 }, (_, i) => ({
                _id: String(i),
                message: `Log ${i}`
            }));

            const execMock = vi.fn().mockResolvedValue(mockLogs);
            const countExecMock = vi.fn().mockResolvedValue(25);

            vi.mocked(SystemLog.find).mockReturnValue({
                sort: vi.fn().mockReturnValue({
                    skip: vi.fn().mockReturnValue({
                        limit: vi.fn().mockReturnValue({
                            lean: vi.fn().mockReturnValue({
                                exec: execMock
                            })
                        })
                    })
                })
            } as any);

            vi.mocked(SystemLog.countDocuments).mockReturnValue({
                exec: countExecMock
            } as any);

            const result = await service.getLogs(query);

            expect(result).toEqual({
                logs: mockLogs,
                total: 25,
                page: 2,
                limit: 10,
                totalPages: 3,
                hasNextPage: true,
                hasPrevPage: true
            });
        });
    });

    // ========================================================================
    // markAsResolved() Tests
    // ========================================================================

    describe('markAsResolved()', () => {
        /**
         * Test: Should mark log as resolved.
         */
        it('should mark log as resolved', async () => {
            const execMock = vi.fn().mockResolvedValue({
                _id: 'log123',
                resolved: true
            });

            vi.mocked(SystemLog.findByIdAndUpdate).mockReturnValue({
                exec: execMock
            } as any);

            await service.markAsResolved('log123', 'admin@example.com');

            expect(SystemLog.findByIdAndUpdate).toHaveBeenCalledWith(
                'log123',
                {
                    resolved: true,
                    resolvedAt: expect.any(Date),
                    resolvedBy: 'admin@example.com'
                },
                { new: true }
            );
        });
    });

    // ========================================================================
    // getStatistics() Tests
    // ========================================================================

    describe('getStatistics()', () => {
        /**
         * Test: Should return statistics.
         */
        it('should return statistics', async () => {
            const countExecMock = vi.fn().mockResolvedValue(100);
            const levelAggregateExecMock = vi.fn().mockResolvedValue([
                { _id: 'error', count: 40 },
                { _id: 'warn', count: 30 }
            ]);
            const serviceAggregateExecMock = vi.fn().mockResolvedValue([
                { _id: 'tronrelic-backend', count: 50 },
                { _id: 'whale-alerts', count: 30 }
            ]);
            const unresolvedExecMock = vi.fn().mockResolvedValue(25);

            vi.mocked(SystemLog.countDocuments).mockReturnValue({
                exec: countExecMock
            } as any);

            vi.mocked(SystemLog.aggregate)
                .mockReturnValueOnce({ exec: levelAggregateExecMock } as any)
                .mockReturnValueOnce({ exec: serviceAggregateExecMock } as any);

            vi.mocked(SystemLog.countDocuments).mockReturnValueOnce({
                exec: countExecMock
            } as any).mockReturnValueOnce({
                exec: unresolvedExecMock
            } as any);

            const stats = await service.getStatistics();

            expect(stats).toEqual({
                total: 100,
                byLevel: {
                    trace: 0,
                    debug: 0,
                    info: 0,
                    warn: 30,
                    error: 40,
                    fatal: 0
                },
                byService: {
                    'tronrelic-backend': 50,
                    'whale-alerts': 30
                },
                unresolved: 25
            });
        });
    });

    // ========================================================================
    // Additional Helper Methods Tests
    // ========================================================================

    describe('Additional Helper Methods', () => {
        /**
         * Test: getLogById() should fetch single log.
         */
        it('should fetch single log by ID', async () => {
            const mockLog = { _id: 'log123', message: 'Test log' };
            const execMock = vi.fn().mockResolvedValue(mockLog);

            vi.mocked(SystemLog.findById).mockReturnValue({
                lean: vi.fn().mockReturnValue({
                    exec: execMock
                })
            } as any);

            const result = await service.getLogById('log123');

            expect(SystemLog.findById).toHaveBeenCalledWith('log123');
            expect(result).toEqual(mockLog);
        });

        /**
         * Test: markAsUnresolved() should mark log as unresolved.
         */
        it('should mark log as unresolved', async () => {
            const mockLog = { _id: 'log123', resolved: false };
            const execMock = vi.fn().mockResolvedValue(mockLog);

            vi.mocked(SystemLog.findByIdAndUpdate).mockReturnValue({
                lean: vi.fn().mockReturnValue({
                    exec: execMock
                })
            } as any);

            const result = await service.markAsUnresolved('log123');

            expect(SystemLog.findByIdAndUpdate).toHaveBeenCalledWith(
                'log123',
                {
                    resolved: false,
                    $unset: { resolvedAt: '', resolvedBy: '' }
                },
                { new: true }
            );
            expect(result).toEqual(mockLog);
        });

        /**
         * Test: deleteOldLogs() should delete logs before date.
         */
        it('should delete logs older than specified date', async () => {
            const beforeDate = new Date('2025-01-01');
            const execMock = vi.fn().mockResolvedValue({ deletedCount: 10 });

            vi.mocked(SystemLog.deleteMany).mockReturnValue({
                exec: execMock
            } as any);

            const count = await service.deleteOldLogs(beforeDate);

            expect(SystemLog.deleteMany).toHaveBeenCalledWith({
                timestamp: { $lt: beforeDate }
            });
            expect(count).toBe(10);
        });

        /**
         * Test: deleteExcessLogs() should delete logs exceeding max count.
         */
        it('should delete logs exceeding max count', async () => {
            const mockOldLog = { timestamp: new Date('2025-01-01') };
            const findExecMock = vi.fn().mockResolvedValue([mockOldLog]);
            const deleteExecMock = vi.fn().mockResolvedValue({ deletedCount: 5 });

            vi.mocked(SystemLog.find).mockReturnValue({
                sort: vi.fn().mockReturnValue({
                    skip: vi.fn().mockReturnValue({
                        limit: vi.fn().mockReturnValue({
                            lean: vi.fn().mockReturnValue({
                                exec: findExecMock
                            })
                        })
                    })
                })
            } as any);

            vi.mocked(SystemLog.deleteMany).mockReturnValue({
                exec: deleteExecMock
            } as any);

            const count = await service.deleteExcessLogs(100);

            expect(count).toBe(5);
        });

        /**
         * Test: deleteExcessLogs() should return 0 if under max count.
         */
        it('should return 0 if logs are under max count', async () => {
            const findExecMock = vi.fn().mockResolvedValue([]);

            vi.mocked(SystemLog.find).mockReturnValue({
                sort: vi.fn().mockReturnValue({
                    skip: vi.fn().mockReturnValue({
                        limit: vi.fn().mockReturnValue({
                            lean: vi.fn().mockReturnValue({
                                exec: findExecMock
                            })
                        })
                    })
                })
            } as any);

            const count = await service.deleteExcessLogs(100);

            expect(count).toBe(0);
        });

        /**
         * Test: deleteAllLogs() should delete all logs.
         */
        it('should delete all logs', async () => {
            const execMock = vi.fn().mockResolvedValue({ deletedCount: 50 });

            vi.mocked(SystemLog.deleteMany).mockReturnValue({
                exec: execMock
            } as any);

            const count = await service.deleteAllLogs();

            expect(SystemLog.deleteMany).toHaveBeenCalledWith({});
            expect(count).toBe(50);
        });
    });
});
