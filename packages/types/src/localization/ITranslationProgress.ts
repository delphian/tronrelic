/**
 * @fileoverview How far one language's translation has got over a set of keys.
 */

/**
 * Counts of keys in each translation state for one language.
 *
 * The same three numbers describe progress over different sets of keys, such
 * as every key the site has reported or only the keys rendered on routes
 * published in the language, so they share one shape.
 */
export interface ITranslationProgress {
    /** Keys with a translation newer than their English source. */
    translated: number;

    /** Keys whose English source changed after the translation was saved. */
    stale: number;

    /** Keys with no translation in this language. */
    missing: number;
}
