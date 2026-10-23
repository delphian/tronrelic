import type { IMigration, IMigrationContext } from '@/types';

/** The collection page translations lived in as `core:page-translation` managed content. */
const OLD_TRANSLATIONS = 'module_pages_translations';

/** The collection migration 010 copied the translated text into. */
const NEW_VALUES = 'module_pages_translation_values';

/** Core's state collection, where migration 010 wrote each translation's state. */
const CORE_STATES = 'content_translations';

/** The retired managed content type whose core rows this removes. */
const OLD_TYPE_ID = 'core:page-translation';

/**
 * Remove the page translation data migration 010 left behind for rollback.
 *
 * **Why this migration exists:**
 * Migration 010 moved page translations to the core content translation
 * service and deliberately left the old copies in place, so the move could be
 * rolled back by redeploying the previous image. Nothing reads them any more.
 * Run this once the site has been running on the new translations long enough
 * to be confident a rollback will not be needed. It is not part of any
 * deploy: it waits on `/system/database` until an operator chooses to run it.
 *
 * **Changes being made:**
 * 1. Check that every document in `module_pages_translations` has both its
 *    state row in `content_translations` and its text in
 *    `module_pages_translation_values`. If any is missing, stop and change
 *    nothing, naming each one, because deleting it would lose a translation.
 * 2. Delete the `core:page-translation` rows from `content_items`.
 * 3. Delete every document in `module_pages_translations`, then drop the
 *    collection. MongoDB refuses to drop a collection inside a transaction,
 *    so on a replica set the empty collection stays; it holds nothing and can
 *    be dropped by hand.
 *
 * Review items the old type left in `module_curation_curations` are kept: they
 * are decided history, and migration 010 closed any that were still pending.
 *
 * **Safe to re-run:** a second run finds nothing to check and nothing to delete.
 *
 * **Rollback:** none. The data is gone, and the previous image cannot run
 * without it. Restore from a backup taken before running this if needed.
 */
export const migration: IMigration = {
    id: '011_remove_legacy_page_translations',
    description:
        'Remove the core:page-translation data migration 010 kept for rollback: the module_pages_translations ' +
        'collection and its content_items rows. Refuses to delete anything unless every old translation was moved. ' +
        'Run only once you are sure a rollback to the pre-010 image will not be needed.',
    dependencies: ['module:pages:010_move_page_translations_to_core'],

    /**
     * Verify the move, then delete the legacy rows and collection.
     *
     * @param context - Migration context carrying the core database.
     * @throws Error naming every old translation that was not moved, before
     *   anything is deleted.
     */
    async up(context: IMigrationContext): Promise<void> {
        const oldTranslations = context.database.getCollection(OLD_TRANSLATIONS);
        const values = context.database.getCollection(NEW_VALUES);
        const states = context.database.getCollection(CORE_STATES);
        const contentItems = context.database.getCollection('content_items');

        // Step 1: every old translation must already exist in both new places.
        const docs = await oldTranslations.find({}).toArray();
        const missing: string[] = [];
        for (const doc of docs) {
            const key = { contentId: doc.pageId, language: doc.language };
            const [state, value] = await Promise.all([states.findOne(key), values.findOne(key)]);
            if (!state || !value) {
                missing.push(`page ${String(doc.pageId)} (${String(doc.language)})`);
            }
        }
        if (missing.length > 0) {
            throw new Error(
                `Refusing to remove legacy page translations: ${missing.length} were not moved by migration 010 ` +
                `(${missing.join(', ')}). Re-run module:pages:010_move_page_translations_to_core first.`
            );
        }

        // Step 2.
        const rows = await contentItems.deleteMany({ typeId: OLD_TYPE_ID });
        console.log(`[Migration] Deleted ${rows.deletedCount} ${OLD_TYPE_ID} rows from content_items`);

        // Step 3.
        const removed = await oldTranslations.deleteMany({});
        console.log(`[Migration] Deleted ${removed.deletedCount} documents from ${OLD_TRANSLATIONS}`);
        try {
            await oldTranslations.drop();
            console.log(`[Migration] Dropped ${OLD_TRANSLATIONS}`);
        } catch (error) {
            console.log(
                `[Migration] Left the empty ${OLD_TRANSLATIONS} collection in place: ` +
                `${error instanceof Error ? error.message : String(error)}`
            );
        }
    }
};
