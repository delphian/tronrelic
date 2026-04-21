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
 * Handlers for tracking the presence of a named service over time.
 *
 * Passed to `IServiceRegistry.watch(name, handlers)`. Both handlers are
 * optional so consumers can subscribe to arrivals, departures, or both.
 */
export interface IServiceWatchHandlers<T> {
    /**
     * Invoked when the service becomes available under this name.
     *
     * Fires synchronously during `watch()` if the service is already
     * registered, and again on every subsequent `register()` call for this
     * name. Should be idempotent — a watcher that binds tools or wires up
     * state in this callback must handle being called more than once over
     * the lifetime of the subscription (e.g. when the provider is disabled
     * and re-enabled at runtime).
     */
    onAvailable?: (service: T) => void | Promise<void>;

    /**
     * Invoked when the service is unregistered under this name.
     *
     * By the time this fires the service instance has already been removed
     * from the registry. Treat it as past tense: the capability is gone,
     * not going. Any cached reference the watcher held should be dropped.
     */
    onUnavailable?: () => void | Promise<void>;
}

/**
 * Function returned by `watch()` that removes the subscription.
 *
 * Callers are expected to invoke this from their own `disable()` hook so
 * the registry doesn't retain closures pointing at torn-down state.
 */
export type ServiceWatchDisposer = () => void;

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
     * This is a one-shot point-in-time read. Callers that need to stay
     * aligned with the service's presence over time — for example, to
     * register peer-facing hooks the moment the service appears, or to
     * drop cached references when it goes away — should use `watch()`
     * instead.
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

    /**
     * Subscribe to the presence of a named service over time.
     *
     * `watch` is deliberately a state-oriented API, not an event-oriented
     * one. The registry models a continuous truth — *is this capability
     * available right now?* — and `watch` subscribes the caller to that
     * truth. An event-style `on('register', ...)` would expose the wrong
     * abstraction: it treats registration and unregistration as discrete
     * moments the subscriber may or may not have been listening for, and
     * forces every consumer to separately ask "is the service already
     * here?" before attaching, which re-opens the boot-order race the
     * registry exists to close.
     *
     * The practical consequences of the state-oriented model:
     *
     * 1. **Late subscribers are well-defined.** If the service is already
     *    registered at the moment `watch()` is called, `onAvailable` fires
     *    synchronously before `watch()` returns. Subscription and initial
     *    read collapse into a single operation.
     * 2. **Arrival and departure stay cohesive.** A consumer depends on one
     *    service with two phases (present/absent), not two independent
     *    events. The `{ onAvailable, onUnavailable }` pair keeps that
     *    single concern expressed as a single subscription.
     * 3. **Runtime churn is handled.** If the provider is disabled and
     *    re-enabled later, `onUnavailable` then `onAvailable` fire again
     *    on the same subscription — callers don't re-subscribe.
     *
     * Handlers are invoked with errors isolated: a throw in one watcher
     * does not prevent other watchers or the original `register` /
     * `unregister` call from completing.
     *
     * @param name - Service identifier to watch
     * @param handlers - `onAvailable` and/or `onUnavailable` callbacks
     * @returns Disposer function that removes the subscription when called
     *
     * @example
     * ```typescript
     * // In a plugin's init() hook
     * const unwatch = context.services.watch<IAiAssistantService>('ai-assistant', {
     *     onAvailable: (ai) => ai.registerTool(myToolDefinition),
     *     onUnavailable: () => context.logger.info('ai-assistant gone — tool unregistered')
     * });
     *
     * // In the plugin's disable() hook
     * unwatch();
     * ```
     */
    watch<T>(name: string, handlers: IServiceWatchHandlers<T>): ServiceWatchDisposer;
}
