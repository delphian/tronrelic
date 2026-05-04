/**
 * @fileoverview Shared IServiceRegistry mock for Vitest.
 *
 * Wraps the real ServiceRegistry implementation with a no-op logger so tests
 * exercise production semantics — register throws on duplicate or null/undefined,
 * watch fires onAvailable synchronously when the service is already registered,
 * unregister emits onUnavailable to existing watchers — without depending on a
 * live system logger or MongoDB.
 *
 * Each test file previously hand-rolled its own in-memory registry with a Map.
 * Those mocks all silently overwrote duplicates, which let tests pass against
 * behaviors the real registry rejects (registering the same name twice from
 * two modules, registering null). Centralizing here keeps tests aligned with
 * runtime contracts and the four prior call sites consistent.
 *
 * @module tests/vitest/mocks/service-registry
 */

import { ServiceRegistry } from '../../../services/service-registry.js';
import type { ISystemLogService, IServiceRegistry } from '@/types';

/**
 * Minimal ISystemLogService used by the real ServiceRegistry for register /
 * unregister logging and watcher error isolation. Tests rarely care about
 * those messages, so all methods are no-ops; child() returns the same
 * instance to satisfy the recursive type without allocating a tree.
 */
function createSilentLogger(): ISystemLogService {
    const noop = (): void => undefined;
    const logger = {
        level: 'silent',
        info: noop,
        warn: noop,
        error: noop,
        debug: noop,
        trace: noop,
        fatal: noop,
        child: () => logger,
        initialize: async () => undefined,
        save: async () => undefined,
        query: async () => ({ entries: [], total: 0 }),
        getById: async () => null,
        markResolved: async () => null,
        deleteById: async () => false,
        deleteByIds: async () => 0,
        deleteAll: async () => 0
    } as unknown as ISystemLogService;
    return logger;
}

/**
 * Build a ServiceRegistry mirroring production semantics.
 *
 * Pre-loads any seeded services via the real `register()` so duplicate
 * registrations are caught the same way they would be at runtime. Returns
 * the underlying `ServiceRegistry` instance (typed as IServiceRegistry) so
 * callers can pass it wherever the interface is expected.
 *
 * @param seed - Optional name → service map registered before return
 * @returns A live IServiceRegistry backed by the real ServiceRegistry class
 */
export function createMockServiceRegistry(seed?: Record<string, unknown>): IServiceRegistry {
    const registry = new ServiceRegistry(createSilentLogger());
    if (seed) {
        for (const [name, service] of Object.entries(seed)) {
            registry.register(name, service);
        }
    }
    return registry;
}
