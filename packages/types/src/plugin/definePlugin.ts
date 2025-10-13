import type { IPlugin } from './IPlugin.js';

/**
 * Helper to define a plugin with type safety.
 *
 * Ensures plugin objects conform to the IPlugin interface at compile time. This function
 * provides IDE autocomplete and type checking when authoring plugin definitions, catching
 * configuration errors before runtime. It's a simple pass-through that exists purely for
 * developer experience and type safety.
 */
export function definePlugin(plugin: IPlugin): IPlugin {
    return plugin;
}
