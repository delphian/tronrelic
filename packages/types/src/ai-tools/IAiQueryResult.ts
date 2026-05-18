/**
 * @file IAiQueryResult.ts
 *
 * Result of a non-streaming AI query executed through
 * {@link IAiAssistantService.query} or {@link IAiAssistantService.ask}.
 */

/**
 * The complete result of a programmatic AI query.
 *
 * Returned by both `query()` and `ask()` on `IAiAssistantService`.
 * Token usage is summed across all tool-use rounds when tools are
 * invoked during the conversation.
 */
export interface IAiQueryResult {
    /** The complete text response from the model. */
    responseText: string;

    /** Model that was used for this query. */
    model: string;

    /** Why the response ended: 'end_turn', 'max_tokens', or 'tool_use' (round limit hit). */
    stopReason: string;

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
}
