/**
 * @fileoverview Physical MongoDB collection names owned by the localization module.
 *
 * Every name carries the `module_localization_` prefix, which is the string the
 * Database tab on `/system/localization` scopes its browser to. Keeping the
 * names in one place means the service, the tests, and that prefix cannot drift
 * apart.
 */

/** Prefix shared by every collection this module owns. */
export const LOCALIZATION_COLLECTION_PREFIX = 'module_localization_';

/** Configured languages, one document per language code. */
export const LANGUAGES_COLLECTION = `${LOCALIZATION_COLLECTION_PREFIX}languages`;

/** Route patterns and the languages each is published in. */
export const ROUTES_COLLECTION = `${LOCALIZATION_COLLECTION_PREFIX}routes`;

/** Translatable keys and their English source text. */
export const KEYS_COLLECTION = `${LOCALIZATION_COLLECTION_PREFIX}keys`;

/** Translated text, one document per namespace, key, and language. */
export const TRANSLATIONS_COLLECTION = `${LOCALIZATION_COLLECTION_PREFIX}translations`;
