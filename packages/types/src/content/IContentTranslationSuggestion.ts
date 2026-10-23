/**
 * @file IContentTranslationSuggestion.ts
 *
 * What a translation Suggest request returns. The suggestion is never saved:
 * the editor places the values in its fields and the administrator reviews
 * them before saving, so the result also carries what the model said about
 * its work and what the run cost.
 */

import type { TranslationValues } from './TranslationValues.js';

/**
 * A machine translation of one item into one language, for review.
 */
export interface IContentTranslationSuggestion {
    /**
     * The suggested values, one per declared field. A `url` field is never
     * translated; it carries the existing translation's value, or an empty
     * string when there is none.
     */
    values: TranslationValues;

    /** The model's remarks for the reviewer, such as terms it was unsure of, or null. */
    notes: string | null;

    /** Provider that ran the request. */
    providerId: string;

    /** Model that answered. */
    model: string;

    /** Cost in US dollars as the provider reported it, or null when it could not price the run. */
    costUsd: number | null;

    /** Tokens sent to and received from the model. */
    usage: {
        inputTokens: number;
        outputTokens: number;
    };
}
