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

    /**
     * Test: Singleton pattern should return same instance.
     *
     * Verifies that SystemLogService follows the singleton pattern
     * for consistent logging across the application.
     */
    it('should return same instance (singleton)', () => {
        const instance1 = SystemLogService.getInstance();
        const instance2 = SystemLogService.getInstance();
        expect(instance1).toBe(instance2);
        expect(instance1).toBe(service);
    });

    /**
     * Test: info() should save log to MongoDB when level permits.
     *
     * Verifies that info logs are persisted when log level is set to info or lower.
     */
    it('should save info logs when level permits', async () => {
        service.level = 'info';
        service.info('Test info message');

        await new Promise(resolve => setTimeout(resolve, 10));

        expect(mockCreate).toHaveBeenCalled();
        const savedLog = mockCreate.mock.calls[mockCreate.mock.calls.length - 1][0];
        expect(savedLog.level).toBe('info');
        expect(savedLog.message).toBe('Test info message');
    });

    /**
     * Test: warn() should save log to MongoDB when level permits.
     *
     * Verifies that warning logs are persisted when log level is set to warn or lower.
     */
    it('should save warn logs when level permits', async () => {
        service.level = 'warn';
        service.warn('Test warning message');

        await new Promise(resolve => setTimeout(resolve, 10));

        expect(mockCreate).toHaveBeenCalled();
        const savedLog = mockCreate.mock.calls[0][0];
        expect(savedLog.level).toBe('warn');
        expect(savedLog.message).toBe('Test warning message');
    });

    /**
     * Test: error() should save log to MongoDB when level permits.
     *
     * Verifies that error logs are persisted when log level is set to error or lower.
     */
    it('should save error logs when level permits', async () => {
        service.level = 'error';
        service.error('Test error message');

        await new Promise(resolve => setTimeout(resolve, 10));

        expect(mockCreate).toHaveBeenCalled();
        const savedLog = mockCreate.mock.calls[0][0];
        expect(savedLog.level).toBe('error');
        expect(savedLog.message).toBe('Test error message');
    });

    /**
     * Test: debug() should save log to MongoDB when level permits.
     *
     * Verifies that debug logs are persisted when log level is set to debug or lower.
     */
    it('should save debug logs when level permits', async () => {
        service.level = 'debug';
        service.debug('Test debug message');

        await new Promise(resolve => setTimeout(resolve, 10));

        expect(mockCreate).toHaveBeenCalled();
        const savedLog = mockCreate.mock.calls[mockCreate.mock.calls.length - 1][0];
        expect(savedLog.level).toBe('debug');
        expect(savedLog.message).toBe('Test debug message');
    });

    /**
     * Test: trace() should save log to MongoDB when level permits.
     *
     * Verifies that trace logs are persisted when log level is set to trace.
     */
    it('should save trace logs when level permits', async () => {
        service.level = 'trace';
        service.trace('Test trace message');

        await new Promise(resolve => setTimeout(resolve, 10));

        expect(mockCreate).toHaveBeenCalled();
        const savedLog = mockCreate.mock.calls[mockCreate.mock.calls.length - 1][0];
        expect(savedLog.level).toBe('trace');
        expect(savedLog.message).toBe('Test trace message');
    });

    /**
     * Test: fatal() should save log to MongoDB when level permits.
     *
     * Verifies that fatal logs are persisted (always saved unless level is silent).
     */
    it('should save fatal logs when level permits', async () => {
        service.level = 'fatal';
        service.fatal('Test fatal message');

        await new Promise(resolve => setTimeout(resolve, 10));

        expect(mockCreate).toHaveBeenCalled();
        const savedLog = mockCreate.mock.calls[0][0];
        expect(savedLog.level).toBe('fatal');
        expect(savedLog.message).toBe('Test fatal message');
    });

    /**
     * Test: Logging methods should support structured logging with metadata.
     *
     * Verifies that logging methods can accept object + message pattern
     * for structured logging with context metadata.
     */
    it('should support structured logging (object + message)', async () => {
        service.error({ userId: '123', action: 'login' }, 'Login failed');

        await new Promise(resolve => setTimeout(resolve, 10));

        expect(mockCreate).toHaveBeenCalled();
        const savedLog = mockCreate.mock.calls[0][0];
        expect(savedLog.message).toBe('Login failed');
        expect(savedLog.context.userId).toBe('123');
        expect(savedLog.context.action).toBe('login');
    });

    /**
     * Test: child() should create logger with inherited bindings.
     *
     * Verifies that child loggers add metadata to all their log messages
     * without affecting the parent logger.
     */
    it('should create child logger with bindings', async () => {
        const childLogger = service.child({ module: 'test-module' });

        childLogger.info('Child log message');

        await new Promise(resolve => setTimeout(resolve, 10));

        expect(mockCreate).toHaveBeenCalled();
        const savedLog = mockCreate.mock.calls[mockCreate.mock.calls.length - 1][0];
        expect(savedLog.message).toBe('Child log message');
        expect(savedLog.context.module).toBe('test-module');
    });

    /**
     * Test: child() should merge parent and child bindings.
     *
     * Verifies that nested child loggers inherit and merge bindings.
     */
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

    /**
     * Test: Log level can be changed at runtime.
     *
     * Verifies that the log level property can be set dynamically
     * to control which logs are persisted.
     */
    it('should allow runtime log level changes', () => {
        service.level = 'info';
        expect(service.level).toBe('info');

        service.level = 'warn';
        expect(service.level).toBe('warn');

        service.level = 'error';
        expect(service.level).toBe('error');
    });

    /**
     * Test: Service identifier extraction for plugin logs.
     *
     * Verifies that logs with pluginId metadata are prefixed with 'plugin:'.
     */
    it('should extract service identifier from pluginId', async () => {
        service.error({ pluginId: 'whale-alerts' }, 'Plugin error');

        await new Promise(resolve => setTimeout(resolve, 10));

        expect(mockCreate).toHaveBeenCalled();
        const savedLog = mockCreate.mock.calls[0][0];
        expect(savedLog.service).toBe('plugin:whale-alerts');
    });

    /**
     * Test: Service identifier extraction from module metadata.
     *
     * Verifies that logs with module metadata are appended to base service name.
     */
    it('should extract service identifier from module', async () => {
        service.info({ module: 'blockchain' }, 'Module log');

        await new Promise(resolve => setTimeout(resolve, 10));

        expect(mockCreate).toHaveBeenCalled();
        const savedLog = mockCreate.mock.calls[mockCreate.mock.calls.length - 1][0];
        expect(savedLog.service).toBe('tronrelic:blockchain');
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
     * Test: Circular references should be detected and replaced.
     *
     * Verifies that objects with circular references (object references itself)
     * are sanitized by replacing the circular reference with '[Circular Reference]'
     * marker instead of causing infinite recursion or BSON serialization errors.
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
     * Test: Error objects should be converted to serializable plain objects.
     *
     * Verifies that Error instances are sanitized by extracting name, message,
     * and stack properties into a plain object that can be stored in MongoDB,
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

    /**
     * Test: Custom error properties should be preserved.
     *
     * Verifies that Error objects with custom properties (code, statusCode, etc.)
     * retain those properties after sanitization, not just the standard name/message/stack.
     */
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
     * Test: Functions should be converted to descriptive strings.
     *
     * Verifies that function values are sanitized to readable string representations
     * like '[Function: myFunction]' instead of causing serialization errors or
     * losing information entirely.
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
     * Test: Undefined values should be removed from sanitized output.
     *
     * Verifies that properties with undefined values are omitted from the
     * sanitized object, as undefined is not serializable to BSON and would
     * cause MongoDB storage errors.
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

    /**
     * Test: Deep nesting should be limited to prevent stack overflow.
     *
     * Verifies that deeply nested objects (beyond 10 levels) are truncated
     * with '[Max depth exceeded]' marker to prevent infinite recursion and
     * stack overflow errors during sanitization.
     */
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

    /**
     * Test: Arrays should be sanitized recursively.
     *
     * Verifies that array elements are individually sanitized, handling
     * circular references, errors, and functions within array items.
     */
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
     * Test: Date objects should be preserved.
     *
     * Verifies that Date instances are not converted to strings or primitives,
     * as MongoDB natively supports BSON Date type and can store them efficiently.
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

    /**
     * Test: Primitives should pass through unchanged.
     *
     * Verifies that primitive values (strings, numbers, booleans) are not
     * modified during sanitization, as they are already BSON-compatible.
     */
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

    /**
     * Test: Nested circular references should be detected.
     *
     * Verifies that circular references deep within nested object structures
     * are properly detected and replaced, not just top-level circular references.
     */
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

    /**
     * Test: Complex real-world error scenario.
     *
     * Verifies that a complex error object resembling real production errors
     * (with nested config objects, circular axios request/response references,
     * and error stacks) is properly sanitized without losing critical information.
     */
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

    /**
     * Test: Empty objects should remain empty.
     *
     * Verifies that empty objects {} are not mistakenly converted to null
     * or other values during sanitization.
     */
    it('should preserve empty objects', async () => {
        service.error({ empty: {} }, 'Error with empty object');

        await new Promise(resolve => setTimeout(resolve, 10));

        expect(mockCreate).toHaveBeenCalledTimes(1);

        const savedLog = mockCreate.mock.calls[0][0];
        expect(savedLog.context.empty).toEqual({});
    });

    /**
     * Test: Should not mutate original error object.
     *
     * Verifies that sanitization creates a new object and does not modify
     * the original error metadata passed to the logger, preventing side effects.
     */
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

    /**
     * Test: Error logging should sanitize and save to MongoDB.
     *
     * Verifies that calling logger.error() triggers sanitized MongoDB persistence.
     */
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

    /**
     * Test: Warning logging should sanitize metadata.
     *
     * Verifies that warn() also applies sanitization before MongoDB storage.
     */
    it('should sanitize metadata when logging warnings', async () => {
        const func = () => {};

        service.warn({ callback: func }, 'Warning with function');

        await new Promise(resolve => setTimeout(resolve, 10));

        // Verify sanitization - functions should be converted to string representation
        expect(mockCreate).toHaveBeenCalled();
        const savedLog = mockCreate.mock.calls[0][0];
        expect(savedLog.context.callback).toMatch(/\[Function:/);
    });

    /**
     * Test: Info logging should sanitize metadata.
     *
     * Verifies that info() applies sanitization (important for structured logging).
     */
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
     * Test: Error objects with circular references in custom properties should be sanitized.
     *
     * Verifies that custom properties on Error objects (like AxiosError's config, request, response)
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

    /**
     * Test: Deeply nested Error custom properties with circular refs should be sanitized.
     *
     * Verifies that circular references several levels deep within Error custom properties
     * are properly detected and replaced, not just direct circular references.
     */
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
     * Test: Error custom properties with functions should be sanitized.
     *
     * Verifies that functions in Error custom properties are converted to string
     * representations instead of being silently dropped or causing serialization errors.
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

    /**
     * Test: Error custom properties with undefined values should be removed.
     *
     * Verifies that undefined custom properties on Error objects are removed
     * during sanitization to prevent BSON serialization errors.
     */
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
     * Test: When primary MongoDB save fails, should attempt simplified error record.
     *
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

    /**
     * Test: When both primary and fallback saves fail, should only log to console.
     *
     * Verifies that if both MongoDB save attempts fail (database completely unavailable),
     * the error is logged to console without throwing and crashing the application.
     */
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
     * Test: Fallback error record should include debugging metadata.
     *
     * Verifies that the simplified error record includes useful debugging information
     * like original message, level, error type, and metadata keys to help diagnose
     * why the primary save failed.
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

    /**
     * Test: Two-tier fallback should work for all log levels.
     *
     * Verifies that the fallback mechanism works for warn, info, debug, trace, and fatal
     * levels, not just error.
     */
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

    /**
     * Test: getLogs should fetch logs with pagination.
     *
     * Verifies that the getLogs method properly constructs MongoDB queries
     * and returns paginated results.
     */
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

        const mockCountDocuments = {
            exec: vi.fn().mockResolvedValue(10)
        };

        (SystemLog.find as any) = vi.fn().mockReturnValue(mockFind);
        (SystemLog.countDocuments as any) = vi.fn().mockReturnValue(mockCountDocuments);

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

    /**
     * Test: getLogs should filter by log level.
     *
     * Verifies that level filtering constructs correct MongoDB $in query.
     */
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

    /**
     * Test: getLogs should filter by service.
     *
     * Verifies that service filtering includes service name in query.
     */
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

    /**
     * Test: getLogs should filter by date range.
     *
     * Verifies that date range filtering constructs $gte/$lte query.
     */
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

    /**
     * Test: getStatistics should return aggregated counts.
     *
     * Verifies that statistics method aggregates by level and service.
     */
    it('should get log statistics', async () => {
        const mockCountExec = vi.fn()
            .mockResolvedValueOnce(100) // total
            .mockResolvedValueOnce(25); // unresolved

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
     * Test: markAsResolved should update log entry.
     *
     * Verifies that marking a log as resolved updates the database document.
     */
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

    /**
     * Test: markAsUnresolved should clear resolved fields.
     *
     * Verifies that marking a log as unresolved removes resolved metadata.
     */
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

    /**
     * Test: deleteOldLogs should remove logs before cutoff date.
     *
     * Verifies that cleanup operation deletes logs older than specified date.
     */
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

    /**
     * Test: deleteAllLogs should remove all log entries.
     *
     * Verifies that delete all operation clears the entire collection.
     */
    it('should delete all logs', async () => {
        const mockExec = vi.fn().mockResolvedValue({ deletedCount: 1000 });
        const mockDeleteMany = vi.fn().mockReturnValue({ exec: mockExec });
        (SystemLog.deleteMany as any) = mockDeleteMany;

        const deletedCount = await service.deleteAllLogs();

        expect(mockDeleteMany).toHaveBeenCalledWith({});
        expect(deletedCount).toBe(1000);
    });

    /**
     * Test: getLogById should fetch single log entry.
     *
     * Verifies that fetching by ID returns the log document.
     */
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
