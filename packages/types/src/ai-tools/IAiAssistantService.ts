/**
 * @file IAiAssistantService.ts
 *
 * Public service interface for an AI Assistant plugin. Consuming plugins
 * discover this service at runtime via the shared service registry and use
 * it to register tools, submit programmatic queries, or both.
 */

import type { IAiTool } from './IAiTool.js';
import type { IAiQueryOptions } from './IAiQueryOptions.js';
import type { IAiQueryResult } from './IAiQueryResult.js';
import type { IModelInfo } from './IModelInfo.js';

/**
 * Service interface for an AI Assistant plugin.
 *
 * Discovered at runtime through the service registry:
 * ```typescript
 * const ai = context.services.get<IAiAssistantService>('ai-assistant');
 * if (ai) {
 *     // Register tools for the model
 *     ai.registerTool(myTool);
 *
 *     // Submit a programmatic query using configured defaults
 *     const result = await ai.ask('How many transactions in the last hour?');
 *
 *     // Submit a query with explicit overrides
 *     const result = await ai.query({
 *         prompt: 'Analyze {%system-status%}',
 *         maxTokens: 8192,
 *         includeTools: false
 *     });
 * }
 * ```
 *
 * Consuming plugins should always guard against the service being unavailable,
 * since the AI Assistant plugin may be disabled.
 */
export interface IAiAssistantService {
    /**
     * Register a tool for the model to use during AI-assisted queries.
     *
     * @param tool - Tool definition including name, schema, and handler.
     * @throws If a tool with the same name is already registered.
     */
    registerTool(tool: IAiTool): void;

    /**
     * Remove a previously registered tool by name.
     *
     * @param name - The tool name to unregister.
     * @returns `true` if the tool was found and removed, `false` otherwise.
     */
    unregisterTool(name: string): boolean;

    /**
     * List all currently registered tools.
     *
     * @returns Array of registered tool definitions.
     */
    listTools(): IAiTool[];

    /**
     * Execute a non-streaming AI query with explicit parameter overrides.
     *
     * Only `prompt` is required. Omitted parameters fall back to the
     * configured defaults from the AI Assistant settings tab. Registered
     * (enabled) tools are included unless `includeTools` is set to false.
     * Template variables are expanded unless `expandVariables` is false.
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
     * Retrieve the list of available models from the Anthropic API.
     *
     * Paginates through the Models API, merges static token limit metadata,
     * and returns results sorted alphabetically by display name. Results are
     * cached internally for subsequent lookups.
     *
     * @returns Array of model info objects with id, display name, and token limits.
     * @throws On API failures or missing API key configuration.
     */
    listModels(): Promise<IModelInfo[]>;
}
