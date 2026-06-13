/**
 * @file IAiProviderRegistry.ts
 *
 * Core-owned registry of installed AI provider plugins, so the admin surface can
 * show which providers exist, which is active, and what each offers — without
 * core knowing about any specific vendor. An AI provider plugin (today
 * `trp-ai-assistant` for Anthropic; tomorrow an OpenAI or Google plugin)
 * registers itself here on enable and unregisters on disable. Keeping this in
 * core means the Provider panel and the `aiProviderId` shown throughout the
 * dashboard survive swapping the provider plugin.
 */

/** Serializable metadata an AI provider plugin reports about itself. */
export interface IAiProviderInfo {
    /** Provider plugin manifest id (matches `aiProviderId` on invocation records). */
    id: string;

    /** Human-readable provider/vendor name for the admin UI (e.g. "Anthropic (Claude)"). */
    label: string;

    /** Whether this provider is currently the active transport for AI queries. */
    active: boolean;

    /** Model ids the provider exposes, when known. Omitted when not yet resolved. */
    models?: string[];

    /**
     * Provider-hosted tool names the model can call outside the governor (e.g. a
     * vendor `web_search` / `web_fetch`). Reported so the trifecta accounting and
     * Activity view stay aware of exposure the governor does not mediate.
     */
    hostedTools?: string[];
}

/**
 * Registration and lookup surface for installed AI provider plugins. Published
 * on the service registry as `'ai-providers'`; provider plugins register on
 * enable and unregister on disable, and the admin Provider panel reads the list.
 */
export interface IAiProviderRegistry {
    /**
     * Register or replace a provider's metadata. Idempotent — a provider that
     * re-registers (e.g. after a runtime re-enable) overwrites its prior entry.
     *
     * @param info - The provider's self-reported metadata.
     */
    registerProvider(info: IAiProviderInfo): void;

    /**
     * Remove a provider's registration.
     *
     * @param id - The provider plugin id.
     * @returns `true` when an entry was removed.
     */
    unregisterProvider(id: string): boolean;

    /**
     * All currently registered providers.
     *
     * @returns The provider metadata list.
     */
    listProviders(): IAiProviderInfo[];
}
