/**
 * @file IAiQueryRecord.ts
 *
 * Persisted record of one AI query, provider-neutral and core-owned so the
 * `/system/ai-tools` Query tab keeps its own history independent of any provider
 * plugin. Streaming and programmatic queries only — batch processing is a
 * provider concern and is not represented here.
 */

/** How a recorded query was executed. */
export type AiQueryMode = 'stream' | 'programmatic';

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
}
