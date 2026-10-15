/**
 * @fileoverview Stored shape of one translation.
 */

/**
 * One document in `module_localization_translations`, unique on
 * `(namespace, key, language)`. The wire form is `ITranslation`.
 */
export interface ITranslationDocument {
    /** `core` or a plugin id. */
    namespace: string;
    /** Key within the namespace. */
    key: string;
    /** Language the text is written in. */
    language: string;
    /** Translated text. */
    text: string;
    /** Last save. */
    updatedAt: Date;
    /** Who saved it last, or null when unknown. */
    updatedBy: string | null;
}
