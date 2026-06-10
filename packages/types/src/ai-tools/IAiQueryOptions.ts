/**
 * @file IAiQueryOptions.ts
 *
 * Low-level query options for programmatic AI requests via the service
 * registry. Every field except `prompt` is optional and falls back to
 * the configured defaults in the AI Assistant settings tab.
 */

import type { IAiTool } from './IAiTool.js';
import type { IAiConversationMessage } from './IAiConversationMessage.js';

/**
 * Options for a non-streaming AI query submitted through
 * {@link IAiAssistantService.query}.
 *
 * Only `prompt` is required. Omitted parameters resolve from the
 * AI Assistant's stored config so external consumers do not need to
 * know the admin's API key, model preference, or token budgets.
 *
 * @example
 * ```typescript
 * // Minimal — uses all configured defaults
 * const result = await ai.query({ prompt: 'Summarize recent transactions' });
 *
 * // Override specific parameters
 * const result = await ai.query({
 *     prompt: 'Analyze {%system-status%}',
 *     maxTokens: 8192,
 *     thinkingBudget: 4000,
 *     includeTools: false
 * });
 * ```
 */
export interface IAiQueryOptions {
    /** The user's natural language prompt. Required. */
    prompt: string;

    /**
     * Prior conversation turns for multi-turn (chat) queries. When present,
     * the AI Assistant seeds Claude's Messages request with these turns
     * before appending `prompt` as the newest user turn — giving the model
     * the full thread for context. Omit for one-shot queries (the default);
     * the result is identical to passing an empty array.
     *
     * Turns are sent verbatim and are NOT template-expanded — only `prompt`
     * and the system prompt resolve `{%variable%}` patterns, so a transcript
     * stays a literal record of what was already said.
     */
    messages?: IAiConversationMessage[];

    /**
     * Optional conversation grouping id. Persisted on the query history
     * record so every turn of one chat shares an id and can be grouped in
     * the history view. Omit for one-shot queries.
     */
    conversationId?: string;

    /** Override the system prompt. Falls back to configured default. */
    systemPrompt?: string;

    /** Override the Anthropic API key. Falls back to configured default. */
    apiKey?: string;

    /** Override the Claude model identifier. Falls back to configured default. */
    model?: string;

    /** Override maximum output tokens. Falls back to configured default. */
    maxTokens?: number;

    /**
     * Override the query timeout in milliseconds. Falls back to the
     * AI Assistant's configured `timeoutMs`. Enforced via
     * AbortController on the underlying HTTP request.
     */
    timeoutMs?: number;

    /** Override extended thinking budget. 0 disables thinking. Falls back to configured default. */
    thinkingBudget?: number;

    /** Override maximum tool-use round-trips (1-50). Falls back to configured default. */
    maxToolRounds?: number;

    /** Override 1M context window flag. Falls back to configured default. */
    extendedContext?: boolean;

    /** Whether to include thinking blocks in the final response text. Falls back to configured default. */
    persistThinking?: boolean;

    /** Execution mode for history tracking. Default: 'programmatic'. Use 'stream' for admin UI queries. */
    mode?: 'stream' | 'programmatic';

    /** Whether to expand {%variable%} template patterns in the prompt. Default: true. */
    expandVariables?: boolean;

    /** Whether to include registered (enabled) tools in the request. Default: true. */
    includeTools?: boolean;

    /** Additional one-off tools to include alongside registered tools for this query only. */
    additionalTools?: IAiTool[];

    /**
     * Client-generated UUID for WebSocket streaming. When provided,
     * text deltas and completion events are emitted to this room so
     * a subscribed client can display the response in real time.
     * When omitted, the query runs silently with no WebSocket output.
     */
    queryId?: string;
}
