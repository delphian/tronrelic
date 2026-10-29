/**
 * @fileoverview Send a one-shot AI request whose text comes from content, and
 * accept only a finished answer.
 *
 * Admin features that ask a model to transform site content, such as
 * translating interface strings or a CMS page, share two needs. The request
 * must run isolated: the text being transformed comes from the site, plugins,
 * or page authors, so it must not be able to invoke a tool or pull a stored
 * `{%variable%}` into the prompt. And only an answer the model finished may be
 * used, because a refusal or a reply cut off by the token limit can still parse
 * as JSON and fill an editor with half an answer. This helper does both, once.
 *
 * @module backend/services/runIsolatedAiQuery
 */

import type { IAiProvider, IAiQueryResult } from '@/types';

/** What the caller sends and how its refusals read. */
export interface IIsolatedAiQueryOptions {
    /** The user prompt. */
    prompt: string;
    /** The administrator's system prompt. */
    systemPrompt: string;
    /** Model id, or undefined for the provider's default. */
    model: string | undefined;
    /** Output token budget. */
    maxTokens: number;
    /** How long the request may take before it is abandoned. */
    timeoutMs: number;
    /** Shown when the model refuses, such as `The model declined to translate this page.` */
    refusalMessage: string;
    /** Shown when the reply hits the token limit; says what the administrator can change. */
    maxTokensMessage: string;
    /** Where the administrator picks a different model, such as `the Settings tab`. */
    settingsLocation: string;
}

/**
 * What is known about a request that produced no usable answer, for the
 * caller's log. Flat fields rather than the nested result, so a log query can
 * filter on any one of them directly.
 *
 * A reply cut off by the token limit is the case these exist for. Reading
 * `outputTokens` against the budget that was sent, next to `responseLength`,
 * shows whether the model wrote up to the limit or spent the budget before
 * writing much at all, which is the difference between a budget that is too
 * small and a model that reasons at length before answering.
 */
export interface IIsolatedAiQueryFailure {
    /** Why the model stopped, when the request completed. */
    stopReason?: IAiQueryResult['stopReason'];
    /** The model that answered, when the request completed. */
    model?: string;
    /** Prompt tokens the request consumed, when it completed. */
    inputTokens?: number;
    /** Output tokens the model produced, reasoning included, when the request completed. */
    outputTokens?: number;
    /** Characters of visible answer text the model produced. */
    responseLength?: number;
    /**
     * Characters of reasoning in the provider's transcript. Undefined when the
     * provider reported no transcript, which does not mean the model did not
     * reason: a provider only includes reasoning when it is set to keep it.
     */
    thinkingLength?: number;
    /** The transport error, when the request never completed. */
    error?: unknown;
}

/**
 * Describe a completed request whose answer cannot be used.
 *
 * @param result - The provider's result.
 * @returns The flat failure details the caller logs.
 */
function describeFailure(result: IAiQueryResult): IIsolatedAiQueryFailure {
    const failure: IIsolatedAiQueryFailure = {
        stopReason: result.stopReason,
        model: result.model,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        responseLength: result.responseText.length
    };
    if (result.transcript) {
        failure.thinkingLength = result.transcript.reduce(
            (total, segment) => total + (segment.type === 'thinking' ? segment.text.length : 0),
            0
        );
    }

    return failure;
}

/**
 * Run the request with no tools, no variable expansion, and no extended
 * thinking, and check the model actually answered.
 *
 * The stop reason is checked as an allowlist: only `end_turn` and
 * `stop_sequence`, the two endings the model chose for itself, are returned.
 * A refusal and the token limit keep their own wording because an
 * administrator can act on each, and every other reason, including one added
 * to `AiStopReason` later, is reported rather than accepted.
 *
 * @param provider - Provider to call.
 * @param options - Prompt, model, budget, and the refusal wording.
 * @param providerError - Builds the caller's own error type for an unusable
 *   reply or a failed request, so its HTTP layer reports them with its status.
 *   Receives what is known about the failure so the caller can log it.
 * @returns The provider's result, known to hold a finished answer.
 * @throws The error `providerError` builds.
 */
export async function runIsolatedAiQuery(
    provider: IAiProvider,
    options: IIsolatedAiQueryOptions,
    providerError: (message: string, failure: IIsolatedAiQueryFailure) => Error
): Promise<IAiQueryResult> {
    let result: IAiQueryResult;
    try {
        result = await provider.query({
            prompt: options.prompt,
            systemPrompt: options.systemPrompt,
            model: options.model,
            maxTokens: options.maxTokens,
            timeoutMs: options.timeoutMs,
            thinkingBudget: 0,
            toolAllowlist: [],
            expandVariables: false,
            mode: 'programmatic'
        });
    } catch (error) {
        throw providerError(
            `The AI provider could not complete the request: ${error instanceof Error ? error.message : String(error)}`,
            { error }
        );
    }

    if (result.stopReason === 'refusal') {
        throw providerError(options.refusalMessage, describeFailure(result));
    }
    if (result.stopReason === 'max_tokens') {
        throw providerError(options.maxTokensMessage, describeFailure(result));
    }
    if (result.stopReason !== 'end_turn' && result.stopReason !== 'stop_sequence') {
        throw providerError(
            `The model stopped before finishing its answer (${result.stopReason}). Try again, or choose a different model on ${options.settingsLocation}.`,
            describeFailure(result)
        );
    }

    return result;
}
