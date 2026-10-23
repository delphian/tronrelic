/**
 * @file IContentTranslationKey.ts
 *
 * Names one translation: a content item and a language. An item has at most
 * one translation per language, so the pair identifies it everywhere — in
 * core's state collection, in the author's value store, and in batched reads.
 */

/**
 * The address of one translation.
 */
export interface IContentTranslationKey {
    /** Core content id of the translated item. */
    id: string;

    /** Language code of the translation, such as `zh`. Never the default language. */
    language: string;
}
