/**
 * @fileoverview Collection holding the translated text of CMS pages.
 *
 * The values live here, in the pages module's own storage, and core keeps the
 * state of each translation in its `content_translations` collection. The
 * documents have the shape `ITranslationValueDocument` from the core
 * translation store: `contentId` (the page), `language`, `values`, and
 * `updatedAt`, unique on content id and language.
 */

/** Physical collection holding page translation values, under the module's prefix. */
export const PAGE_TRANSLATION_VALUES_COLLECTION = 'module_pages_translation_values';
