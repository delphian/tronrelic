/**
 * @fileoverview Outcome of one request for machine-suggested translations.
 */

import type { ITranslationSuggestion } from './ITranslationSuggestion.js';

/**
 * What the model returned for a suggestion request, plus what the run cost.
 * The Translations tab fills its editors from `suggestions` and shows `notes`
 * and the cost to the administrator, so they can judge the text before saving.
 */
export interface ITranslationSuggestionResult {
    /** One entry per requested key the model translated. */
    suggestions: ITranslationSuggestion[];

    /**
     * Requested keys the model returned no usable text for, so the
     * administrator knows which editors were left alone.
     */
    unanswered: Array<{ namespace: string; key: string }>;

    /** The model's general remarks about the batch, or null when it had none. */
    notes: string | null;

    /** Provider that ran the request. */
    providerId: string;

    /** Model that answered. */
    model: string;

    /**
     * Cost in US dollars as reported by the provider. Null when the provider
     * could not price the model it used.
     */
    costUsd: number | null;

    /** Tokens sent to and received from the model. */
    usage: {
        inputTokens: number;
        outputTokens: number;
    };
}
