import type { IMigration, IDatabaseService } from '@tronrelic/types';

/**
 * Add oldSlugs field and index to pages collection for redirect support.
 *
 * **Why this migration exists:**
 * The pages module now supports automatic redirects from old URLs when a page's slug
 * changes. When admins update a page's slug, the old slug is preserved in an `oldSlugs`
 * array, and the system returns a 301 redirect from old URLs to the current slug.
 *
 * **Changes being made:**
 * 1. Add `oldSlugs: []` field to all existing pages (defaults to empty array)
 * 2. Create index on `oldSlugs` field for fast redirect lookups
 *
 * **Impact:**
 * - Enables automatic redirect preservation for all pages
 * - Prevents 404 errors when pages are renamed
 * - Index improves redirect lookup performance (sub-millisecond)
 * - No breaking changes - existing pages work unchanged
 * - No data loss
 *
 * **Rollback:**
 * To rollback, drop the index and remove the oldSlugs field from all pages:
 * ```javascript
 * await db.collection('pages').dropIndex('oldSlugs_1');
 * await db.collection('pages').updateMany({}, { $unset: { oldSlugs: '' } });
 * ```
 *
 * **References:**
 * - See docs/system/system-modules-pages.md for pages module architecture
 */
export const migration: IMigration = {
    id: '003_add_old_slugs_to_pages',
    description: 'Add oldSlugs field and index to pages collection for redirect support. Adds empty oldSlugs array to all existing pages and creates index for fast redirect lookups.',
    dependencies: [],

    async up(database: IDatabaseService): Promise<void> {
        const pagesCollection = database.getCollection('pages');

        // Step 1: Add oldSlugs field to all existing pages
        try {
            const result = await pagesCollection.updateMany(
                { oldSlugs: { $exists: false } }, // Only update pages missing the field
                { $set: { oldSlugs: [] } }
            );
            console.log(`[Migration] Added oldSlugs field to ${result.modifiedCount} pages`);
        } catch (error) {
            throw new Error(
                `Failed to add oldSlugs field to pages: ${error instanceof Error ? error.message : String(error)}`
            );
        }

        // Step 2: Create index on oldSlugs field
        try {
            await pagesCollection.createIndex({ oldSlugs: 1 });
            console.log('[Migration] Created index on oldSlugs field');
        } catch (error) {
            // If index already exists, MongoDB throws error - this is expected and safe
            if (error instanceof Error && error.message.includes('already exists')) {
                console.log('[Migration] Index on oldSlugs already exists (skipped)');
            } else {
                throw new Error(
                    `Failed to create index on oldSlugs: ${error instanceof Error ? error.message : String(error)}`
                );
            }
        }

        console.log('[Migration] Successfully added oldSlugs redirect support to pages');
    }
};
