/**
 * @file IPageTranslationSuggestionResult.ts
 *
 * What a page translation Suggest request returns. The suggestion is never
 * saved: the editor places `content` in the translation pane and the
 * administrator reviews it before saving, so the result also carries what
 * the model said about its work and what the run cost.
 */

/**
 * A machine translation of one CMS page into one language, for review.
 */
export interface IPageTranslationSuggestionResult {
    /**
     * The suggested translation as markdown with frontmatter, ready for the
     * editor. `published` and `ogImage` are carried over from the existing
     * translation, or default to unpublished, so a suggestion never puts a
     * page live by itself.
     */
    content: string;

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
