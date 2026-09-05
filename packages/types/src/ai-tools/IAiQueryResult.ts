/**
 * @file IAiQueryResult.ts
 *
 * Result of an AI query executed through {@link IAiProvider.query},
 * {@link IAiProvider.ask}, or {@link IAiProvider.queryStream}.
 */

import type { IAiTranscriptSegment } from './IAiTranscriptSegment.js';

/**
 * Why a model stopped producing output. Named rather than written inline
 * because two types need the same union — the live result a provider returns,
 * and the history record core persists from it. Two inline copies would be free
 * to drift, and a stored record naming a reason the result type no longer knows
 * about is exactly the mismatch that lets an unfinished run read as a finished
 * one.
 *
 * - `end_turn` — model naturally completed
 * - `max_tokens` — hit the output token budget, so the answer is cut off
 * - `stop_sequence` — matched a configured stop sequence
 * - `tool_use` — pausing to invoke a tool, or the tool-use round limit was hit
 * - `pause_turn` — long-running turn paused for continuation
 * - `refusal` — model declined to respond
 */
export type AiStopReason = 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use' | 'pause_turn' | 'refusal';

/**
 * The complete result of a programmatic AI query.
 *
 * Returned by `query()`, `ask()`, and `queryStream()` on `IAiProvider`.
 * Token usage is summed across all tool-use rounds when tools are
 * invoked during the conversation.
 *
 * A returned result means the transport succeeded, **not** that the model
 * answered the question. A run that exhausted its output token budget, ran out
 * of tool rounds, paused, or was declined on safety grounds also returns a
 * result. `stopReason` is what separates those from a real answer, and core
 * classifies it with `classifyAiQueryOutcome` before recording the run.
 */
export interface IAiQueryResult {
    /** The complete text response from the model. */
    responseText: string;

    /** Model that was used for this query. */
    model: string;

    /** Why the response ended. See {@link AiStopReason}. */
    stopReason: AiStopReason;

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

    /**
     * Ordered transcript of the turn — thinking blocks, visible answer text,
     * tool calls, and tool results, in the order they occurred across every
     * agentic round. Lets a surface render and core persist the whole turn, not
     * just `responseText`. Absent when the provider does not report a structured
     * transcript; a consumer falls back to `responseText` in that case.
     */
    transcript?: IAiTranscriptSegment[];
}
