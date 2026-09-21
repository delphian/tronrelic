/**
 * @file IAiStreamChunk.ts
 *
 * WebSocket payload for a streamed AI response chunk. Provider-neutral and
 * core-owned so any provider plugin and any core surface (e.g. the
 * `/system/ai-tools` Query tab) share one streaming shape. Each chunk is a text
 * delta, a transcript segment that settled mid-turn, a terminal completion
 * signal with usage, or an error notification.
 */

import type { IAiTranscriptSegment } from './IAiTranscriptSegment.js';

/**
 * One streamed chunk of an AI response, correlated to its query by `queryId`.
 */
export interface IAiStreamChunk {
    /** Correlates this chunk with the originating query request. */
    queryId: string;

    /** Discriminator for chunk type. */
    type: 'chunk' | 'segment' | 'done' | 'error';

    /** Partial response text (present when type is 'chunk'). */
    text?: string;

    /**
     * One transcript segment that settled while the turn was still running
     * (present when type is 'segment'). Text streams as `chunk` deltas, but a
     * tool call and its result only exist as whole events, and waiting for the
     * terminal `done` transcript to show them leaves the reader staring at a
     * stalled answer for however long the tool takes. Emitting each segment as
     * it settles lets a surface build the turn's structure live, in the order
     * it happened.
     *
     * These are a live preview, never the record: the `done` transcript stays
     * authoritative and replaces whatever the surface accumulated, so a segment
     * missed or emitted out of order self-corrects when the turn settles.
     */
    segment?: IAiTranscriptSegment;

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

    /**
     * Ordered transcript of the completed turn — thinking, answer text, tool
     * calls, and tool results in occurrence order — present on the terminal
     * 'done' chunk so the live transcript can show the same structure history
     * does without a reload. The streamed text deltas remain the live answer;
     * this is the structured record finalized once the turn settles. Omitted by
     * a provider that does not report a structured transcript.
     */
    transcript?: IAiTranscriptSegment[];

    /**
     * Core's resolution of the prompt's `{%name%}` variables, present on the
     * terminal 'done' chunk when the prompt held any. Sent so a live transcript
     * shows the same expanded text a reopened one does — it is the identical
     * string core persisted on the query record — and so the next turn replays
     * that exact text as prior context rather than a template that would
     * re-resolve against newer data.
     *
     * This is the stored copy, not the request, and differs from it in two
     * ways. A `secret`-classified variable stays as its literal `{%name%}`
     * token, because a kept copy of a secret is a different risk from a
     * transmitted one (see `IAiQueryRecord.expandedPrompt`). And a
     * clock-sensitive variable can differ by the milliseconds between core's
     * resolution and the provider's own. Read it as what the record says the
     * turn was asked, not as a byte-exact copy of what was sent.
     *
     * Omitted when the prompt held no variables, since it would repeat what the
     * surface already has.
     */
    expandedPrompt?: string;
}
