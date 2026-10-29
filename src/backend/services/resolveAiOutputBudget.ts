/**
 * @fileoverview Turn an estimate of how much a model will write into the
 * `maxTokens` and `timeoutMs` a one-shot AI request should send.
 *
 * A feature that asks a model to transform site content knows roughly how long
 * the answer will be, but two other limits bound the request. The chosen model
 * has a hard output ceiling, and a request that may write for a long time needs
 * a timeout that will not cut it off first. Hardcoding either one in the
 * feature goes stale: a fixed ceiling overrides whatever model the
 * administrator picked, and a fixed timeout cannot drain a larger budget. This
 * helper resolves both from the model the request will actually run on.
 *
 * @module backend/services/resolveAiOutputBudget
 */

import type { IAiProvider } from '@/types';

/** The limits a caller applies to the budget. */
export interface IAiOutputBudgetPolicy {
    /**
     * Output ceiling used when the model's own limit cannot be read: the
     * provider's default model is in use, the model is missing from the
     * provider's list, or the list could not be fetched. Keep it at a value
     * every supported model accepts.
     */
    fallbackOutputLimit: number;
    /**
     * Output tokens per second the timeout is sized from. Choose a rate below
     * what the slowest supported model streams at, so the timeout errs long.
     */
    tokensPerSecond: number;
    /** Time allowed before the first output token, covering queueing and reasoning. */
    timeoutBaseMs: number;
    /** Longest timeout a request may be given, whatever its budget. */
    maxTimeoutMs: number;
}

/** What the request should send, and where its ceiling came from. */
export interface IAiOutputBudget {
    /** Output tokens to allow: the estimate, capped at the ceiling. */
    maxTokens: number;
    /** How long the request may run before it is abandoned. */
    timeoutMs: number;
    /** The ceiling applied to the estimate. */
    outputLimit: number;
    /** Whether the ceiling is the model's own limit or the policy's fallback. */
    limitSource: 'model' | 'fallback';
}

/**
 * The policy TronRelic's own one-shot requests share. The fallback ceiling is
 * a value every supported model accepts. The streaming rate sits below what
 * the slowest supported model produces, so the timeout errs long, on top of
 * a fixed allowance for the model to begin writing. The maximum is the
 * longest timeout the provider honours.
 */
export const DEFAULT_AI_OUTPUT_BUDGET_POLICY: IAiOutputBudgetPolicy = {
    fallbackOutputLimit: 16_000,
    tokensPerSecond: 40,
    timeoutBaseMs: 30_000,
    maxTimeoutMs: 600_000
};

/**
 * Look up a model's output limit from the provider's model list.
 *
 * The provider's list is the only provider-neutral source of a model's
 * ceiling, and the Anthropic provider caches it, so asking per request is
 * cheap. A failed fetch is reported as unknown rather than thrown, because a
 * request can still run on the fallback ceiling and the caller should not fail
 * just because the model list is unreachable.
 *
 * @param provider - The provider the request will run on.
 * @param model - Model id, or undefined when the provider's default model is
 *   used. The default's id is not known to core, so its limit is unknown too.
 * @returns The model's output limit, or undefined when it cannot be read.
 */
async function readModelOutputLimit(provider: IAiProvider, model: string | undefined): Promise<number | undefined> {
    let limit: number | undefined;
    if (model !== undefined) {
        try {
            const models = await provider.listModels();
            const match = models.find((entry) => entry.id === model);
            if (match && typeof match.max_tokens === 'number' && match.max_tokens > 0) {
                limit = match.max_tokens;
            }
        } catch {
            limit = undefined;
        }
    }

    return limit;
}

/**
 * Resolve the output budget and timeout for a one-shot request.
 *
 * The ceiling is the chosen model's output limit when the provider can report
 * it, and the policy's fallback otherwise. The timeout is sized to the budget
 * that will actually be sent: a fixed allowance for the model to start writing
 * plus the time to stream the whole budget at the policy's rate, held under
 * the policy's maximum. Sizing it to the capped budget rather than the raw
 * estimate keeps a small request from waiting ten minutes on a model that has
 * already stopped.
 *
 * @param provider - The provider the request will run on.
 * @param model - Model id, or undefined for the provider's default model.
 * @param estimatedTokens - How many output tokens the caller expects to need.
 * @param policy - The caller's fallback ceiling and timeout rules.
 * @returns The `maxTokens` and `timeoutMs` to send, with the ceiling applied.
 */
export async function resolveAiOutputBudget(
    provider: IAiProvider,
    model: string | undefined,
    estimatedTokens: number,
    policy: IAiOutputBudgetPolicy
): Promise<IAiOutputBudget> {
    const modelLimit = await readModelOutputLimit(provider, model);
    const outputLimit = modelLimit ?? policy.fallbackOutputLimit;
    const maxTokens = Math.max(1, Math.min(Math.ceil(estimatedTokens), outputLimit));
    const streamingMs = Math.ceil((maxTokens / policy.tokensPerSecond) * 1000);
    const timeoutMs = Math.min(policy.maxTimeoutMs, policy.timeoutBaseMs + streamingMs);

    return {
        maxTokens,
        timeoutMs,
        outputLimit,
        limitSource: modelLimit === undefined ? 'fallback' : 'model'
    };
}
