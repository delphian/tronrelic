/**
 * @fileoverview Service registry interface for cross-component service discovery.
 *
 * Enables plugins and modules to register named services that other consumers
 * can look up at runtime. This extends the existing dependency injection pattern
 * with late-binding resolution — consumers depend on interfaces retrieved by name,
 * never on concrete implementations.
 *
 * @module types/services/IServiceRegistry
 */
/**
 * Central registry for named service instances.
 *
 * Modules and plugins register services during initialization, and any consumer
 * can look them up by name. Services are typed generically so callers retrieve
 * the correct interface without casting.
 *
 * Follows the same DI principle as constructor injection — consumers depend on
 * abstractions, not implementations. The registry is the resolution mechanism;
 * the contract remains interface-based.
 *
 * @example
 * ```typescript
 * // Plugin registers a service during init()
 * context.services.register('ai-assistant', myAiService);
 *
 * // Another plugin retrieves it
 * const ai = context.services.get<IAiAssistantService>('ai-assistant');
 * if (ai) {
 *     const response = await ai.submitPrompt('Analyze this transaction');
 * }
 * ```
 */
export interface IServiceRegistry {
    /**
     * Register a named service instance.
     *
     * Throws if a service with the same name is already registered. Use `has()`
     * to check before registering if the caller may not be the only provider.
     *
     * @param name - Unique service identifier (kebab-case by convention)
     * @param service - The service instance to register
     * @throws Error if a service with this name is already registered
     */
    register<T>(name: string, service: T): void;
    /**
     * Retrieve a registered service by name.
     *
     * Returns undefined if no service is registered under the given name.
     * Callers should handle the undefined case gracefully — the providing
     * plugin may be disabled or not yet initialized.
     *
     * @param name - Service identifier to look up
     * @returns The service instance, or undefined if not registered
     */
    get<T>(name: string): T | undefined;
    /**
     * Check whether a service is registered under the given name.
     *
     * @param name - Service identifier to check
     * @returns True if a service is registered under this name
     */
    has(name: string): boolean;
    /**
     * Remove a previously registered service.
     *
     * Used during plugin disable/uninstall to clean up services that are
     * no longer available. No-op if the name is not registered.
     *
     * @param name - Service identifier to remove
     * @returns True if a service was removed, false if name was not registered
     */
    unregister(name: string): boolean;
    /**
     * List all registered service names.
     *
     * Useful for diagnostics and admin tooling. Does not expose the service
     * instances themselves — use `get()` to retrieve specific services.
     *
     * @returns Array of registered service names
     */
    getNames(): string[];
}
//# sourceMappingURL=IServiceRegistry.d.ts.map