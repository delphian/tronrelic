/**
 * @fileoverview A namespace and how many keys it holds.
 */

/**
 * Feeds the namespace filter on the Translations tab, so an administrator can
 * work through one plugin's text at a time.
 */
export interface ITranslationNamespaceSummary {
    /** `core` or a plugin id. */
    namespace: string;

    /** Number of known keys in the namespace. */
    keys: number;
}
