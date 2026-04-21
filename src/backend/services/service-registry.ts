/**
 * @fileoverview Concrete implementation of IServiceRegistry.
 *
 * Provides a Map-based service registry that enables plugins and modules to
 * register named services for cross-component discovery. Created once during
 * bootstrap and injected into plugin contexts via dependency injection.
 *
 * The registry is modeled as state, not as an event stream: each named slot
 * is either filled or empty, and the `watch()` API lets consumers stay
 * aligned with that truth over time. See the JSDoc on
 * `IServiceRegistry.watch` for the rationale behind state-oriented rather
 * than event-oriented subscription semantics.
 *
 * @module services/service-registry
 */

import type {
    IServiceRegistry,
    IServiceWatchHandlers,
    ServiceWatchDisposer,
    ISystemLogService
} from '@/types';

/**
 * Internal handler storage type. The registry holds watcher records for
 * arbitrary service shapes; typed views are reconstructed at the call
 * sites via the generic parameter on `watch<T>()`.
 */
type AnyWatchHandlers = IServiceWatchHandlers<unknown>;

/**
 * Map-based service registry for runtime service discovery.
 *
 * Wraps a simple Map with type-safe generics, duplicate detection,
 * lifecycle logging, and state-oriented subscriptions via `watch()`.
 * A single instance is created during bootstrap and shared across all
 * plugin contexts.
 *
 * @example
 * ```typescript
 * const registry = new ServiceRegistry(logger);
 * registry.register('ai-assistant', aiService);
 * const ai = registry.get<IAiAssistantService>('ai-assistant');
 * ```
 */
export class ServiceRegistry implements IServiceRegistry {
    /** Internal storage for registered services */
    private readonly services: Map<string, unknown> = new Map();

    /** Active watcher handlers, keyed by service name */
    private readonly watchers: Map<string, Set<AnyWatchHandlers>> = new Map();

    /**
     * Create a new ServiceRegistry.
     *
     * @param logger - System logger for registration and lookup diagnostics
     */
    constructor(private readonly logger: ISystemLogService) {}

    /**
     * Register a named service instance.
     *
     * @param name - Unique service identifier (kebab-case by convention)
     * @param service - The service instance to register
     * @throws Error if a service with this name is already registered
     */
    register<T>(name: string, service: T): void {
        if (service === null || service === undefined) {
            throw new Error(`Cannot register null or undefined for service '${name}'.`);
        }
        if (this.services.has(name)) {
            throw new Error(`Service '${name}' is already registered. Unregister it first to replace.`);
        }
        this.services.set(name, service);
        this.logger.info({ serviceName: name }, `Service registered: ${name}`);

        this.dispatchAvailable(name, service);
    }

    /**
     * Retrieve a registered service by name.
     *
     * @param name - Service identifier to look up
     * @returns The service instance, or undefined if not registered
     */
    get<T>(name: string): T | undefined {
        return this.services.get(name) as T | undefined;
    }

    /**
     * Check whether a service is registered under the given name.
     *
     * @param name - Service identifier to check
     * @returns True if a service is registered under this name
     */
    has(name: string): boolean {
        return this.services.has(name);
    }

    /**
     * Remove a previously registered service.
     *
     * @param name - Service identifier to remove
     * @returns True if a service was removed, false if name was not registered
     */
    unregister(name: string): boolean {
        const removed = this.services.delete(name);
        if (removed) {
            this.logger.info({ serviceName: name }, `Service unregistered: ${name}`);
            this.dispatchUnavailable(name);
        }

        return removed;
    }

    /**
     * List all registered service names.
     *
     * @returns Array of registered service names
     */
    getNames(): string[] {
        return Array.from(this.services.keys());
    }

    /**
     * Subscribe to the presence of a named service over time.
     *
     * If the service is already registered, `onAvailable` fires
     * synchronously before this method returns. Subsequent `register()` /
     * `unregister()` calls against this name re-fire the appropriate
     * handler. The returned disposer removes both handlers.
     *
     * See `IServiceRegistry.watch` for the state-vs-event rationale.
     *
     * @param name - Service identifier to watch
     * @param handlers - `onAvailable` and/or `onUnavailable` callbacks
     * @returns Disposer function that removes the subscription when called
     */
    watch<T>(name: string, handlers: IServiceWatchHandlers<T>): ServiceWatchDisposer {
        const erased = handlers as AnyWatchHandlers;

        let set = this.watchers.get(name);
        if (!set) {
            set = new Set();
            this.watchers.set(name, set);
        }
        set.add(erased);

        const existing = this.services.get(name);
        if (existing !== undefined && handlers.onAvailable) {
            this.safeInvoke(name, 'onAvailable', () => handlers.onAvailable!(existing as T));
        }

        return () => {
            const current = this.watchers.get(name);
            if (!current) return;
            current.delete(erased);
            if (current.size === 0) {
                this.watchers.delete(name);
            }
        };
    }

    /**
     * Fire `onAvailable` for every watcher bound to this name.
     *
     * Iterates over a snapshot so a watcher that calls `watch()` or the
     * returned disposer from within its own callback can't mutate the
     * iteration order mid-loop.
     */
    private dispatchAvailable(name: string, service: unknown): void {
        const set = this.watchers.get(name);
        if (!set || set.size === 0) return;

        for (const handlers of Array.from(set)) {
            if (!handlers.onAvailable) continue;
            this.safeInvoke(name, 'onAvailable', () => handlers.onAvailable!(service));
        }
    }

    /**
     * Fire `onUnavailable` for every watcher bound to this name.
     */
    private dispatchUnavailable(name: string): void {
        const set = this.watchers.get(name);
        if (!set || set.size === 0) return;

        for (const handlers of Array.from(set)) {
            if (!handlers.onUnavailable) continue;
            this.safeInvoke(name, 'onUnavailable', () => handlers.onUnavailable!());
        }
    }

    /**
     * Invoke a watcher callback with error isolation.
     *
     * A throwing watcher must not break `register` / `unregister` for the
     * calling plugin or prevent other watchers on the same name from
     * running. Async callbacks that reject are handled via the returned
     * promise's rejection handler.
     */
    private safeInvoke(name: string, kind: 'onAvailable' | 'onUnavailable', fn: () => void | Promise<void>): void {
        try {
            const result = fn();
            if (result && typeof (result as Promise<void>).then === 'function') {
                (result as Promise<void>).catch((err: unknown) => {
                    this.logger.warn(
                        { err, serviceName: name, handler: kind },
                        'Service registry watcher rejected'
                    );
                });
            }
        } catch (err) {
            this.logger.warn(
                { err, serviceName: name, handler: kind },
                'Service registry watcher threw'
            );
        }
    }
}
