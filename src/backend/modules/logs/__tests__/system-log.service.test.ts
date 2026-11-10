/// <reference types="vitest" />

import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Mock SystemLog Mongoose model for testing.
 *
 * Captures create() calls to verify sanitization without requiring MongoDB connection.
 * Must be defined before vi.mock() to avoid hoisting issues.
 */
vi.mock('../database/index.js', () => ({
    SystemLog: {
        create: vi.fn().mockResolvedValue({}),
        find: vi.fn(),
        findById: vi.fn(),
        findByIdAndUpdate: vi.fn(),
        countDocuments: vi.fn(),
        estimatedDocumentCount: vi.fn(),
        aggregate: vi.fn(),
        deleteMany: vi.fn()
    }
}));

import { SystemLogService } from '../services/system-log.service.js';
import { SystemLog } from '../database/index.js';

/**
 * Mock Pino logger for testing.
 *
 * Provides a minimal Pino-compatible interface with spy functions to verify
 * logging behavior without requiring actual file I/O.
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

// Type assertion to access the mocked create method
const mockCreate = SystemLog.create as unknown as ReturnType<typeof vi.fn>;

describe('SystemLogService - Core Logging Methods', () => {
    let service: SystemLogService;
    let mockPino: MockPinoLogger;

    beforeEach(async () => {
        vi.clearAllMocks();

        (SystemLogService as any).instance = undefined;
        service = SystemLogService.getInstance();
        mockPino = new MockPinoLogger();
        await service.initialize(mockPino as any);
    });

    it('should return same instance (singleton)', () => {
        const instance1 = SystemLogService.getInstance();
        const instance2 = SystemLogService.getInstance();
        expect(instance1).toBe(instance2);
        expect(instance1).toBe(service);
    });

    it('should save info logs when level permits', async () => {
        service.level = 'info';
        service.info('Test info message');

        await new Promise(resolve => setTimeout(resolve, 10));

        expect(mockCreate).toHaveBeenCalled();
        const savedLog = mockCreate.mock.calls[mockCreate.mock.calls.length - 1][0];
        expect(savedLog.level).toBe('info');
        expect(savedLog.message).toBe('Test info message');
    });

    it('should save warn logs when level permits', async () => {
        service.level = 'warn';
        service.warn('Test warning message');

        await new Promise(resolve => setTimeout(resolve, 10));

        expect(mockCreate).toHaveBeenCalled();
        const savedLog = mockCreate.mock.calls[0][0];
        expect(savedLog.level).toBe('warn');
        expect(savedLog.message).toBe('Test warning message');
    });

    it('should save error logs when level permits', async () => {
        service.level = 'error';
        service.error('Test error message');

        await new Promise(resolve => setTimeout(resolve, 10));

        expect(mockCreate).toHaveBeenCalled();
        const savedLog = mockCreate.mock.calls[0][0];
        expect(savedLog.level).toBe('error');
        expect(savedLog.message).toBe('Test error message');
    });

    it('should save debug logs when level permits', async () => {
        service.level = 'debug';
        service.debug('Test debug message');

        await new Promise(resolve => setTimeout(resolve, 10));

        expect(mockCreate).toHaveBeenCalled();
        const savedLog = mockCreate.mock.calls[mockCreate.mock.calls.length - 1][0];
        expect(savedLog.level).toBe('debug');
        expect(savedLog.message).toBe('Test debug message');
    });

    it('should save trace logs when level permits', async () => {
        service.level = 'trace';
        service.trace('Test trace message');

        await new Promise(resolve => setTimeout(resolve, 10));

        expect(mockCreate).toHaveBeenCalled();
        const savedLog = mockCreate.mock.calls[mockCreate.mock.calls.length - 1][0];
        expect(savedLog.level).toBe('trace');
        expect(savedLog.message).toBe('Test trace message');
    });

    /** Fatal logs are always saved unless the level is silent. */
    it('should save fatal logs when level permits', async () => {
        service.level = 'fatal';
        service.fatal('Test fatal message');

        await new Promise(resolve => setTimeout(resolve, 10));

        expect(mockCreate).toHaveBeenCalled();
        const savedLog = mockCreate.mock.calls[0][0];
        expect(savedLog.level).toBe('fatal');
        expect(savedLog.message).toBe('Test fatal message');
    });

    it('should support structured logging (object + message)', async () => {
        service.error({ userId: '123', action: 'login' }, 'Login failed');

        await new Promise(resolve => setTimeout(resolve, 10));

        expect(mockCreate).toHaveBeenCalled();
        const savedLog = mockCreate.mock.calls[0][0];
        expect(savedLog.message).toBe('Login failed');
        expect(savedLog.context.userId).toBe('123');
        expect(savedLog.context.action).toBe('login');
    });

    it('should create child logger with bindings', async () => {
        const childLogger = service.child({ module: 'test-module' });

        childLogger.info('Child log message');

        await new Promise(resolve => setTimeout(resolve, 10));

        expect(mockCreate).toHaveBeenCalled();
        const savedLog = mockCreate.mock.calls[mockCreate.mock.calls.length - 1][0];
        expect(savedLog.message).toBe('Child log message');
        expect(savedLog.context.module).toBe('test-module');
    });

    it('should merge parent and child bindings', async () => {
        const parent = service.child({ service: 'api' });
        const child = parent.child({ module: 'auth' });

        child.warn('Authentication warning');

        await new Promise(resolve => setTimeout(resolve, 10));

        expect(mockCreate).toHaveBeenCalled();
        const savedLog = mockCreate.mock.calls[0][0];
        expect(savedLog.context.service).toBe('api');
        expect(savedLog.context.module).toBe('auth');
    });

    it('should allow runtime log level changes', () => {
        service.level = 'info';
        expect(service.level).toBe('info');

        service.level = 'warn';
        expect(service.level).toBe('warn');

        service.level = 'error';
        expect(service.level).toBe('error');
    });

    it('should extract service identifier from pluginId', async () => {
        service.error({ pluginId: 'whale-alerts' }, 'Plugin error');

        await new Promise(resolve => setTimeout(resolve, 10));

        expect(mockCreate).toHaveBeenCalled();
        const savedLog = mockCreate.mock.calls[0][0];
        expect(savedLog.service).toBe('plugin:whale-alerts');
    });

    it('should extract service identifier from module', async () => {
        service.info({ module: 'blockchain' }, 'Module log');

        await new Promise(resolve => setTimeout(resolve, 10));

        expect(mockCreate).toHaveBeenCalled();
        const savedLog = mockCreate.mock.calls[mockCreate.mock.calls.length - 1][0];
        expect(savedLog.service).toBe('tronrelic:blockchain');
    });
});

describe('SystemLogService - Child Loggers Created Before Initialization', () => {
    let service: SystemLogService;
    let mockPino: MockPinoLogger;

    beforeEach(() => {
        vi.clearAllMocks();

        // Leave the root uninitialized so each test can create a child first,
        // the way module constructors do before LogsModule.init() runs.
        (SystemLogService as any).instance = undefined;
        service = SystemLogService.getInstance();
        mockPino = new MockPinoLogger();
    });

    /**
     * Guards against the child copying the root's "not initialized" state at
     * creation time, which left every module's Logs tab empty.
     */
    it('should persist to MongoDB after the root is initialized', async () => {
        const childLogger = service.child({ module: 'price-history' });
        await service.initialize(mockPino as any);

        childLogger.error('Scheduled job failed');

        await new Promise(resolve => setTimeout(resolve, 10));

        expect(mockCreate).toHaveBeenCalled();
        const savedLog = mockCreate.mock.calls[mockCreate.mock.calls.length - 1][0];
        expect(savedLog.message).toBe('Scheduled job failed');
        expect(savedLog.service).toBe('tronrelic:price-history');
    });

    /**
     * The child builds its Pino child from the root's logger with only its own
     * bindings, instead of falling back to the console forever.
     */
    it('should write through a Pino child after the root is initialized', async () => {
        const childLogger = service.child({ module: 'price-history' });
        await service.initialize(mockPino as any);

        childLogger.warn('Vendor failed');

        expect(mockPino.child).toHaveBeenCalledWith({ module: 'price-history' });
        const pinoChild = mockPino.child.mock.results[0].value as MockPinoLogger;
        expect(pinoChild.warn).toHaveBeenCalledWith('Vendor failed', undefined);
    });

    it('should not persist before the root is initialized', async () => {
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const childLogger = service.child({ module: 'price-history' });

        childLogger.error('Too early');

        await new Promise(resolve => setTimeout(resolve, 10));

        expect(mockCreate).not.toHaveBeenCalled();
        expect(consoleSpy).toHaveBeenCalled();
        consoleSpy.mockRestore();
    });

    /**
     * A Pino child keeps the level it was created with, so without syncing, a
     * level change from the admin interface would not reach existing children.
     */
    it('should follow runtime level changes on the root', async () => {
        await service.initialize(mockPino as any);
        const childLogger = service.child({ module: 'price-history' });
        childLogger.info('Build the Pino child at info level');

        service.level = 'warn';
        childLogger.info('Suppressed info message');

        await new Promise(resolve => setTimeout(resolve, 10));

        expect(childLogger.level).toBe('warn');
        const messages = mockCreate.mock.calls.map(call => call[0].message);
        expect(messages).not.toContain('Suppressed info message');
    });

    /**
     * The level stays one setting for the whole process instead of a
     * child-only value that the next log call would overwrite.
     */
    it('should forward a level set on a child to the root', async () => {
        await service.initialize(mockPino as any);
        const childLogger = service.child({ module: 'price-history' });

        childLogger.level = 'error';

        expect(service.level).toBe('error');
        expect(childLogger.level).toBe('error');
    });

    /** A child waits on its parent, since only the root is ever initialized. */
    it('should resolve waitUntilInitialized on a child once the root is initialized', async () => {
        const childLogger = service.child({ module: 'price-history' });
        const waiting = childLogger.waitUntilInitialized();

        await service.initialize(mockPino as any);

        await expect(waiting).resolves.toBeUndefined();
    });
});

describe('SystemLogService - Metadata Sanitization', () => {
    let service: SystemLogService;
    let mockPino: MockPinoLogger;

    beforeEach(async () => {
        vi.clearAllMocks();

        // Reset singleton and initialize with mock Pino
        (SystemLogService as any).instance = undefined;
        service = SystemLogService.getInstance();
        mockPino = new MockPinoLogger();
        await service.initialize(mockPino as any);
    });

    /**
     * A circular reference is replaced with a '[Circular Reference]' marker
     * instead of causing infinite recursion or BSON serialization errors.
     */
    it('should sanitize circular references', async () => {
        // Create object with circular reference
        const circularObj: any = { name: 'test' };
        circularObj.self = circularObj;

        // Log error with circular metadata
        service.error({ circular: circularObj }, 'Error with circular reference');

        // Wait for async saveLog to complete
        await new Promise(resolve => setTimeout(resolve, 10));

        // Verify MongoDB create was called
        expect(mockCreate).toHaveBeenCalledTimes(1);

        // Extract the saved context
        const savedLog = mockCreate.mock.calls[0][0];
        expect(savedLog.context.circular.name).toBe('test');
        expect(savedLog.context.circular.self).toBe('[Circular Reference]');
    });

    /**
     * Error instances become plain objects of name, message, and stack,
     * preventing BSON serialization errors from complex Error internal state.
     */
    it('should sanitize Error objects', async () => {
        const error = new Error('Test error message');
        error.name = 'TestError';

        service.error({ err: error }, 'Error occurred');

        await new Promise(resolve => setTimeout(resolve, 10));

        expect(mockCreate).toHaveBeenCalledTimes(1);

        const savedLog = mockCreate.mock.calls[0][0];
        expect(savedLog.context.err.name).toBe('TestError');
        expect(savedLog.context.err.message).toBe('Test error message');
        expect(savedLog.context.err.stack).toBeDefined();
        expect(typeof savedLog.context.err.stack).toBe('string');
    });

    it('should preserve custom Error properties', async () => {
        const error = new Error('Custom error') as any;
        error.code = 'ERR_CUSTOM';
        error.statusCode = 500;

        service.error({ err: error }, 'Error with custom properties');

        await new Promise(resolve => setTimeout(resolve, 10));

        expect(mockCreate).toHaveBeenCalledTimes(1);

        const savedLog = mockCreate.mock.calls[0][0];
        expect(savedLog.context.err.code).toBe('ERR_CUSTOM');
        expect(savedLog.context.err.statusCode).toBe(500);
    });

    /**
     * Functions become strings like '[Function: myFunction]' instead of causing
     * serialization errors or losing information entirely.
     */
    it('should sanitize functions to string representations', async () => {
        function namedFunction() {}
        const anonymousFunction = () => {};

        service.error({
            named: namedFunction,
            anonymous: anonymousFunction
        }, 'Error with functions');

        await new Promise(resolve => setTimeout(resolve, 10));

        expect(mockCreate).toHaveBeenCalledTimes(1);

        const savedLog = mockCreate.mock.calls[0][0];
        expect(savedLog.context.named).toBe('[Function: namedFunction]');
        expect(savedLog.context.anonymous).toMatch(/\[Function:/); // Arrow functions may not have names
    });

    /**
     * Undefined values are omitted, as undefined is not serializable to BSON and
     * would cause MongoDB storage errors.
     */
    it('should remove undefined values', async () => {
        service.error({
            defined: 'value',
            undefined: undefined,
            nullValue: null
        }, 'Error with undefined');

        await new Promise(resolve => setTimeout(resolve, 10));

        expect(mockCreate).toHaveBeenCalledTimes(1);

        const savedLog = mockCreate.mock.calls[0][0];
        expect(savedLog.context.defined).toBe('value');
        expect(savedLog.context.undefined).toBeUndefined();
        expect(savedLog.context.nullValue).toBeNull();
    });

    it('should limit recursion depth to prevent stack overflow', async () => {
        // Create deeply nested object (15 levels)
        let deepObj: any = { value: 'leaf' };
        for (let i = 0; i < 15; i++) {
            deepObj = { nested: deepObj };
        }

        service.error({ deep: deepObj }, 'Error with deep nesting');

        await new Promise(resolve => setTimeout(resolve, 10));

        expect(mockCreate).toHaveBeenCalledTimes(1);

        const savedLog = mockCreate.mock.calls[0][0];

        // Navigate down to depth limit
        let current = savedLog.context.deep;
        for (let i = 0; i < 10; i++) {
            expect(current.nested).toBeDefined();
            current = current.nested;
        }

        // At depth 11, should be truncated
        expect(current).toBe('[Max depth exceeded]');
    });

    it('should sanitize arrays recursively', async () => {
        const error = new Error('Array error');
        const circularObj: any = { name: 'circular' };
        circularObj.self = circularObj;

        service.error({
            items: [
                'string',
                42,
                error,
                circularObj,
                () => {}
            ]
        }, 'Error with array');

        await new Promise(resolve => setTimeout(resolve, 10));

        expect(mockCreate).toHaveBeenCalledTimes(1);

        const savedLog = mockCreate.mock.calls[0][0];
        expect(savedLog.context.items[0]).toBe('string');
        expect(savedLog.context.items[1]).toBe(42);
        expect(savedLog.context.items[2].message).toBe('Array error');
        expect(savedLog.context.items[3].self).toBe('[Circular Reference]');
        expect(savedLog.context.items[4]).toMatch(/\[Function:/);
    });

    /**
     * Dates stay Date instances rather than strings, since MongoDB natively
     * supports the BSON Date type and stores them efficiently.
     */
    it('should preserve Date objects', async () => {
        const now = new Date('2025-01-01T00:00:00.000Z');

        service.error({ timestamp: now }, 'Error with date');

        await new Promise(resolve => setTimeout(resolve, 10));

        expect(mockCreate).toHaveBeenCalledTimes(1);

        const savedLog = mockCreate.mock.calls[0][0];
        expect(savedLog.context.timestamp).toBeInstanceOf(Date);
        expect(savedLog.context.timestamp.toISOString()).toBe('2025-01-01T00:00:00.000Z');
    });

    it('should preserve primitives', async () => {
        service.error({
            str: 'hello',
            num: 42,
            bool: true,
            nil: null
        }, 'Error with primitives');

        await new Promise(resolve => setTimeout(resolve, 10));

        expect(mockCreate).toHaveBeenCalledTimes(1);

        const savedLog = mockCreate.mock.calls[0][0];
        expect(savedLog.context.str).toBe('hello');
        expect(savedLog.context.num).toBe(42);
        expect(savedLog.context.bool).toBe(true);
        expect(savedLog.context.nil).toBeNull();
    });

    it('should detect circular references in nested structures', async () => {
        const parent: any = { name: 'parent' };
        const child: any = { name: 'child', parent };
        parent.child = child;

        service.error({ family: parent }, 'Error with nested circular refs');

        await new Promise(resolve => setTimeout(resolve, 10));

        expect(mockCreate).toHaveBeenCalledTimes(1);

        const savedLog = mockCreate.mock.calls[0][0];
        expect(savedLog.context.family.name).toBe('parent');
        expect(savedLog.context.family.child.name).toBe('child');
        expect(savedLog.context.family.child.parent).toBe('[Circular Reference]');
    });

    it('should handle complex real-world error scenario', async () => {
        // Simulate Axios error with circular references
        const axiosError: any = new Error('Request failed');
        axiosError.name = 'AxiosError';
        axiosError.code = 'ERR_BAD_REQUEST';

        const config: any = {
            url: 'https://api.example.com',
            method: 'GET',
            headers: { 'User-Agent': 'Test' }
        };

        const request: any = { config };
        const response: any = { data: {}, status: 404, config, request };

        // Create circular references (request -> response -> request)
        request.response = response;
        response.request = request;

        axiosError.config = config;
        axiosError.request = request;
        axiosError.response = response;

        service.error({ err: axiosError }, 'Axios request failed');

        await new Promise(resolve => setTimeout(resolve, 10));

        expect(mockCreate).toHaveBeenCalledTimes(1);

        const savedLog = mockCreate.mock.calls[0][0];

        // Verify error properties preserved
        expect(savedLog.context.err.name).toBe('AxiosError');
        expect(savedLog.context.err.code).toBe('ERR_BAD_REQUEST');
        expect(savedLog.context.err.message).toBe('Request failed');

        // Verify config preserved
        expect(savedLog.context.err.config.url).toBe('https://api.example.com');

        // Verify circular references replaced
        // Note: sanitizeMetadata uses WeakSet for seen tracking, so exact circular path detection
        // depends on traversal order. Verify that deeply nested circular structures are handled.
        expect(savedLog.context.err.request).toBeDefined();
        expect(savedLog.context.err.response).toBeDefined();
    });

    it('should preserve empty objects', async () => {
        service.error({ empty: {} }, 'Error with empty object');

        await new Promise(resolve => setTimeout(resolve, 10));

        expect(mockCreate).toHaveBeenCalledTimes(1);

        const savedLog = mockCreate.mock.calls[0][0];
        expect(savedLog.context.empty).toEqual({});
    });

    it('should not mutate original metadata object', async () => {
        const originalError = new Error('Original');
        const originalMetadata = { err: originalError };

        service.error(originalMetadata, 'Error test');

        await new Promise(resolve => setTimeout(resolve, 10));

        // Original should still be Error instance, not sanitized plain object
        expect(originalMetadata.err).toBeInstanceOf(Error);
        expect(originalMetadata.err).toBe(originalError);
    });
});

describe('SystemLogService - Integration with Logging Methods', () => {
    let service: SystemLogService;
    let mockPino: MockPinoLogger;

    beforeEach(async () => {
        vi.clearAllMocks();

        (SystemLogService as any).instance = undefined;
        service = SystemLogService.getInstance();
        mockPino = new MockPinoLogger();
        await service.initialize(mockPino as any);
    });

    it('should sanitize metadata when logging errors', async () => {
        const error = new Error('Test error');
        const circularObj: any = { name: 'test' };
        circularObj.self = circularObj;

        service.error({ err: error, circular: circularObj }, 'Complex error');

        await new Promise(resolve => setTimeout(resolve, 10));

        // Verify MongoDB save with sanitized data
        expect(mockCreate).toHaveBeenCalled();
        const savedLog = mockCreate.mock.calls[0][0];
        expect(savedLog.context.err.message).toBe('Test error');
        expect(savedLog.context.circular.self).toBe('[Circular Reference]');
    });

    it('should sanitize metadata when logging warnings', async () => {
        const func = () => {};

        service.warn({ callback: func }, 'Warning with function');

        await new Promise(resolve => setTimeout(resolve, 10));

        // Verify sanitization - functions should be converted to string representation
        expect(mockCreate).toHaveBeenCalled();
        const savedLog = mockCreate.mock.calls[0][0];
        expect(savedLog.context.callback).toMatch(/\[Function:/);
    });

    it('should sanitize metadata when logging info', async () => {
        const date = new Date('2025-01-01');

        service.info({ timestamp: date }, 'Info with date');

        await new Promise(resolve => setTimeout(resolve, 10));

        // Verify sanitization occurred - Date objects should be preserved
        expect(mockCreate).toHaveBeenCalled();
        const savedLog = mockCreate.mock.calls[mockCreate.mock.calls.length - 1][0];
        expect(savedLog.context.timestamp).toBeInstanceOf(Date);
    });
});

describe('SystemLogService - Error Object Circular Reference Sanitization', () => {
    let service: SystemLogService;
    let mockPino: MockPinoLogger;

    beforeEach(async () => {
        vi.clearAllMocks();

        (SystemLogService as any).instance = undefined;
        service = SystemLogService.getInstance();
        mockPino = new MockPinoLogger();
        await service.initialize(mockPino as any);
    });

    /**
     * Custom properties on Error objects (like AxiosError's config, request, response)
     * are recursively sanitized to remove circular references. This prevents BSON serialization
     * errors when logging Axios errors or other complex error types with circular object graphs.
     *
     * Regression test for bug where Error custom properties bypassed sanitization.
     */
    it('should recursively sanitize Error object custom properties with circular references', async () => {
        // Simulate AxiosError structure with circular references
        const axiosError: any = new Error('Request failed with status code 400');
        axiosError.name = 'AxiosError';
        axiosError.code = 'ERR_BAD_REQUEST';

        // Create circular reference chain: config -> request -> response -> request
        const config: any = {
            url: 'https://api.telegram.org/bot.../sendMessage',
            method: 'POST',
            data: { chat_id: 123, text: 'Test' }
        };

        const request: any = { config };
        const response: any = { data: { error: 'Bad Request' }, status: 400, config };

        // Create circular references
        request.response = response;
        response.request = request;
        config.request = request;

        // Attach to error as custom properties
        axiosError.config = config;
        axiosError.request = request;
        axiosError.response = response;

        // Log the error
        service.error({ error: axiosError }, 'Telegram API error');

        await new Promise(resolve => setTimeout(resolve, 10));

        expect(mockCreate).toHaveBeenCalledTimes(1);

        const savedLog = mockCreate.mock.calls[0][0];

        // Verify basic error properties preserved
        expect(savedLog.context.error.name).toBe('AxiosError');
        expect(savedLog.context.error.message).toBe('Request failed with status code 400');
        expect(savedLog.context.error.code).toBe('ERR_BAD_REQUEST');

        // Verify custom properties exist and are sanitized
        expect(savedLog.context.error.config).toBeDefined();
        expect(savedLog.context.error.request).toBeDefined();
        expect(savedLog.context.error.response).toBeDefined();

        // Verify config data preserved
        expect(savedLog.context.error.config.url).toBe('https://api.telegram.org/bot.../sendMessage');
        expect(savedLog.context.error.config.method).toBe('POST');

        // Verify circular references were detected and replaced
        // The exact location of '[Circular Reference]' depends on traversal order,
        // but circular chains should be broken - verify it's serializable to JSON
        expect(() => JSON.stringify(savedLog.context.error)).not.toThrow();
        expect(JSON.stringify(savedLog.context.error)).toBeDefined();
    });

    it('should sanitize deeply nested circular references in Error custom properties', async () => {
        const error: any = new Error('Complex error');
        error.name = 'ComplexError';

        // Create deeply nested structure with circular reference
        const level1: any = { name: 'level1' };
        const level2: any = { name: 'level2', parent: level1 };
        const level3: any = { name: 'level3', parent: level2 };

        // Create circular reference at level 3 pointing back to level 1
        level3.root = level1;
        level1.child = level2;
        level2.child = level3;

        // Attach as custom property on error
        error.metadata = level1;

        service.error({ err: error }, 'Error with deeply nested circular refs');

        await new Promise(resolve => setTimeout(resolve, 10));

        expect(mockCreate).toHaveBeenCalledTimes(1);

        const savedLog = mockCreate.mock.calls[0][0];

        // Verify structure exists
        expect(savedLog.context.err.metadata.name).toBe('level1');
        expect(savedLog.context.err.metadata.child.name).toBe('level2');
        expect(savedLog.context.err.metadata.child.child.name).toBe('level3');

        // Verify circular reference detected
        expect(savedLog.context.err.metadata.child.child.root).toBe('[Circular Reference]');
    });

    /**
     * Functions on an Error become strings instead of being silently dropped or
     * causing serialization errors.
     */
    it('should sanitize functions in Error custom properties', async () => {
        const error: any = new Error('Error with callbacks');
        error.onRetry = function handleRetry() { return true; };
        error.transform = (data: any) => data;

        service.error({ err: error }, 'Error with function properties');

        await new Promise(resolve => setTimeout(resolve, 10));

        expect(mockCreate).toHaveBeenCalledTimes(1);

        const savedLog = mockCreate.mock.calls[0][0];

        // Verify functions converted to string representations
        expect(savedLog.context.err.onRetry).toMatch(/\[Function:/);
        expect(savedLog.context.err.transform).toMatch(/\[Function:/);
    });

    /** Undefined custom properties on an Error are removed to prevent BSON serialization errors. */
    it('should remove undefined values from Error custom properties', async () => {
        const error: any = new Error('Error with undefined props');
        error.definedProp = 'value';
        error.undefinedProp = undefined;
        error.nullProp = null;

        service.error({ err: error }, 'Error with mixed property values');

        await new Promise(resolve => setTimeout(resolve, 10));

        expect(mockCreate).toHaveBeenCalledTimes(1);

        const savedLog = mockCreate.mock.calls[0][0];

        // Verify undefined removed, but null preserved
        expect(savedLog.context.err.definedProp).toBe('value');
        expect(savedLog.context.err.undefinedProp).toBeUndefined();
        expect(savedLog.context.err.nullProp).toBeNull();
    });
});

describe('SystemLogService - Two-Tier Fallback Error Handling', () => {
    let service: SystemLogService;
    let mockPino: MockPinoLogger;
    let consoleErrorSpy: any;

    beforeEach(async () => {
        vi.clearAllMocks();

        (SystemLogService as any).instance = undefined;
        service = SystemLogService.getInstance();
        mockPino = new MockPinoLogger();
        await service.initialize(mockPino as any);

        // Spy on console.error to verify fallback console logging
        consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    /**
     * Verifies the two-tier fallback mechanism where a failed primary save triggers
     * a second attempt with simplified error metadata before falling back to console.
     *
     * Regression test for bug where saveLog() swallowed errors and prevented fallback.
     */
    it('should attempt simplified error record when primary save fails', async () => {
        // Make first SystemLog.create() call fail with BSON error
        let callCount = 0;
        mockCreate.mockImplementation(() => {
            callCount++;
            if (callCount === 1) {
                // First call (primary save) fails
                return Promise.reject(new Error('Cannot convert circular structure to BSON'));
            } else {
                // Second call (fallback save) succeeds
                return Promise.resolve({});
            }
        });

        // Create circular object that will fail sanitization
        const problematicObj: any = { name: 'test' };
        problematicObj.self = problematicObj;

        service.error({ data: problematicObj }, 'Error that triggers fallback');

        await new Promise(resolve => setTimeout(resolve, 20));

        // Verify primary save was attempted
        expect(mockCreate).toHaveBeenCalledTimes(2);

        // Verify console.error was called for primary failure
        expect(consoleErrorSpy).toHaveBeenCalledWith(
            'Failed to save log entry to MongoDB:',
            expect.any(Error)
        );

        // Verify fallback save was attempted with simplified error record
        const fallbackCall = mockCreate.mock.calls[1][0];
        expect(fallbackCall.level).toBe('error');
        expect(fallbackCall.message).toBe('Failed to save log entry (error during serialization)');
        expect(fallbackCall.service).toBe('system-log');
        expect(fallbackCall.context.originalMessage).toBe('Error that triggers fallback');
        expect(fallbackCall.context.originalLevel).toBe('error');
        expect(fallbackCall.context.errorType).toBeDefined();
    });

    /** When both saves fail, the error goes to the console without throwing and crashing the application. */
    it('should fall back to console logging when MongoDB is completely unavailable', async () => {
        // Make all SystemLog.create() calls fail
        mockCreate.mockRejectedValue(new Error('MongoDB connection lost'));

        service.error({ critical: true }, 'Error when database is down');

        await new Promise(resolve => setTimeout(resolve, 20));

        // Verify both save attempts were made
        expect(mockCreate).toHaveBeenCalledTimes(2);

        // Verify console.error was called for both failures
        expect(consoleErrorSpy).toHaveBeenCalledWith(
            'Failed to save log entry to MongoDB:',
            expect.any(Error)
        );
        expect(consoleErrorSpy).toHaveBeenCalledWith(
            'Failed to save log from args:',
            expect.any(Error)
        );
        expect(consoleErrorSpy).toHaveBeenCalledWith(
            'Failed to save fallback error log:',
            expect.any(Error)
        );

        // Application should not crash - error was handled gracefully
    });

    /**
     * The fallback record carries the original message, level, error type, and
     * metadata keys to help diagnose why the primary save failed.
     */
    it('should include debugging metadata in fallback error record', async () => {
        let callCount = 0;
        mockCreate.mockImplementation(() => {
            callCount++;
            if (callCount === 1) {
                return Promise.reject(new Error('BSON serialization failed'));
            } else {
                return Promise.resolve({});
            }
        });

        service.error(
            { userId: 123, action: 'login', complexData: { nested: 'value' } },
            'Original error message'
        );

        await new Promise(resolve => setTimeout(resolve, 20));

        const fallbackCall = mockCreate.mock.calls[1][0];

        // Verify debugging metadata present
        expect(fallbackCall.context.originalMessage).toBe('Original error message');
        expect(fallbackCall.context.originalLevel).toBe('error');
        expect(fallbackCall.context.errorMessage).toBe('BSON serialization failed');
        expect(fallbackCall.context.metadataKeys).toEqual(['userId', 'action', 'complexData']);
    });

    it('should use two-tier fallback for all log levels', async () => {
        let callCount = 0;
        mockCreate.mockImplementation(() => {
            callCount++;
            if (callCount === 1) {
                return Promise.reject(new Error('BSON error'));
            } else {
                return Promise.resolve({});
            }
        });

        // Test with warn level
        service.warn({ problematic: 'data' }, 'Warning message');

        await new Promise(resolve => setTimeout(resolve, 20));

        expect(mockCreate).toHaveBeenCalledTimes(2);

        const fallbackCall = mockCreate.mock.calls[1][0];
        expect(fallbackCall.context.originalLevel).toBe('warn');
        expect(fallbackCall.context.originalMessage).toBe('Warning message');
    });
});

describe('SystemLogService - MongoDB Operations', () => {
    let service: SystemLogService;
    let mockPino: MockPinoLogger;

    beforeEach(async () => {
        vi.clearAllMocks();

        (SystemLogService as any).instance = undefined;
        service = SystemLogService.getInstance();
        mockPino = new MockPinoLogger();
        await service.initialize(mockPino as any);
    });

    it('should fetch logs with pagination', async () => {
        const mockLogs = [
            { _id: '1', level: 'error', message: 'Error 1', timestamp: new Date() },
            { _id: '2', level: 'warn', message: 'Warning 1', timestamp: new Date() }
        ];

        const mockFind = {
            sort: vi.fn().mockReturnThis(),
            skip: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            lean: vi.fn().mockReturnThis(),
            exec: vi.fn().mockResolvedValue(mockLogs)
        };

        const mockEstimatedCount = {
            exec: vi.fn().mockResolvedValue(10)
        };

        (SystemLog.find as any) = vi.fn().mockReturnValue(mockFind);
        (SystemLog.estimatedDocumentCount as any) = vi.fn().mockReturnValue(mockEstimatedCount);

        const result = await service.getLogs({ page: 1, limit: 2 });

        expect(SystemLog.find).toHaveBeenCalledWith({});
        expect(mockFind.sort).toHaveBeenCalledWith({ timestamp: -1 });
        expect(mockFind.skip).toHaveBeenCalledWith(0);
        expect(mockFind.limit).toHaveBeenCalledWith(2);
        expect(result.logs).toEqual(mockLogs);
        expect(result.total).toBe(10);
        expect(result.page).toBe(1);
        expect(result.limit).toBe(2);
        expect(result.totalPages).toBe(5);
    });

    it('should filter logs by level', async () => {
        const mockFind = {
            sort: vi.fn().mockReturnThis(),
            skip: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            lean: vi.fn().mockReturnThis(),
            exec: vi.fn().mockResolvedValue([])
        };

        const mockCountDocuments = {
            exec: vi.fn().mockResolvedValue(0)
        };

        (SystemLog.find as any) = vi.fn().mockReturnValue(mockFind);
        (SystemLog.countDocuments as any) = vi.fn().mockReturnValue(mockCountDocuments);

        await service.getLogs({ levels: ['error', 'fatal'] });

        expect(SystemLog.find).toHaveBeenCalledWith({
            level: { $in: ['error', 'fatal'] }
        });
    });

    it('should filter logs by service', async () => {
        const mockFind = {
            sort: vi.fn().mockReturnThis(),
            skip: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            lean: vi.fn().mockReturnThis(),
            exec: vi.fn().mockResolvedValue([])
        };

        const mockCountDocuments = {
            exec: vi.fn().mockResolvedValue(0)
        };

        (SystemLog.find as any) = vi.fn().mockReturnValue(mockFind);
        (SystemLog.countDocuments as any) = vi.fn().mockReturnValue(mockCountDocuments);

        await service.getLogs({ service: 'plugin:whale-alerts' });

        expect(SystemLog.find).toHaveBeenCalledWith({
            service: 'plugin:whale-alerts'
        });
    });

    it('should filter logs by date range', async () => {
        const mockFind = {
            sort: vi.fn().mockReturnThis(),
            skip: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            lean: vi.fn().mockReturnThis(),
            exec: vi.fn().mockResolvedValue([])
        };

        const mockCountDocuments = {
            exec: vi.fn().mockResolvedValue(0)
        };

        (SystemLog.find as any) = vi.fn().mockReturnValue(mockFind);
        (SystemLog.countDocuments as any) = vi.fn().mockReturnValue(mockCountDocuments);

        const startDate = new Date('2025-01-01');
        const endDate = new Date('2025-01-31');

        await service.getLogs({ startDate, endDate });

        expect(SystemLog.find).toHaveBeenCalledWith({
            timestamp: {
                $gte: startDate,
                $lte: endDate
            }
        });
    });

    describe('getLogsByCursor', () => {
        /**
         * Build a chainable SystemLog.find stub resolving to the given rows,
         * so each test controls exactly what the query returns.
         *
         * @param rows - The documents the stubbed query resolves with.
         * @returns The chain object, so a test can assert on sort and limit.
         */
        function stubFind(rows: any[]) {
            const chain = {
                sort: vi.fn().mockReturnThis(),
                limit: vi.fn().mockReturnThis(),
                lean: vi.fn().mockReturnThis(),
                exec: vi.fn().mockResolvedValue(rows)
            };
            (SystemLog.find as any) = vi.fn().mockReturnValue(chain);
            (SystemLog.countDocuments as any) = vi.fn();
            (SystemLog.estimatedDocumentCount as any) = vi.fn();
            return chain;
        }

        /**
         * Make a log row with a 24-hex id derived from a single character,
         * which keeps the fixtures short and readable.
         */
        function row(idChar: string, iso: string) {
            return { _id: idChar.repeat(24), level: 'error', message: idChar, timestamp: new Date(iso) };
        }

        it('fetches one extra row to detect more pages and never counts', async () => {
            const chain = stubFind([
                row('a', '2026-06-09T03:00:00Z'),
                row('b', '2026-06-09T02:00:00Z'),
                row('c', '2026-06-09T01:00:00Z')
            ]);

            const result = await service.getLogsByCursor({ limit: 2 });

            expect(SystemLog.find).toHaveBeenCalledWith({});
            expect(chain.sort).toHaveBeenCalledWith({ timestamp: -1 });
            expect(chain.limit).toHaveBeenCalledWith(3);
            expect(result.logs.map(log => log.message)).toEqual(['a', 'b']);
            expect(result.next).toEqual({
                timestamp: new Date('2026-06-09T02:00:00Z'),
                seenIds: ['b'.repeat(24)]
            });
            expect(SystemLog.countDocuments).not.toHaveBeenCalled();
            expect(SystemLog.estimatedDocumentCount).not.toHaveBeenCalled();
        });

        it('returns a null cursor on the last page', async () => {
            stubFind([row('a', '2026-06-09T03:00:00Z')]);

            const result = await service.getLogsByCursor({ limit: 2 });

            expect(result.logs).toHaveLength(1);
            expect(result.next).toBeNull();
        });

        it('records every returned id sharing the boundary millisecond', async () => {
            stubFind([
                row('a', '2026-06-09T02:00:00Z'),
                row('b', '2026-06-09T01:00:00Z'),
                row('c', '2026-06-09T01:00:00Z'),
                row('d', '2026-06-09T01:00:00Z')
            ]);

            const result = await service.getLogsByCursor({ limit: 3 });

            expect(result.next?.seenIds).toEqual(['b'.repeat(24), 'c'.repeat(24)]);
        });

        it('bounds the next query by the cursor and excludes ids already seen', async () => {
            stubFind([]);
            const cursorTime = new Date('2026-06-09T02:00:00Z');

            await service.getLogsByCursor({
                levels: ['error'],
                before: { timestamp: cursorTime, seenIds: ['b'.repeat(24), 'not-an-id'] }
            });

            expect(SystemLog.find).toHaveBeenCalledWith({
                level: { $in: ['error'] },
                timestamp: { $lte: cursorTime },
                _id: { $nin: ['b'.repeat(24)] }
            });
        });

        it('keeps an endDate that is earlier than the cursor', async () => {
            stubFind([]);
            const startDate = new Date('2026-06-01T00:00:00Z');
            const endDate = new Date('2026-06-05T00:00:00Z');

            await service.getLogsByCursor({
                startDate,
                endDate,
                before: { timestamp: new Date('2026-06-09T00:00:00Z'), seenIds: [] }
            });

            expect(SystemLog.find).toHaveBeenCalledWith({
                timestamp: { $gte: startDate, $lte: endDate }
            });
        });

        it('carries seen ids forward when a page ends on the cursor millisecond', async () => {
            const sameMs = '2026-06-09T01:00:00Z';
            stubFind([row('c', sameMs), row('d', sameMs), row('e', sameMs)]);

            const result = await service.getLogsByCursor({
                limit: 2,
                before: { timestamp: new Date(sameMs), seenIds: ['a'.repeat(24), 'b'.repeat(24)] }
            });

            expect(result.next?.seenIds).toEqual([
                'a'.repeat(24), 'b'.repeat(24), 'c'.repeat(24), 'd'.repeat(24)
            ]);
        });
    });

    it('should get log statistics', async () => {
        const mockEstimatedExec = vi.fn().mockResolvedValue(100);
        const mockCountExec = vi.fn().mockResolvedValue(25);

        const mockAggregateExec = vi.fn()
            .mockResolvedValueOnce([
                { _id: 'error', count: 50 },
                { _id: 'warn', count: 30 },
                { _id: 'info', count: 20 }
            ])
            .mockResolvedValueOnce([
                { _id: 'tronrelic', count: 70 },
                { _id: 'plugin:whale-alerts', count: 30 }
            ]);

        (SystemLog.estimatedDocumentCount as any) = vi.fn(() => ({ exec: mockEstimatedExec }));
        (SystemLog.countDocuments as any) = vi.fn(() => ({ exec: mockCountExec }));
        (SystemLog.aggregate as any) = vi.fn(() => ({ exec: mockAggregateExec }));

        const stats = await service.getStatistics();

        expect(stats.total).toBe(100);
        expect(stats.unresolved).toBe(25);
        expect(stats.byLevel.error).toBe(50);
        expect(stats.byLevel.warn).toBe(30);
        expect(stats.byLevel.info).toBe(20);
        expect(stats.byService['tronrelic']).toBe(70);
        expect(stats.byService['plugin:whale-alerts']).toBe(30);
    });

    /**
     * A plugin's scoped Logs tab must never show deployment-wide totals, so
     * every query has to filter on the service and the total has to come from
     * that service's own level counts rather than the collection estimate.
     */
    it('should scope statistics to one service when a service is given', async () => {
        const mockCountExec = vi.fn().mockResolvedValue(4);
        const mockAggregateExec = vi.fn().mockResolvedValue([
            { _id: 'error', count: 4 },
            { _id: 'info', count: 6 }
        ]);
        const estimated = vi.fn();

        (SystemLog.estimatedDocumentCount as any) = estimated;
        (SystemLog.countDocuments as any) = vi.fn(() => ({ exec: mockCountExec }));
        (SystemLog.aggregate as any) = vi.fn(() => ({ exec: mockAggregateExec }));

        const stats = await service.getStatistics('plugin:whale-alerts');

        expect(SystemLog.aggregate).toHaveBeenCalledWith([
            { $match: { service: 'plugin:whale-alerts' } },
            { $group: { _id: '$level', count: { $sum: 1 } } }
        ]);
        expect(SystemLog.countDocuments).toHaveBeenCalledWith({ service: 'plugin:whale-alerts', resolved: false });
        expect(estimated).not.toHaveBeenCalled();
        expect(stats.total).toBe(10);
        expect(stats.unresolved).toBe(4);
        expect(stats.byLevel.error).toBe(4);
        expect(stats.byService).toEqual({ 'plugin:whale-alerts': 10 });
    });

    it('should mark log as resolved', async () => {
        const mockExec = vi.fn().mockResolvedValue({
            _id: 'log123',
            resolved: true,
            resolvedBy: 'admin',
            resolvedAt: expect.any(Date)
        });

        const mockFindByIdAndUpdate = vi.fn().mockReturnValue({ exec: mockExec });
        (SystemLog.findByIdAndUpdate as any) = mockFindByIdAndUpdate;

        await service.markAsResolved('log123', 'admin');

        expect(mockFindByIdAndUpdate).toHaveBeenCalledWith(
            'log123',
            expect.objectContaining({
                resolved: true,
                resolvedBy: 'admin',
                resolvedAt: expect.any(Date)
            }),
            { new: true }
        );
    });

    it('should mark log as unresolved', async () => {
        const mockLean = vi.fn().mockReturnThis();
        const mockExec = vi.fn().mockResolvedValue({
            _id: 'log123',
            resolved: false
        });

        const mockFindByIdAndUpdate = vi.fn().mockReturnValue({
            lean: mockLean,
            exec: mockExec
        });

        (SystemLog.findByIdAndUpdate as any) = mockFindByIdAndUpdate;

        const result = await service.markAsUnresolved('log123');

        expect(mockFindByIdAndUpdate).toHaveBeenCalledWith(
            'log123',
            expect.objectContaining({
                resolved: false,
                $unset: { resolvedAt: '', resolvedBy: '' }
            }),
            { new: true }
        );
        expect(result.resolved).toBe(false);
    });

    it('should delete old logs', async () => {
        const mockExec = vi.fn().mockResolvedValue({ deletedCount: 50 });
        const mockDeleteMany = vi.fn().mockReturnValue({ exec: mockExec });
        (SystemLog.deleteMany as any) = mockDeleteMany;

        const cutoffDate = new Date('2024-01-01');
        const deletedCount = await service.deleteOldLogs(cutoffDate);

        expect(mockDeleteMany).toHaveBeenCalledWith({
            timestamp: { $lt: cutoffDate }
        });
        expect(deletedCount).toBe(50);
    });

    it('should delete all logs', async () => {
        const mockExec = vi.fn().mockResolvedValue({ deletedCount: 1000 });
        const mockDeleteMany = vi.fn().mockReturnValue({ exec: mockExec });
        (SystemLog.deleteMany as any) = mockDeleteMany;

        const deletedCount = await service.deleteAllLogs();

        expect(mockDeleteMany).toHaveBeenCalledWith({});
        expect(deletedCount).toBe(1000);
    });

    it('should get log by ID', async () => {
        const mockLog = {
            _id: 'log123',
            level: 'error',
            message: 'Test error'
        };

        const mockLean = vi.fn().mockReturnThis();
        const mockExec = vi.fn().mockResolvedValue(mockLog);
        const mockFindById = vi.fn().mockReturnValue({
            lean: mockLean,
            exec: mockExec
        });

        (SystemLog.findById as any) = mockFindById;

        const result = await service.getLogById('log123');

        expect(mockFindById).toHaveBeenCalledWith('log123');
        expect(result).toEqual(mockLog);
    });
});
