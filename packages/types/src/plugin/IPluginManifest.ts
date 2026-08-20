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

/**
 * The character rule a plugin's `manifest.id` must satisfy: a lowercase
 * letter, then lowercase letters, digits, or hyphens, up to 64 characters.
 *
 * The rule matters because the id is not just a label — it namespaces a
 * plugin's stored data through `pluginPrefix()`, and it does so by being
 * embedded verbatim. Two properties depend on this pattern.
 *
 * The first is that the id must never contain `_`. That character delimits the
 * id from the collection or table name following it, and a delimiter appearing
 * inside the field it delimits would make one plugin's prefix the opening of
 * another's, so a listing filtered by the first would return the second
 * plugin's data.
 *
 * The second is that the id reaches ClickHouse as part of a table name, and
 * the installed client interpolates a table name into SQL without escaping it.
 * The id is therefore trusted input to a statement, and this gate is what makes
 * that trust sound. Relaxing it would open an injection path, so treat it as
 * load-bearing rather than cosmetic.
 */
export const PLUGIN_ID_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;
