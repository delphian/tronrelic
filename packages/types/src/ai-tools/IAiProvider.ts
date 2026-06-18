/**
 * @file IAiProvider.ts
 *
 * Provider-neutral execution contract for an installed AI provider plugin.
 * Consuming plugins and core surfaces discover the *active* provider at runtime
 * through the core `'ai-providers'` registry ({@link IAiProviderRegistry.getActive})
 * and use it to submit programmatic queries (`query` / `ask`), stream a query
 * with live chunks (`queryStream`), cancel an in-flight stream (`cancel`), and
 * list models. Resolving through the registry — never a vendor service key like
 * `'ai-assistant'` — keeps the lookup working when the provider plugin is
 * swapped (Anthropic today, OpenAI or Google tomorrow).
 *
 * Tool registration is core-owned — register tools on the `'ai-tools'` registry
 * ({@link IAiToolRegistry}), not here. See system-ai-tools.md.
 */

import type { IAiQueryOptions } from './IAiQueryOptions.js';
import type { IAiQueryResult } from './IAiQueryResult.js';
import type { IAiStreamChunk } from './IAiStreamChunk.js';
import type { IModelInfo } from './IModelInfo.js';
import type { IAiToolInfo } from './IAiToolRegistry.js';

/**
 * Execution contract every AI provider plugin implements and registers on the
 * core `'ai-providers'` registry.
 *
 * Discovered at runtime through the registry's executable accessor:
 * ```typescript
 * const providers = context.services.get<IAiProviderRegistry>('ai-providers');
 * const ai = providers?.getActive();
 * if (ai) {
 *     // Submit a programmatic query using configured defaults
 *     const result = await ai.ask('How many transactions in the last hour?');
 *
 *     // Submit a query with explicit overrides
 *     const detailed = await ai.query({
 *         prompt: 'Analyze {%system-status%}',
 *         maxTokens: 8192,
 *         includeTools: false
 *     });
 * }
 * ```
 *
 * Consuming code should always guard against the active provider being null,
 * since every provider plugin may be disabled.
 */
export interface IAiProvider {
    /**
     * Execute a non-streaming AI query with explicit parameter overrides.
     *
     * Only `prompt` is required. Omitted parameters fall back to the provider's
     * configured defaults. Registered (enabled) tools are included unless
     * `includeTools` is set to false. Template variables are expanded unless
     * `expandVariables` is false.
     *
     * @param options - Query options with prompt and optional overrides.
     * @returns Complete response with text, model, stop reason, and usage.
     * @throws On API failures, missing API key, or invalid configuration.
     */
    query(options: IAiQueryOptions): Promise<IAiQueryResult>;

    /**
     * Convenience wrapper: submit a prompt using all configured defaults.
     *
     * Equivalent to `query({ prompt })`.
     *
     * @param prompt - The natural language prompt to send to the model.
     * @returns Complete response with text, model, stop reason, and usage.
     * @throws On API failures, missing API key, or invalid configuration.
     */
    ask(prompt: string): Promise<IAiQueryResult>;

    /**
     * Execute a streaming AI query, invoking `onChunk` for each text delta, the
     * terminal `done` chunk (carrying usage), or an `error` chunk. The provider
     * stays transport-agnostic: it reports chunks through the callback and the
     * caller decides how to deliver them (e.g. a core WebSocket room keyed by
     * `queryId`). Resolves with the same complete result as `query` once the
     * stream finishes.
     *
     * @param options - Query options; `queryId` correlates the emitted chunks.
     * @param onChunk - Sink invoked for every stream chunk, in order.
     * @returns The complete response once streaming completes.
     * @throws On API failures, missing API key, or invalid configuration.
     */
    queryStream(options: IAiQueryOptions, onChunk: (chunk: IAiStreamChunk) => void): Promise<IAiQueryResult>;

    /**
     * Cancel an in-flight streaming query by its `queryId`.
     *
     * @param queryId - The id supplied in the originating query options.
     * @returns `true` when an active query was found and aborted, else `false`.
     */
    cancel(queryId: string): boolean;

    /**
     * Retrieve the list of available models from the provider.
     *
     * @returns Array of model info objects with id, display name, and token limits.
     * @throws On API failures or missing API key configuration.
     */
    listModels(): Promise<IModelInfo[]>;

    /**
     * Report the provider-hosted (server-side) tools currently enabled for the
     * active configuration — tools the model can invoke that execute on the
     * vendor's infrastructure and so never pass through the tool governor
     * (Anthropic's `web_search` / `web_fetch`). Core has no other way to see
     * them, so the lethal-trifecta detector folds these entries in alongside the
     * governed registry tools to keep the `safe` / `supervised` / `lethal`
     * verdict honest: a `web_fetch` reports as both an untrusted-content ingress
     * and an open egress leg. Return an empty array when none are enabled or the
     * provider hosts no such tools.
     *
     * @returns Capability-classified info for each enabled server-side tool.
     */
    listActiveServerTools(): Promise<IAiToolInfo[]>;
}
