/**
 * @file classify-query-outcome.test.ts
 *
 * Tests for classifyAiQueryOutcome, the function that decides whether a settled
 * AI run actually answered.
 *
 * The behaviour under test is a distinction the code did not previously draw: a
 * provider returns an ordinary result for a run that was truncated, ran out of
 * tool rounds, paused, was refused, or produced nothing, and all five used to be
 * recorded as `completed`. These cases pin each one to its own outcome so a
 * regression cannot quietly fold them back into "success".
 */
import { describe, it, expect } from 'vitest';
import type { AiStopReason, IAiQueryResult } from '@/types';
import { classifyAiQueryOutcome } from '../services/classify-query-outcome.js';

/**
 * Build a provider result with the stop reason and answer text a case needs.
 * Everything else is filled with plausible defaults so each test states only
 * the two fields the classifier actually reads.
 *
 * @param stopReason - Why the model stopped, which is the primary signal.
 * @param responseText - The answer text, which decides the `end_turn` case.
 * @returns A result shaped like one a provider would return.
 */
function makeResult(stopReason: AiStopReason, responseText = 'an answer'): IAiQueryResult {
    return {
        responseText,
        model: 'test-model',
        stopReason,
        usage: { inputTokens: 10, outputTokens: 20 }
    };
}

describe('classifyAiQueryOutcome', () => {
    it('treats a natural ending with text as the only successful outcome', () => {
        const assessment = classifyAiQueryOutcome(makeResult('end_turn'), null);

        expect(assessment).toMatchObject({
            outcome: 'answered',
            status: 'completed',
            detail: null,
            succeeded: true
        });
    });

    it('treats a stop sequence with text as answered', () => {
        expect(classifyAiQueryOutcome(makeResult('stop_sequence'), null).succeeded).toBe(true);
    });

    it('reports a natural ending with no text as empty rather than completed', () => {
        // The quiet failure this whole classifier exists for: nothing threw,
        // nothing is wrong with the transport, and the run produced nothing.
        const assessment = classifyAiQueryOutcome(makeResult('end_turn', '   '), null);

        expect(assessment.outcome).toBe('empty');
        expect(assessment.status).toBe('incomplete');
        expect(assessment.succeeded).toBe(false);
        expect(assessment.detail).toBeTruthy();
    });

    it.each([
        ['max_tokens', 'truncated'],
        ['tool_use', 'tool-limit'],
        ['pause_turn', 'paused'],
        ['refusal', 'refused']
    ] as Array<[AiStopReason, string]>)(
        'classifies stop reason %s as %s and marks it incomplete',
        (stopReason, expectedOutcome) => {
            // Text is present in every one of these, which is the point: a
            // partial answer must not be enough to read as a finished run.
            const assessment = classifyAiQueryOutcome(makeResult(stopReason, 'partial text'), null);

            expect(assessment.outcome).toBe(expectedOutcome);
            expect(assessment.status).toBe('incomplete');
            expect(assessment.succeeded).toBe(false);
            expect(assessment.detail).toBeTruthy();
        }
    );

    it('classifies a thrown query as failed and passes the cause through untouched', () => {
        const assessment = classifyAiQueryOutcome(null, 'Provider down');

        expect(assessment).toMatchObject({
            outcome: 'failed',
            status: 'failed',
            detail: 'Provider down',
            succeeded: false
        });
    });

    it('still states a reason when a failed run reported no error message', () => {
        expect(classifyAiQueryOutcome(null, null).detail).toBeTruthy();
    });

    it('does not throw on a result missing its response text', () => {
        // The result crosses a plugin boundary, so this function has to survive
        // a provider that omits a field the type declares required — throwing
        // here would lose the history of a query that already succeeded.
        const sparse = { model: 'test-model', stopReason: 'end_turn', usage: { inputTokens: 0, outputTokens: 0 } } as unknown as IAiQueryResult;

        expect(classifyAiQueryOutcome(sparse, null).outcome).toBe('empty');
    });
});
