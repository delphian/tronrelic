/**
 * @file IAiQueryRecord.ts
 *
 * Persisted record of one AI query, provider-neutral and core-owned so the
 * `/system/ai-tools` Query tab keeps its own history independent of any provider
 * plugin. Streaming and programmatic queries only — batch processing is a
 * provider concern and is not represented here.
 */

import type { IAiTranscriptSegment } from './IAiTranscriptSegment.js';

/**
 * How a recorded query was executed. `stream` and `programmatic` are the two
 * interactive shapes an admin drives from the Query tab. `scheduled` marks an
 * autonomous cron run of a saved prompt: the runner still executes it on the
 * provider's `programmatic` transport (so the governor's external-tool
 * default-deny applies), but the history row is tagged `scheduled` so an
 * operator can tell an unattended run apart from one they typed themselves.
 */
export type AiQueryMode = 'stream' | 'programmatic' | 'scheduled';

/**
 * One stored query turn. Turns sharing a `conversationId` form one multi-turn
 * chat and are grouped in the history view.
 */
export interface IAiQueryRecord {
    /** Unique record id. */
    id: string;

    /** Execution mode. */
    mode: AiQueryMode;

    /** The user's prompt for this turn. */
    prompt: string;

    /** The model's response text, or null when the query failed. */
    responseText: string | null;

    /** Model that produced the response. */
    model: string;

    /** Token usage for this turn. */
    usage: {
        inputTokens: number;
        outputTokens: number;
        cacheCreationInputTokens?: number;
        cacheReadInputTokens?: number;
    };

    /**
     * Estimated USD cost of this turn at the time it ran, when the provider
     * priced it. Persisted so a reopened conversation shows the same cost the
     * live stream did, rather than re-deriving it against rates that may have
     * changed since. `null`/absent when the turn could not be priced.
     */
    costUsd?: number | null;

    /** Failure reason when the query failed, else null. */
    errorMessage: string | null;

    /** Terminal status. */
    status: 'completed' | 'failed';

    /** ISO timestamp when the query started. */
    createdAt: string;

    /** ISO timestamp when the query settled. */
    completedAt: string;

    /** Optional id grouping every turn of one multi-turn chat. */
    conversationId?: string;

    /**
     * Ordered transcript of the turn — thinking blocks, visible answer text,
     * tool calls, and tool results in occurrence order — so a reopened
     * conversation replays the whole turn rather than only `responseText`.
     * Absent on records written before this field existed or when the provider
     * reported no structured transcript; the Query tab falls back to
     * `responseText` then. Thinking segments are present only when the operator
     * enabled `persistThinking`.
     */
    transcript?: IAiTranscriptSegment[];
}
