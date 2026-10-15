/**
 * @fileoverview A stored translation of one key into one language.
 */

/**
 * The translated text for a `(namespace, key, language)` triple.
 *
 * Translations are prepared ahead of time and served from memory; nothing is
 * translated while a visitor waits. The text may contain the same `{name}`
 * placeholders as the English source, which `interpolateTranslation` fills in
 * at render time.
 */
export interface ITranslation {
    /** Owner of the key: `core`, or a plugin id. */
    namespace: string;

    /** Key within the namespace. */
    key: string;

    /** Language code the text is written in. */
    language: string;

    /** The translated text. */
    text: string;

    /** ISO timestamp of the last save. */
    updatedAt: string;

    /** Who saved it last, for the admin table; a user id or `admin-token`. */
    updatedBy: string | null;
}
