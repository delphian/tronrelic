/**
 * @fileoverview Barrel for the localization module's storage shapes and
 * collection names.
 */

export type { ILanguageDocument } from './ILanguageDocument.js';
export type { ILocalizedRouteDocument } from './ILocalizedRouteDocument.js';
export type { ITranslationKeyDocument } from './ITranslationKeyDocument.js';
export type { ITranslationDocument } from './ITranslationDocument.js';
export {
    LOCALIZATION_COLLECTION_PREFIX,
    LANGUAGES_COLLECTION,
    ROUTES_COLLECTION,
    KEYS_COLLECTION,
    TRANSLATIONS_COLLECTION
} from './localization-collections.js';
export { ensureLocalizationIndexes } from './ensureLocalizationIndexes.js';
