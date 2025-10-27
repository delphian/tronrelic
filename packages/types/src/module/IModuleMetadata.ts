/**
 * Module metadata for introspection and statistics.
 *
 * Provides identifying information about a backend module that can be used for:
 * - Runtime introspection and debugging
 * - System monitoring and health checks
 * - Module registry and discovery
 * - Logging and error attribution
 * - Future administrative interfaces
 *
 * Modules are permanent, core backend components (unlike plugins which can be
 * enabled/disabled). Metadata helps track and organize these essential services.
 */
export interface IModuleMetadata {
    /**
     * Unique identifier for the module.
     *
     * Should be lowercase kebab-case matching the module directory name.
     * Used for programmatic identification and logging contexts.
     *
     * @example 'pages', 'menu', 'system-log'
     */
    id: string;

    /**
     * Human-readable module name.
     *
     * Displayed in admin interfaces, logs, and error messages.
     *
     * @example 'Pages', 'Menu Service', 'System Logs'
     */
    name: string;

    /**
     * Semantic version string.
     *
     * Should follow semver format (major.minor.patch). Used for tracking
     * module versions independently from the application version.
     *
     * @example '1.0.0', '2.1.3'
     */
    version: string;

    /**
     * Optional human-readable description of module purpose.
     *
     * Explains what the module does and why it exists. Useful for documentation
     * generation and administrative interfaces.
     *
     * @example 'Provides custom page creation and markdown rendering for admin-authored content'
     */
    description?: string;
}
