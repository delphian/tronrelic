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
 * @returns The provider's result, known to hold a finished answer.
 * @throws The error `providerError` builds.
 */
export async function runIsolatedAiQuery(
    provider: IAiProvider,
    options: IIsolatedAiQueryOptions,
    providerError: (message: string) => Error
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
            `The AI provider could not complete the request: ${error instanceof Error ? error.message : String(error)}`
        );
    }

    if (result.stopReason === 'refusal') {
        throw providerError(options.refusalMessage);
    }
    if (result.stopReason === 'max_tokens') {
        throw providerError(options.maxTokensMessage);
    }
    if (result.stopReason !== 'end_turn' && result.stopReason !== 'stop_sequence') {
        throw providerError(
            `The model stopped before finishing its answer (${result.stopReason}). Try again, or choose a different model on ${options.settingsLocation}.`
        );
    }

    return result;
}
