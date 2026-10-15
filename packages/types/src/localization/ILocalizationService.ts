/**
 * @fileoverview The read-only localization contract published as `'localization'`.
 */

import type { ILocalizationPublicConfig } from './ILocalizationPublicConfig.js';
import type { ITranslationCatalog } from './ITranslationCatalog.js';
import type { TranslationParams } from './TranslationParams.js';

/**
 * What a module or plugin backend may ask of the localization module.
 *
 * Backend code needs this when it produces visitor-facing text itself, such as
 * a notification body, and wants it in the visitor's language. Management of
 * languages, routes, and translations stays behind the admin API and is not
 * part of this contract.
 */
export interface ILocalizationService {
    /**
     * Read the snapshot of enabled languages and published routes.
     *
     * @returns The same document `GET /api/localization/config` serves.
     */
    getPublicConfig(): Promise<ILocalizationPublicConfig>;

    /**
     * Read every stored translation for a language.
     *
     * @param language - Language code to load.
     * @returns The catalog, empty for the default language or an unknown code.
     */
    getCatalog(language: string): Promise<ITranslationCatalog>;

    /**
     * Translate one key, falling back to the English text.
     *
     * @param namespace - Owner of the key, `core` or a plugin id.
     * @param key - Key within the namespace.
     * @param language - Language to translate into.
     * @param fallback - English text returned when no translation exists.
     * @param params - Values for `{name}` placeholders.
     * @returns The text to show, with placeholders filled.
     */
    translate(namespace: string, key: string, language: string, fallback: string, params?: TranslationParams): Promise<string>;

    /**
     * List the enabled languages a path is published in.
     *
     * @param path - Unprefixed path such as `/markets`.
     * @returns Language codes, excluding the default language.
     */
    getLanguagesForPath(path: string): Promise<string[]>;
}
