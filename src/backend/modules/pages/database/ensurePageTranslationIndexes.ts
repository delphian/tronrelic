/**
 * @fileoverview Collection name and indexes for CMS page translations.
 *
 * The translations collection is new, so it has no existing documents a
 * migration would need to adapt. Its indexes are created at boot instead,
 * which means the uniqueness rule below holds from the first write rather than
 * from whenever an operator runs a migration. `createIndex` is a no-op when an
 * identical index already exists, so running this on every boot is safe.
 */

import type { IDatabaseService } from '@/types';

/** Physical collection holding page translations, under the module's prefix. */
export const PAGE_TRANSLATIONS_COLLECTION = 'module_pages_translations';

/**
 * Create the indexes the translation storage relies on.
 *
 * `contentId` is how the core content service addresses a translation.
 * `(pageId, language)` is unique so two saves racing to create the same
 * translation cannot both be stored, and it covers soft-deleted documents so a
 * deleted translation stays reserved for a restore.
 *
 * @param database - Core database service the pages module was given.
 */
export async function ensurePageTranslationIndexes(database: IDatabaseService): Promise<void> {
    await database.createIndex(PAGE_TRANSLATIONS_COLLECTION, { contentId: 1 }, { unique: true });
    await database.createIndex(PAGE_TRANSLATIONS_COLLECTION, { pageId: 1, language: 1 }, { unique: true });

    return;
}
