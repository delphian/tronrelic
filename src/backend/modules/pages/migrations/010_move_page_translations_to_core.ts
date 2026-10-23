import type { IMigration, IMigrationContext } from '@/types';

/** The collection page translations were stored in as `core:page-translation` managed content. */
const OLD_TRANSLATIONS = 'module_pages_translations';

/** The collection page translation values are stored in now. */
const NEW_VALUES = 'module_pages_translation_values';

/** Core's state collection for translations of every content type. */
const CORE_STATES = 'content_translations';

/** Core's settings collection for translation suggestions. */
const CORE_SETTINGS = 'content_translation_settings';

/** The retired managed content type the old translations were registered as. */
const OLD_TYPE_ID = 'core:page-translation';

/** The managed content type a page translation belongs to now. */
const PAGE_TYPE_ID = 'core:page';

/** The actor recorded on anything this migration decides. */
const MIGRATION_ACTOR_ID = 'system:migration';

/** Matches the frontmatter block at the top of a page's markdown. */
const FRONTMATTER_PATTERN = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;

/**
 * Move page translations from the pages module's own managed content type to
 * the core content translation service.
 *
 * **Why this migration exists:**
 * Page translations were their own managed content type, `core:page-translation`,
 * with review, two versions, and a frontmatter document per translation, all
 * built inside the pages module. Translation is now a core capability every
 * content type shares: core keeps each translation's state in
 * `content_translations`, the pages module keeps only the translated text in
 * `module_pages_translation_values`, and translations are no longer reviewed.
 * Until this runs, the new code finds no translations, so pages are served in
 * English only and no translated address is advertised.
 *
 * **Changes being made:**
 * 1. For each old translation, choose the version visitors were served: the
 *    approved snapshot when the core row says one exists, otherwise the latest
 *    edit if it never entered review. A translation that only ever existed as
 *    a held or rejected edit is moved unpublished, so nothing reaches visitors
 *    that no curator approved.
 * 2. Write its title, description, keywords, body (the markdown without its
 *    frontmatter), and social image to `module_pages_translation_values`.
 * 3. Write its core state row: published, the stored English fingerprint
 *    (computed the same way, so stale flags carry over), audit fields from the
 *    old core row, and soft deletion.
 * 4. Close any queue item still pending for `core:page-translation` as
 *    rejected, because that type no longer exists and the queue could never
 *    decide it. The held edit it carried is dropped; translations are now
 *    written by curators only.
 * 5. Copy the AI translation settings from `page_settings` to
 *    `content_translation_settings` when none are saved there, then remove
 *    them from `page_settings`.
 *
 * The old `module_pages_translations` documents and their `content_items` rows
 * are left in place, so this can be rolled back. Nothing reads them any more.
 *
 * **Safe to re-run:** values and state rows are upserted by page and language,
 * and settings are only copied when the target has none.
 *
 * **Rollback:**
 * ```javascript
 * await db.collection('module_pages_translation_values').drop();
 * await db.collection('content_translations').deleteMany({ typeId: 'core:page' });
 * ```
 * Then deploy the previous image. The AI settings removed from `page_settings`
 * are still in `content_translation_settings` and have to be copied back by hand.
 */
export const migration: IMigration = {
    id: '010_move_page_translations_to_core',
    description:
        'Move page translations from the core:page-translation managed content type to the core content translation ' +
        'service: copy the served text to module_pages_translation_values, write core state rows, close their pending ' +
        'review items, and move the AI translation settings to content_translation_settings.',
    dependencies: ['module:pages:007_adopt_pages_as_managed_content'],

    /**
     * Copy translations, write state rows, close queue items, and move settings.
     *
     * @param context - Migration context carrying the core database.
     */
    async up(context: IMigrationContext): Promise<void> {
        const oldTranslations = context.database.getCollection(OLD_TRANSLATIONS);
        const values = context.database.getCollection(NEW_VALUES);
        const states = context.database.getCollection(CORE_STATES);
        const contentItems = context.database.getCollection('content_items');
        const curations = context.database.getCollection('module_curation_curations');
        const pageSettings = context.database.getCollection('page_settings');
        const settings = context.database.getCollection(CORE_SETTINGS);

        // Steps 1–3.
        const docs = await oldTranslations.find({}).toArray();
        let moved = 0;
        for (const doc of docs) {
            const row = await contentItems.findOne({ id: doc.contentId });
            const servedApproved = row?.hasApprovedVersion === true && doc.approved != null;
            const neverReviewed = row != null && row.curation === undefined;
            const version = servedApproved ? doc.approved : doc;
            const published = (servedApproved || neverReviewed) && version.published === true;
            const now = new Date();

            await values.updateOne(
                { contentId: doc.pageId, language: doc.language },
                {
                    $set: {
                        values: {
                            title: version.title ?? '',
                            description: version.description ?? '',
                            keywords: version.keywords ?? [],
                            body: String(version.content ?? '').replace(FRONTMATTER_PATTERN, ''),
                            ogImage: version.ogImage ?? ''
                        },
                        updatedAt: doc.updatedAt ?? now
                    }
                },
                { upsert: true }
            );

            const deleted = doc.deletedAt != null || row?.deletedAt != null;
            await states.updateOne(
                { contentId: doc.pageId, language: doc.language },
                {
                    $set: {
                        typeId: PAGE_TYPE_ID,
                        published,
                        sourceHash: version.sourceHash ?? '',
                        createdAt: row?.createdAt ?? doc.createdAt ?? now,
                        createdBy: row?.createdBy ?? MIGRATION_ACTOR_ID,
                        updatedAt: row?.updatedAt ?? doc.updatedAt ?? now,
                        updatedBy: row?.updatedBy ?? MIGRATION_ACTOR_ID,
                        ...(deleted
                            ? { deletedAt: doc.deletedAt ?? row?.deletedAt, deletedBy: row?.deletedBy ?? MIGRATION_ACTOR_ID }
                            : {})
                    }
                },
                { upsert: true }
            );
            moved += 1;
        }
        console.log(`[Migration] Moved ${moved} page translations to core`);

        // Step 4.
        const closed = await curations.updateMany(
            { typeId: OLD_TYPE_ID, status: 'pending' },
            { $set: { status: 'rejected', decidedAt: new Date(), decidedBy: MIGRATION_ACTOR_ID } }
        );
        console.log(`[Migration] Closed ${closed.modifiedCount} pending page translation review items`);

        // Step 5.
        const oldSettings = await pageSettings.findOne({});
        const hasCoreSettings = (await settings.countDocuments({ key: 'settings' })) > 0;
        if (oldSettings && !hasCoreSettings) {
            const copied: Record<string, unknown> = { key: 'settings', updatedAt: new Date() };
            if (typeof oldSettings.translationSystemPrompt === 'string') {
                copied.systemPrompt = oldSettings.translationSystemPrompt;
            }
            if (oldSettings.translationProviderId !== undefined) {
                copied.providerId = oldSettings.translationProviderId;
            }
            if (oldSettings.translationModel !== undefined) {
                copied.model = oldSettings.translationModel;
            }
            await settings.insertOne(copied);
            console.log('[Migration] Copied page translation AI settings to content_translation_settings');
        }
        if (oldSettings) {
            await pageSettings.updateOne(
                { _id: oldSettings._id },
                { $unset: { translationSystemPrompt: '', translationProviderId: '', translationModel: '' } }
            );
        }
    }
};
