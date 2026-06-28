/**
 * @file IAiTranscriptSegment.ts
 *
 * Ordered, replayable record of everything an AI turn produced — not just its
 * final answer text. A query history record that stores only `responseText`
 * cannot reconstruct what the model reasoned about or which tools it called, so
 * a reopened conversation loses the thinking blocks, tool calls, and tool
 * results that were visible while it ran. This segment union is the missing
 * structure: the provider emits the segments in the exact order they occurred
 * across every agentic round, core persists them on the query record, and the
 * Query tab renders them back so history shows the full turn, not a summary.
 *
 * Provider-neutral by design: the segments describe what happened in
 * vendor-agnostic terms (think / speak / call a tool / receive a result) so any
 * AI provider plugin populates the same shape and any surface renders it
 * identically.
 */

/**
 * The model's private reasoning for a turn. Present only when extended thinking
 * is enabled and the operator opted into persisting it (`persistThinking`), so
 * an operator who has chosen not to retain reasoning never finds it stored.
 */
export interface IAiThinkingSegment {
    type: 'thinking';

    /** The reasoning text, concatenated for one thinking block. */
    text: string;
}

/**
 * A run of the model's visible answer text. A turn yields one text segment per
 * round that produced prose; tool calls between rounds split the answer into
 * separate text segments, preserving the real interleaving of speech and action.
 */
export interface IAiTextSegment {
    type: 'text';

    /** The answer text for this run, as Markdown. */
    text: string;
}

/**
 * A tool the model invoked during the turn. Captures the call as the model made
 * it — the tool name and the arguments — so history shows what the model tried,
 * paired by `id` with the {@link IAiToolResultSegment} that answered it.
 */
export interface IAiToolUseSegment {
    type: 'tool_use';

    /** Provider tool-call id, matched against a tool_result's `toolUseId`. */
    id: string;

    /** The invoked tool's name. */
    name: string;

    /** The arguments the model supplied to the tool. */
    input: unknown;

    /**
     * True when the tool ran on the provider's own infrastructure (e.g.
     * Anthropic web search / fetch) rather than through the platform governor,
     * so the UI can label a provider-hosted call distinctly.
     */
    server?: boolean;
}

/**
 * The outcome of a tool call, paired to its {@link IAiToolUseSegment} by
 * `toolUseId`. Stores the result the model was handed so history can show what
 * came back, including whether the call failed.
 */
export interface IAiToolResultSegment {
    type: 'tool_result';

    /** The `id` of the tool_use this result answers. */
    toolUseId: string;

    /** The tool's returned content, or a digest of it for a provider-hosted call. */
    content: string;

    /** True when the tool reported an error rather than a successful result. */
    isError?: boolean;

    /** True when this answered a provider-hosted (server-side) tool call. */
    server?: boolean;
}

/**
 * One ordered piece of an AI turn's transcript. The full transcript is an array
 * of these in occurrence order, spanning every agentic round of the turn.
 */
export type IAiTranscriptSegment =
    | IAiThinkingSegment
    | IAiTextSegment
    | IAiToolUseSegment
    | IAiToolResultSegment;
