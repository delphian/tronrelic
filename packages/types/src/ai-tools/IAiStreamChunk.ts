/**
 * @file IAiStreamChunk.ts
 *
 * WebSocket payload for a streamed AI response chunk. Provider-neutral and
 * core-owned so any provider plugin and any core surface (e.g. the
 * `/system/ai-tools` Query tab) share one streaming shape. Each chunk is a text
 * delta, a terminal completion signal with usage, or an error notification.
 */

/**
 * One streamed chunk of an AI response, correlated to its query by `queryId`.
 */
export interface IAiStreamChunk {
    /** Correlates this chunk with the originating query request. */
    queryId: string;

    /** Discriminator for chunk type. */
    type: 'chunk' | 'done' | 'error';

    /** Partial response text (present when type is 'chunk'). */
    text?: string;

    /** Error message (present when type is 'error'). */
    error?: string;

    /**
     * Token usage statistics (present when type is 'done').
     *
     * `cacheCreationInputTokens` / `cacheReadInputTokens` are reported when
     * prompt caching is active so the UI can show cache effectiveness
     * alongside the raw input/output counts.
     */
    usage?: {
        inputTokens: number;
        outputTokens: number;
        cacheCreationInputTokens?: number;
        cacheReadInputTokens?: number;
    };

    /**
     * Estimated USD cost of the query, present on the terminal 'done' chunk
     * alongside `usage`. The provider computes it from its own per-model rate
     * card and forwards the number, so core stays vendor-neutral and any
     * surface (the Query tab) can show cost without knowing how a vendor prices.
     * `null` when the provider cannot price the reported usage (no matching
     * rate); omitted entirely by a provider that does not price queries.
     */
    costUsd?: number | null;
}
