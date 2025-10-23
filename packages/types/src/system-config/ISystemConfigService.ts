import type { ISystemConfig } from './ISystemConfig.js';

/**
 * ISystemConfigService
 *
 * Service contract for managing system-wide configuration.
 * Provides read and write access to database-backed settings that
 * need to be editable at runtime without redeployment.
 *
 * Why this interface exists:
 * Plugins and core services need access to system configuration (like the site URL
 * for webhook construction) but shouldn't depend on concrete implementations or
 * MongoDB models. This interface allows dependency injection, making services
 * testable and decoupled from infrastructure.
 *
 * **Implementation Notes:**
 * - Concrete implementation should cache values to minimize database queries
 * - Updates should invalidate cache to ensure freshness
 * - Fallback to sensible defaults when database is unavailable
 *
 * **Usage Example:**
 * ```typescript
 * // In plugin backend
 * export function myPlugin(context: IPluginContext) {
 *   const siteUrl = await context.systemConfig.getSiteUrl();
 *   const webhookUrl = `${siteUrl}/api/plugins/my-plugin/webhook`;
 * }
 * ```
 */
export interface ISystemConfigService {
    /**
     * Retrieves the complete system configuration.
     *
     * Why return full config:
     * Callers may need multiple settings at once. Returning the complete
     * object reduces round trips and allows destructuring.
     *
     * @returns Complete system configuration object
     */
    getConfig(): Promise<ISystemConfig>;

    /**
     * Gets the public site URL.
     *
     * This is the most commonly accessed setting, so it gets a dedicated
     * convenience method. Implementations may optimize this further by
     * caching just the string value instead of the full config object.
     *
     * @returns Public-facing site URL (e.g., "https://tronrelic.com")
     */
    getSiteUrl(): Promise<string>;

    /**
     * Updates system configuration with new values.
     *
     * Why partial updates:
     * Admin UI may update one setting at a time (e.g., just the site URL).
     * Requiring the full object would force callers to fetch-then-merge,
     * creating race conditions. Partial updates solve this atomically.
     *
     * @param updates - Fields to update (only siteUrl currently supported)
     * @param updatedBy - Optional admin identifier for audit trail
     * @returns Updated configuration object
     */
    updateConfig(
        updates: Partial<Pick<ISystemConfig, 'siteUrl'>>,
        updatedBy?: string
    ): Promise<ISystemConfig>;

    /**
     * Clears any internal caches.
     *
     * Why manual cache clear:
     * While implementations should use TTL-based caching, some scenarios
     * require immediate invalidation (integration tests, bulk admin operations).
     * This method forces a fresh database read on the next getConfig() call.
     */
    clearCache(): void;
}
