/**
 * @fileoverview Concrete implementation of IServiceRegistry.
 *
 * Provides a Map-based service registry that enables plugins and modules to
 * register named services for cross-component discovery. Created once during
 * bootstrap and injected into plugin contexts via dependency injection.
 *
 * @module services/service-registry
 */

import type { IServiceRegistry } from '@/types';
import type { ISystemLogService } from '@/types';

/**
 * Map-based service registry for runtime service discovery.
 *
 * Wraps a simple Map with type-safe generics, duplicate detection, and
 * lifecycle logging. A single instance is created during bootstrap and
 * shared across all plugin contexts.
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
        if (this.services.has(name)) {
            throw new Error(`Service '${name}' is already registered. Unregister it first to replace.`);
        }
        this.services.set(name, service);
        this.logger.info({ serviceName: name }, `Service registered: ${name}`);
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
}
