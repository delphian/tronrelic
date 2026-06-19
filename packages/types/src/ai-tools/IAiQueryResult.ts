/**
 * @file IAiQueryResult.ts
 *
 * Result of an AI query executed through {@link IAiProvider.query},
 * {@link IAiProvider.ask}, or {@link IAiProvider.queryStream}.
 */

/**
 * The complete result of a programmatic AI query.
 *
 * Returned by `query()`, `ask()`, and `queryStream()` on `IAiProvider`.
 * Token usage is summed across all tool-use rounds when tools are
 * invoked during the conversation.
 */
export interface IAiQueryResult {
    /** The complete text response from the model. */
    responseText: string;

    /** Model that was used for this query. */
    model: string;

    /**
     * Why the response ended. Mirrors Anthropic's `StopReason` union:
     * - `end_turn` — model naturally completed
     * - `max_tokens` — hit the output token budget
     * - `stop_sequence` — matched a configured stop sequence
     * - `tool_use` — pausing to invoke a tool (or tool-use round limit hit)
     * - `pause_turn` — long-running turn paused for continuation
     * - `refusal` — model declined to respond
     */
    stopReason: 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use' | 'pause_turn' | 'refusal';

    /** Token usage summed across all tool-use rounds. */
    usage: {
        inputTokens: number;
        outputTokens: number;
        /**
         * Tokens written to Anthropic's prompt cache during this query.
         * Non-zero on the round that first populates the cache. Optional
         * because older records and non-streaming paths may omit it.
         */
        cacheCreationInputTokens?: number;
        /**
         * Tokens served from Anthropic's prompt cache (priced at ~10% of
         * `inputTokens`). Non-zero rounds here are the signal that caching
         * is working on this tool-use loop.
         */
        cacheReadInputTokens?: number;
    };

    /**
     * Estimated USD cost of this query, when the provider can price it. Computed
     * by the provider from its own per-model rates so core stays vendor-neutral
     * and only forwards the figure. `null` when the reported usage has no
     * matching rate; omitted by a provider that does not price queries.
     */
    costUsd?: number | null;
}
