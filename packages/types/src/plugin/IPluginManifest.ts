/**
 * Plugin manifest metadata.
 *
 * Declares a plugin's identity together with boolean flags that indicate which runtime
 * surfaces it exposes. Calling code infers the compiled entry points using the standard
 * plugin directory layout, eliminating the need to embed path strings inside manifests.
 */
export interface IPluginManifest {
    /** Unique plugin identifier (kebab-case) */
    id: string;
    /** Display title */
    title: string;
    /** Semantic version */
    version: string;
    /** Brief description of functionality */
    description?: string;
    /** Plugin author */
    author?: string;
    /** Software license */
    license?: string;
    /** Indicates the plugin publishes backend runtime code in dist/backend/backend.js */
    backend?: boolean;
    /** Indicates the plugin publishes frontend runtime code in dist/frontend.bundle.js */
    frontend?: boolean;
    /** Admin settings entry point URL (e.g., '/system/plugins/whale-alerts/settings') */
    adminUrl?: string;
}
