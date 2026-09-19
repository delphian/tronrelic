import { randomUUID } from 'node:crypto';
import type { IMigration, IMigrationContext } from '@/types';

/** The managed content type every page is adopted into. */
const PAGE_CONTENT_TYPE_ID = 'core:page';

/** The actor recorded on the core rows this migration writes. */
const MIGRATION_ACTOR_ID = 'system:migration';

/**
 * Adopt every existing page as managed content (`core:page`).
 *
 * **Why this migration exists:**
 * Pages are now managed by the core content service: every create, read,
 * update, delete, and restore passes through core, which keeps a row per page
 * in the core `content_items` collection and addresses the page by a
 * core-issued UUID. Pages created before this change have neither, so until
 * this runs they are served by their own `published` flag and cannot be edited.
 *
 * **Changes being made:**
 * 1. Give each page without one a `contentId` (a new UUID) and a `deletedAt:
 *    null` soft-delete marker.
 * 2. Grandfather live content: a page that is published today gets an
 *    `approved` snapshot of its current fields, so it stays live exactly as it
 *    is. An unpublished page gets no snapshot.
 * 3. Write a core `content_items` row per page. Published pages are recorded as
 *    `approved`; unpublished pages get no review state (never submitted).
 * 4. Index `pages.contentId` (unique where present).
 *
 * **Safe to re-run:** each page receives its id in a write conditioned on it
 * having none, and core rows are upserted by id, so a run that stops part-way
 * finishes cleanly on the next attempt without duplicate ids or rows.
 *
 * **Rollback:**
 * ```javascript
 * await db.collection('content_items').deleteMany({ typeId: 'core:page' });
 * await db.collection('pages').updateMany({}, { $unset: { contentId: '', approved: '', deletedAt: '' } });
 * await db.collection('pages').dropIndex('contentId_1');
 * ```
 */
export const migration: IMigration = {
    id: '007_adopt_pages_as_managed_content',
    description:
        'Adopt existing pages as core:page managed content: assign core content ids, snapshot published pages as ' +
        'their approved version, and write the core content_items rows (published pages recorded as approved).',
    dependencies: ['module:pages:003_add_old_slugs_to_pages'],

    /**
     * Assign ids, snapshot published pages, write core rows, and index.
     *
     * @param context - Migration context carrying the core database.
     */
    async up(context: IMigrationContext): Promise<void> {
        const pages = context.database.getCollection('pages');
        const contentItems = context.database.getCollection('content_items');

        // Step 1 + 2: assign ids and snapshots to pages that have none.
        const unadopted = await pages.find({ contentId: { $exists: false } }).toArray();
        let adopted = 0;
        for (const page of unadopted) {
            const published = page.published === true;
            const approved = published
                ? {
                    title: page.title,
                    slug: page.slug,
                    oldSlugs: page.oldSlugs ?? [],
                    content: page.content,
                    description: page.description ?? '',
                    keywords: page.keywords ?? [],
                    published: true,
                    ogImage: page.ogImage ?? null,
                    approvedAt: new Date()
                }
                : null;
            const result = await pages.updateOne(
                { _id: page._id, contentId: { $exists: false } },
                { $set: { contentId: randomUUID(), deletedAt: null, approved } }
            );
            adopted += result.modifiedCount;
        }
        console.log(`[Migration] Assigned content ids to ${adopted} pages`);

        // Step 3: upsert a core row for every adopted page, including pages a
        // previous interrupted run gave an id but no row.
        const managed = await pages.find({ contentId: { $type: 'string' } }).toArray();
        let rows = 0;
        for (const page of managed) {
            const published = page.published === true && page.approved != null;
            const row: Record<string, unknown> = {
                id: page.contentId,
                typeId: PAGE_CONTENT_TYPE_ID,
                providerId: 'pages',
                hasApprovedVersion: published,
                createdAt: page.createdAt ?? new Date(),
                createdBy: MIGRATION_ACTOR_ID,
                updatedAt: page.updatedAt ?? new Date(),
                updatedBy: MIGRATION_ACTOR_ID
            };
            if (published) {
                row.curation = 'approved';
            }
            const result = await contentItems.updateOne(
                { id: page.contentId },
                { $setOnInsert: row },
                { upsert: true }
            );
            rows += result.upsertedCount;
        }
        console.log(`[Migration] Wrote ${rows} core content rows for pages`);

        // Step 4: unique content id, ignoring any document still without one.
        try {
            await pages.createIndex(
                { contentId: 1 },
                { unique: true, partialFilterExpression: { contentId: { $type: 'string' } } }
            );
            console.log('[Migration] Created unique index on pages.contentId');
        } catch (error) {
            if (error instanceof Error && error.message.includes('already exists')) {
                console.log('[Migration] Index on pages.contentId already exists (skipped)');
            } else {
                throw new Error(
                    `Failed to create index on pages.contentId: ${error instanceof Error ? error.message : String(error)}`
                );
            }
        }
    }
};
