/**
 * @fileoverview Every translation for one language, ready to serve.
 */

/**
 * The translations a page render looks up, grouped by namespace and key.
 *
 * Served by `GET /api/localization/catalog/:language` and handed to the
 * browser with the page, so the client renders the same text the server did
 * and hydration matches. A key missing from the catalog falls back to the
 * English text supplied in code.
 */
export interface ITranslationCatalog {
    /** Language code the catalog holds. */
    language: string;

    /** Translated text keyed first by namespace, then by key. */
    entries: Record<string, Record<string, string>>;
}
