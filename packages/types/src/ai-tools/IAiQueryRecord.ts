/**
 * @file IAiQueryRecord.ts
 *
 * Persisted record of one AI query, provider-neutral and core-owned so the
 * `/system/ai-tools` Query tab keeps its own history independent of any provider
 * plugin. Streaming and programmatic queries only — batch processing is a
 * provider concern and is not represented here.
 */

import type { IAiTranscriptSegment } from './IAiTranscriptSegment.js';
import type { AiStopReason } from './IAiQueryResult.js';

/**
 * What a finished run actually produced. `status` alone cannot answer this: a
 * provider returns a successful result for a run that hit its output token
 * budget, ran out of tool rounds, paused, or was declined, so every one of
 * those used to be stored as `completed` and read on the History tab exactly
 * like a run that answered the question. That is the failure this type exists
 * to end — an autonomous prompt that produced nothing has to be tellable apart
 * from one that worked, both in history and in the logs.
 *
 * - `answered` — the model finished on its own terms and produced text. The
 *   only value that means the run did its job.
 * - `truncated` — the output token budget ran out mid-answer (`max_tokens`).
 *   Raise `maxTokens`, or ask for a shorter answer.
 * - `tool-limit` — the agentic loop used every round it was allowed and the
 *   model still wanted another tool call (`maxToolRounds`). The answer, if any,
 *   is partial.
 * - `paused` — the provider's own long-running turn paused for continuation and
 *   was never resumed (`pause_turn`), usually because the round budget ran out
 *   at the same moment.
 * - `refused` — the model declined the request on safety grounds.
 * - `empty` — the run ended normally but produced no answer text at all. The
 *   quietest failure of the set, and the one that most often means a prompt is
 *   doing all its work through tools and never writing a conclusion.
 * - `failed` — the query threw, so there is no result at all. `errorMessage`
 *   carries the cause.
 */
export type AiQueryOutcome =
    | 'answered'
    | 'truncated'
    | 'tool-limit'
    | 'paused'
    | 'refused'
    | 'empty'
    | 'failed';

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

    /**
     * The user's prompt for this turn, exactly as it was typed or stored, with
     * its `{%name%}` tokens left alone. This stays the raw text because it is
     * the reusable template: saving a past turn back into the prompt library has
     * to capture the template, not one run's values.
     */
    prompt: string;

    /**
     * The same prompt after core resolved its `{%name%}` variables — what the
     * run was asked. Persisted rather than re-derived on demand, because a
     * prompt variable reads live data (a reporting window, a health summary, a
     * chain statistic), so expanding an old record again would show an operator
     * today's values in place of the ones the run was answering about.
     *
     * **A `secret`-classified variable is deliberately left unresolved here**,
     * as its literal `{%name%}` token. The model still receives the real value —
     * the provider expands the request separately, and injecting private data is
     * what a secret variable is for — but this copy is stored, and a stored copy
     * is a different risk from a transmitted one: query history has no retention
     * sweep, so it lives indefinitely, and it is readable both from the
     * admin-session-only history routes and from the `/system/database`
     * collection browser, which the shared service token reaches. Keeping the
     * token in place tells a reader exactly where a secret went without writing
     * the secret down. An operator who does want a particular variable's value
     * recorded reclassifies it below `secret`.
     *
     * This closes the deterministic path only. If a prompt asks the model to
     * repeat a secret back, the answer still lands in {@link responseText}.
     *
     * Absent when expansion changed nothing, and on records written before this
     * field existed. A reader falls back to {@link prompt}.
     */
    expandedPrompt?: string;

    /**
     * The tools this turn was permitted to call, recorded so reopening a
     * conversation can restore the composer to the state the run used. Nothing
     * else preserves it: a transcript shows only the tools the model chose to
     * call, which is a subset of the grant, so without this field an operator
     * continuing an old thread silently starts with no tools at all.
     *
     * Carries the same three states the run itself used. `null` means the run
     * was unrestricted and could reach every enabled tool. `[]` means it was
     * granted none. A list of names means exactly that subset. The field is
     * absent on records written before it existed, which is a fourth case — not
     * "unrestricted" but "unknown" — so a reader must not treat an absent field
     * as `null`.
     *
     * A provider-hosted tool appears here behind the `hosted:` prefix, the same
     * way the run's own allowlist named it.
     */
    toolAllowlist?: string[] | null;

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

    /**
     * Why the run did not produce a clean answer, or null when it did. Carries
     * the thrown error on a `failed` run, and a short plain-English explanation
     * on any other non-`answered` outcome ("output token budget exhausted",
     * "tool-use round limit reached"), so the History tab can say what went
     * wrong without the operator opening the transcript and inferring it.
     */
    errorMessage: string | null;

    /**
     * Terminal status, derived from {@link outcome} rather than from whether a
     * result object came back. `completed` means the model answered.
     * `incomplete` means the query succeeded at the transport level but the run
     * stopped before producing a usable answer — truncated, out of tool rounds,
     * paused, refused, or empty. `failed` means the query threw.
     *
     * Records written before the `incomplete` value existed only ever hold
     * `completed` or `failed`, and a run that would now be `incomplete` is
     * stored as `completed` in those. Read an old row accordingly.
     */
    status: 'completed' | 'incomplete' | 'failed';

    /**
     * The classified outcome behind `status`, which names *which* kind of
     * incomplete run this was. Absent on records written before this field
     * existed; a reader falls back to `status` then.
     */
    outcome?: AiQueryOutcome;

    /**
     * The provider's stop reason for the turn, persisted so the outcome above
     * can be checked against the raw signal it was derived from. Absent when
     * the query threw (there is no turn to have a stop reason) and on records
     * written before this field existed.
     */
    stopReason?: AiStopReason;

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
