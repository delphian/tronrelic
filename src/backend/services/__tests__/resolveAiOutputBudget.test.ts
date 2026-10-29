/// <reference types="vitest" />

/**
 * @fileoverview Tests for turning an output estimate into a request budget:
 * the ceiling comes from the chosen model when the provider reports it, the
 * fallback applies otherwise, and the timeout follows the capped budget.
 */

import { describe, it, expect, vi } from 'vitest';
import type { IAiProvider, IModelInfo } from '@/types';
import { resolveAiOutputBudget, type IAiOutputBudgetPolicy } from '../resolveAiOutputBudget.js';

/** Round numbers so each expected value can be worked out by hand. */
const policy: IAiOutputBudgetPolicy = {
    fallbackOutputLimit: 1000,
    tokensPerSecond: 10,
    timeoutBaseMs: 5_000,
    maxTimeoutMs: 60_000
};

/**
 * Build a provider whose model list resolves with the given models, or
 * rejects when given an error.
 *
 * @param models - The models to report, or the error listing them raises.
 * @returns The provider and its model-list spy.
 */
function providerListing(models: IModelInfo[] | Error): { provider: IAiProvider; listModels: ReturnType<typeof vi.fn> } {
    const listModels = vi.fn(async () => {
        if (models instanceof Error) {
            throw models;
        }
        return models;
    });
    return { provider: { listModels } as unknown as IAiProvider, listModels };
}

describe('resolveAiOutputBudget', () => {
    it('caps the estimate at the chosen model output limit', async () => {
        const { provider } = providerListing([{ id: 'm', display_name: 'M', max_tokens: 300 }]);
        const budget = await resolveAiOutputBudget(provider, 'm', 2500, policy);
        expect(budget).toEqual({ maxTokens: 300, timeoutMs: 35_000, outputLimit: 300, limitSource: 'model' });
    });

    it('sends the whole estimate when it is under the model limit', async () => {
        const { provider } = providerListing([{ id: 'm', display_name: 'M', max_tokens: 300 }]);
        const budget = await resolveAiOutputBudget(provider, 'm', 120.2, policy);
        expect(budget.maxTokens).toBe(121);
        expect(budget.timeoutMs).toBe(5_000 + 12_100);
    });

    it('does not list models for the provider default model', async () => {
        const { provider, listModels } = providerListing([{ id: 'm', display_name: 'M', max_tokens: 300 }]);
        const budget = await resolveAiOutputBudget(provider, undefined, 2500, policy);
        expect(listModels).not.toHaveBeenCalled();
        expect(budget).toEqual({ maxTokens: 1000, timeoutMs: 60_000, outputLimit: 1000, limitSource: 'fallback' });
    });

    it('falls back when the model is not listed or reports no limit', async () => {
        const unlisted = providerListing([{ id: 'other', display_name: 'Other', max_tokens: 300 }]);
        expect((await resolveAiOutputBudget(unlisted.provider, 'm', 2500, policy)).limitSource).toBe('fallback');

        const unlimited = providerListing([{ id: 'm', display_name: 'M' }]);
        expect((await resolveAiOutputBudget(unlimited.provider, 'm', 2500, policy)).limitSource).toBe('fallback');
    });

    it('falls back rather than failing when the model list cannot be fetched', async () => {
        const { provider } = providerListing(new Error('network down'));
        const budget = await resolveAiOutputBudget(provider, 'm', 2500, policy);
        expect(budget).toEqual({ maxTokens: 1000, timeoutMs: 60_000, outputLimit: 1000, limitSource: 'fallback' });
    });

    it('holds the timeout at the policy maximum', async () => {
        const { provider } = providerListing([{ id: 'm', display_name: 'M', max_tokens: 100_000 }]);
        const budget = await resolveAiOutputBudget(provider, 'm', 100_000, policy);
        expect(budget.timeoutMs).toBe(60_000);
    });

    it('never sends a budget below one token', async () => {
        const { provider } = providerListing([]);
        const budget = await resolveAiOutputBudget(provider, 'm', 0, policy);
        expect(budget.maxTokens).toBe(1);
    });
});
