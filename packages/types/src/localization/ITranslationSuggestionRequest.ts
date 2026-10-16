/**
 * @fileoverview Request for machine-suggested translations.
 */

/**
 * The keys an administrator asked the AI model to translate, and the language
 * to translate them into. One key comes from a row's button; several come from
 * the button that fills the visible page.
 */
export interface ITranslationSuggestionRequest {
    /** Target language code. */
    language: string;

    /**
     * Keys to translate, at most `MAX_TRANSLATION_SUGGESTION_KEYS`. They are
     * sent to the model in one request so it can keep terms consistent.
     */
    keys: Array<{ namespace: string; key: string }>;
}
