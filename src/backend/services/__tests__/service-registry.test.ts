/// <reference types="vitest" />

/**
 * Unit tests for ServiceRegistry.
 *
 * Covers register/unregister/get/has/getNames and the state-oriented
 * watch() subscription: synchronous replay for already-registered services,
 * dispatch on later register/unregister, disposer behavior, and error
 * isolation of watcher callbacks.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ISystemLogService } from '@/types';
import { ServiceRegistry } from '../service-registry.js';

/**
 * Mock logger implementation for testing.
 */
class MockLogger implements ISystemLogService {
    public level = 'info';
    public fatal = vi.fn();
    public error = vi.fn();
    public warn = vi.fn();
    public info = vi.fn();
    public debug = vi.fn();
    public trace = vi.fn();
    public child = vi.fn((_bindings: Record<string, unknown>): ISystemLogService => {
        return this;
    });

    public async initialize() {}
    public async saveLog() {}
    public async getLogs() {
        return { logs: [], total: 0, page: 1, limit: 50, totalPages: 0, hasNextPage: false, hasPrevPage: false };
    }
    public async markAsResolved() {}
    public async cleanup() { return 0; }
    public async getStatistics() { return { total: 0, byLevel: {} as any, byService: {}, unresolved: 0 }; }
    public async getLogById() { return null; }
    public async markAsUnresolved() { return null; }
    public async deleteAllLogs() { return 0; }
    public async getStats() { return { total: 0, byLevel: {} as any, resolved: 0, unresolved: 0 }; }
    public async waitUntilInitialized() {}
}

interface IExampleService {
    id: string;
}

describe('ServiceRegistry', () => {
    let logger: MockLogger;
    let registry: ServiceRegistry;

    beforeEach(() => {
        logger = new MockLogger();
        registry = new ServiceRegistry(logger);
    });

    describe('register / get / has / unregister', () => {
        it('stores and retrieves a service by name', () => {
            const svc: IExampleService = { id: 'a' };
            registry.register('example', svc);

            expect(registry.has('example')).toBe(true);
            expect(registry.get<IExampleService>('example')).toBe(svc);
            expect(registry.getNames()).toEqual(['example']);
        });

        it('throws when registering a duplicate name', () => {
            registry.register('example', { id: 'a' });
            expect(() => registry.register('example', { id: 'b' })).toThrow(/already registered/);
        });

        it('throws when registering null or undefined', () => {
            expect(() => registry.register('example', null)).toThrow(/Cannot register null or undefined/);
            expect(() => registry.register('example', undefined)).toThrow(/Cannot register null or undefined/);
        });

        it('returns undefined for unknown names', () => {
            expect(registry.get('missing')).toBeUndefined();
            expect(registry.has('missing')).toBe(false);
        });

        it('unregister returns true when removed and false when absent', () => {
            registry.register('example', { id: 'a' });
            expect(registry.unregister('example')).toBe(true);
            expect(registry.has('example')).toBe(false);
            expect(registry.unregister('example')).toBe(false);
        });
    });

    describe('watch — state-oriented subscription', () => {
        it('fires onAvailable synchronously if the service is already registered', () => {
            const svc: IExampleService = { id: 'a' };
            registry.register('example', svc);

            const onAvailable = vi.fn();
            registry.watch<IExampleService>('example', { onAvailable });

            expect(onAvailable).toHaveBeenCalledTimes(1);
            expect(onAvailable).toHaveBeenCalledWith(svc);
        });

        it('does not fire onAvailable at subscription time if the service is absent', () => {
            const onAvailable = vi.fn();
            registry.watch('example', { onAvailable });

            expect(onAvailable).not.toHaveBeenCalled();
        });

        it('fires onAvailable when the service is registered later', () => {
            const onAvailable = vi.fn();
            registry.watch<IExampleService>('example', { onAvailable });

            const svc: IExampleService = { id: 'a' };
            registry.register('example', svc);

            expect(onAvailable).toHaveBeenCalledTimes(1);
            expect(onAvailable).toHaveBeenCalledWith(svc);
        });

        it('fires onUnavailable when the service is unregistered', () => {
            const onUnavailable = vi.fn();
            registry.register('example', { id: 'a' });
            registry.watch('example', { onUnavailable });

            registry.unregister('example');
            expect(onUnavailable).toHaveBeenCalledTimes(1);
        });

        it('does not fire onUnavailable for a no-op unregister', () => {
            const onUnavailable = vi.fn();
            registry.watch('example', { onUnavailable });

            expect(registry.unregister('example')).toBe(false);
            expect(onUnavailable).not.toHaveBeenCalled();
        });

        it('handles register → unregister → register cycles', () => {
            const onAvailable = vi.fn();
            const onUnavailable = vi.fn();
            registry.watch<IExampleService>('example', { onAvailable, onUnavailable });

            const first: IExampleService = { id: 'first' };
            registry.register('example', first);
            registry.unregister('example');

            const second: IExampleService = { id: 'second' };
            registry.register('example', second);

            expect(onAvailable).toHaveBeenCalledTimes(2);
            expect(onAvailable).toHaveBeenNthCalledWith(1, first);
            expect(onAvailable).toHaveBeenNthCalledWith(2, second);
            expect(onUnavailable).toHaveBeenCalledTimes(1);
        });

        it('supports multiple watchers on the same name', () => {
            const a = vi.fn();
            const b = vi.fn();

            registry.watch('example', { onAvailable: a });
            registry.watch('example', { onAvailable: b });

            registry.register('example', { id: 'x' });

            expect(a).toHaveBeenCalledTimes(1);
            expect(b).toHaveBeenCalledTimes(1);
        });

        it('disposer removes the subscription', () => {
            const onAvailable = vi.fn();
            const unwatch = registry.watch('example', { onAvailable });

            unwatch();

            registry.register('example', { id: 'x' });
            expect(onAvailable).not.toHaveBeenCalled();
        });

        it('disposer is idempotent', () => {
            const onAvailable = vi.fn();
            const unwatch = registry.watch('example', { onAvailable });

            unwatch();
            expect(() => unwatch()).not.toThrow();

            registry.register('example', { id: 'x' });
            expect(onAvailable).not.toHaveBeenCalled();
        });

        it('isolates a throwing onAvailable from other watchers and the caller', () => {
            const good = vi.fn();
            registry.watch('example', {
                onAvailable: () => { throw new Error('boom'); }
            });
            registry.watch('example', { onAvailable: good });

            expect(() => registry.register('example', { id: 'x' })).not.toThrow();
            expect(good).toHaveBeenCalledTimes(1);
            expect(logger.warn).toHaveBeenCalled();
        });

        it('isolates a throwing onUnavailable from other watchers and the caller', () => {
            const good = vi.fn();
            registry.register('example', { id: 'x' });
            registry.watch('example', {
                onUnavailable: () => { throw new Error('boom'); }
            });
            registry.watch('example', { onUnavailable: good });

            expect(() => registry.unregister('example')).not.toThrow();
            expect(good).toHaveBeenCalledTimes(1);
            expect(logger.warn).toHaveBeenCalled();
        });

        it('isolates a rejecting async onAvailable from other watchers', async () => {
            const good = vi.fn();
            registry.watch('example', {
                onAvailable: async () => { throw new Error('async boom'); }
            });
            registry.watch('example', { onAvailable: good });

            registry.register('example', { id: 'x' });

            await new Promise(resolve => setImmediate(resolve));

            expect(good).toHaveBeenCalledTimes(1);
            expect(logger.warn).toHaveBeenCalled();
        });

        it('allows a watcher to unwatch itself from inside its own callback', () => {
            let unwatchSelf: (() => void) | null = null;
            const onAvailable = vi.fn(() => { unwatchSelf?.(); });
            const other = vi.fn();

            unwatchSelf = registry.watch('example', { onAvailable });
            registry.watch('example', { onAvailable: other });

            registry.register('example', { id: 'x' });

            expect(onAvailable).toHaveBeenCalledTimes(1);
            expect(other).toHaveBeenCalledTimes(1);

            registry.unregister('example');
            registry.register('example', { id: 'y' });

            expect(onAvailable).toHaveBeenCalledTimes(1);
            expect(other).toHaveBeenCalledTimes(2);
        });
    });
});
