/**
 * @fileoverview One machine-suggested translation.
 */

/**
 * A translation an AI model proposed for one key. It is only a suggestion: the
 * Translations tab places the text in the key's editor, and nothing is stored
 * until the administrator saves it.
 */
export interface ITranslationSuggestion {
    /** Owner of the key. */
    namespace: string;

    /** Key within the namespace. */
    key: string;

    /** Proposed translated text. */
    text: string;

    /**
     * The model's remark about this key, such as an ambiguity it resolved or a
     * term it was unsure of. Null when it had nothing to say.
     */
    note: string | null;
}
