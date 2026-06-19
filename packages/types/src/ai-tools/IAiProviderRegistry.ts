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

import type { IAiProvider } from './IAiProvider.js';

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
     * Register or replace a provider's metadata together with its executable
     * instance. Idempotent — a provider that re-registers (e.g. after a runtime
     * re-enable) overwrites its prior entry.
     *
     * @param info - The provider's self-reported metadata.
     * @param instance - The provider's executable service, returned by
     *   {@link IAiProviderRegistry.getActive} while this provider is active.
     */
    registerProvider(info: IAiProviderInfo, instance: IAiProvider): void;

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

    /**
     * The executable instance of the currently active provider, or `null` when
     * no provider is installed or active. This is the provider-neutral way for
     * core surfaces and consumer plugins to actuate "whatever AI provider is
     * installed" without binding to a vendor service key like `'ai-assistant'`.
     *
     * @returns The active provider's executable instance, or `null`.
     */
    getActive(): IAiProvider | null;

    /**
     * The executable instance of a specific registered provider by id, or `null`
     * when no provider with that id is installed. Unlike {@link getActive}, this
     * resolves a provider even when it is not the active transport — used to run
     * a saved prompt pinned to a particular provider/model regardless of which
     * provider is currently active. Returns `null` for an unknown id rather than
     * falling back to the active provider, so the caller decides whether to
     * substitute the active one or surface "that provider is not installed".
     *
     * @param id - The provider plugin id.
     * @returns The provider's executable instance, or `null`.
     */
    getProvider(id: string): IAiProvider | null;
}
