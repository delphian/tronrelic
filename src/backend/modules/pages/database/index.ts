/**
 * Pages module database models and interfaces.
 *
 * File and inventory schemas live in the Files module — see
 * `src/backend/modules/files/database/`.
 */
export type { IPageDocument, IPageVersionDocument } from './IPageDocument.js';
export type { IPageSettingsDocument } from './IPageSettingsDocument.js';
export { DEFAULT_PAGE_SETTINGS } from './IPageSettingsDocument.js';
export type { IPageTranslationDocument, IPageTranslationVersionDocument } from './IPageTranslationDocument.js';
export { PAGE_TRANSLATIONS_COLLECTION, ensurePageTranslationIndexes } from './ensurePageTranslationIndexes.js';
