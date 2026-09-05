/**
 * @file classify-query-outcome.ts
 *
 * Decides what an AI run actually produced, so a run that answered the question
 * can be told apart from one that merely returned without throwing.
 *
 * The problem this solves: a provider returns a perfectly ordinary
 * `IAiQueryResult` for a run that exhausted its output token budget, used up
 * every agentic tool round, paused mid-turn, was declined on safety grounds, or
 * produced no text at all. Nothing about that object says the run fell short, so
 * every path that recorded history stored it as `completed` and no log line was
 * written at all. An operator watching a cron-scheduled prompt then saw a
 * conversation with a back-and-forth in it that simply stopped, with nothing
 * anywhere to explain why.
 *
 * Classification lives here, in one pure function with no I/O, so the
 * interactive query controller, the cron runner, the hook-trigger worker, and
 * the manual run-now path all reach the same verdict for the same run. It is
 * deliberately provider-neutral: it reads only the vendor-neutral
 * `IAiQueryResult` contract, so swapping the AI provider plugin changes nothing
 * here.
 */

import type { AiQueryOutcome, IAiQueryRecord, IAiQueryResult } from '@/types';

/** The verdict {@link classifyAiQueryOutcome} reaches about one settled run. */
export interface IAiQueryOutcomeAssessment {
    /** Which kind of ending this was. See `AiQueryOutcome`. */
    outcome: AiQueryOutcome;

    /**
     * The terminal status to persist, derived from `outcome` here rather than by
     * each caller, so a stored status and a stored outcome can never disagree.
     */
    status: IAiQueryRecord['status'];

    /**
     * Plain-English reason the run did not answer, or null when it did. Written
     * for an operator reading the History tab or a log line, so it names the
     * setting to change rather than restating the stop reason.
     */
    detail: string | null;

    /**
     * Whether this outcome means the run did its job. Callers branch on this
     * instead of comparing outcome strings, so adding a new non-answering
     * outcome later cannot quietly start counting as a success somewhere.
     */
    succeeded: boolean;
}

/**
 * Classify one settled AI run into an outcome, a terminal status, and an
 * operator-facing reason.
 *
 * Pure and total: every combination of result and error produces a verdict, and
 * nothing here throws, because it runs on the recording path of a query that has
 * already finished and must never itself be the reason a run's history goes
 * missing.
 *
 * @param result - The provider's result, or null when the query threw. A
 *        non-null result means the transport worked, not that the model
 *        answered — which is the whole reason this function exists.
 * @param errorMessage - The thrown error's message when the query failed, so a
 *        failed run's `detail` carries the real cause instead of a generic
 *        sentence. Null on any run that returned a result.
 * @returns The verdict every recording and logging path shares.
 */
export function classifyAiQueryOutcome(
    result: IAiQueryResult | null,
    errorMessage: string | null
): IAiQueryOutcomeAssessment {
    let outcome: AiQueryOutcome;
    let detail: string | null;

    if (!result) {
        // No result at all: the query threw, was aborted, or ran past its
        // deadline. The caller already holds the cause, so pass it straight
        // through rather than paraphrasing it into something less specific.
        outcome = 'failed';
        detail = errorMessage ?? 'The query failed without reporting a reason.';
    } else {
        switch (result.stopReason) {
            case 'max_tokens':
                outcome = 'truncated';
                detail = 'The model hit its output token budget before finishing. Raise maxTokens, or ask for a shorter answer.';
                break;
            case 'tool_use':
                // A provider's agentic loop only surfaces this as the final stop
                // reason when it ran out of rounds while the model still wanted
                // another tool call. A model that pauses to call a tool
                // mid-run does not end the run there.
                outcome = 'tool-limit';
                detail = 'The model used every tool round it was allowed and still wanted another. Raise maxToolRounds, or narrow the prompt.';
                break;
            case 'pause_turn':
                outcome = 'paused';
                detail = 'A long-running provider-side turn paused for continuation and was never resumed, so the run has no final answer.';
                break;
            case 'refusal':
                outcome = 'refused';
                detail = 'The model declined this request on safety grounds.';
                break;
            default:
                // `end_turn` and `stop_sequence` are the two endings the model
                // chose for itself, so they are the only candidates for a real
                // answer — and only when there is text to show for it. A blank
                // answer here is the quietest failure of the set, which is
                // exactly why it gets its own outcome instead of passing as a
                // success with nothing in it.
                //
                // `responseText` is typed as required, but this reads it
                // defensively because the value crosses a plugin boundary: a
                // provider that omits it would otherwise make this function
                // throw on the recording path of a query that already
                // succeeded, and lose the run's history entirely.
                if (typeof result.responseText === 'string' && result.responseText.trim().length > 0) {
                    outcome = 'answered';
                    detail = null;
                } else {
                    outcome = 'empty';
                    detail = 'The run ended normally but produced no answer text. The prompt may be doing all its work through tools without ever writing a conclusion.';
                }
                break;
        }
    }

    const status: IAiQueryRecord['status'] = outcome === 'answered'
        ? 'completed'
        : outcome === 'failed'
            ? 'failed'
            : 'incomplete';

    return {
        outcome,
        status,
        detail,
        succeeded: outcome === 'answered'
    };
}
