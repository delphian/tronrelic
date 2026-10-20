import type { IMigration, IMigrationContext } from '@/types';

/**
 * Restore the unique index that stops two pages from sharing a URL.
 *
 * **Why this migration exists:**
 * The Mongoose `PageSchema` declared `slug` as unique, and Mongoose built that
 * index automatically. When the pages module moved to the native driver
 * (commit 4e4c9d9a), the schema was deleted and nothing took over building it.
 * Since then `PageContentType.assertSlugsAvailable` has been the only guard,
 * and it checks before it writes, so two saves of the same slug arriving
 * together can both pass the check and both be stored. Visitors would then be
 * served whichever page the database returns first.
 *
 * **Changes being made:**
 * Creates the unique index `slug_1` on `pages`, the name Mongoose gave it, so
 * a database that still has the old index is left exactly as it is. It covers
 * soft-deleted pages too, which matches the module's rule that a deleted
 * page's slug stays reserved.
 *
 * **Atomicity:**
 * The whole change is one `createIndex` call, which MongoDB applies
 * completely or not at all. Every check runs before it, and none of them
 * writes, so a refusal leaves the collection untouched. The migration does
 * not rely on the executor's transaction: index builds on an existing
 * collection are not allowed inside a MongoDB transaction, and production
 * runs a standalone server where there is no transaction to rely on.
 *
 * **Refusals:**
 * - Two or more pages already share a slug: the migration lists them and stops.
 *   Building the index would fail anyway, and choosing which page keeps the
 *   URL is an editorial decision. Rename or delete the extras on
 *   `/system/pages`, then run it again.
 * - An index named `slug_1` exists but is not unique: the migration stops
 *   rather than dropping it, so the operator decides when to replace it.
 *
 * **Impact:**
 * - A racing duplicate save is refused by the database instead of stored
 * - Slug lookups use the index instead of scanning the collection
 * - No document is changed; re-running is a no-op once the index exists
 *
 * **Rollback:**
 * ```javascript
 * db.pages.dropIndex('slug_1');
 * ```
 */

/** Name Mongoose gave the index, kept so old and new databases agree. */
const SLUG_INDEX_NAME = 'slug_1';

/** Most duplicate slugs listed in the refusal, so the message stays readable. */
const MAX_DUPLICATES_LISTED = 20;

/** Shape of one entry from `listIndexes`, reduced to what this migration reads. */
interface IIndexDescription {
    name: string;
    key: Record<string, unknown>;
    unique?: boolean;
}

/** One slug held by more than one page, from the duplicate check. */
interface IDuplicateSlug {
    _id: unknown;
    count: number;
}

/**
 * Whether an index is exactly a unique ascending index on `slug` alone.
 *
 * @param index - An index already on the collection.
 * @returns True when it already gives the guarantee this migration adds.
 */
function isUniqueSlugIndex(index: IIndexDescription): boolean {
    const keys = Object.keys(index.key);
    return keys.length === 1 && index.key.slug === 1 && index.unique === true;
}

export const migration: IMigration = {
    id: '009_restore_pages_slug_unique_index',
    description: 'Restore the unique slug_1 index on pages that the Mongoose schema built before the native-driver refactor, so two pages can never be stored under the same URL. Refuses, without writing, when pages already share a slug. One createIndex call; no documents change.',
    dependencies: [],

    async up(context: IMigrationContext): Promise<void> {
        const pages = context.database.getCollection('pages');
        const indexes = (await pages.listIndexes().toArray()) as unknown as IIndexDescription[];
        const existing = indexes.find(index => index.name === SLUG_INDEX_NAME);

        if (existing && isUniqueSlugIndex(existing)) {
            console.log(`[Migration] pages already has the unique index "${SLUG_INDEX_NAME}"; nothing to do`);
        } else if (existing) {
            throw new Error(
                `pages has an index named "${SLUG_INDEX_NAME}" that is not a unique index on slug. ` +
                `Drop it deliberately (db.pages.dropIndex('${SLUG_INDEX_NAME}')) before running this migration.`
            );
        } else {
            const duplicates = (await pages.aggregate([
                { $group: { _id: '$slug', count: { $sum: 1 } } },
                { $match: { count: { $gt: 1 } } },
                { $sort: { count: -1 } }
            ]).toArray()) as unknown as IDuplicateSlug[];

            if (duplicates.length > 0) {
                const listed = duplicates
                    .slice(0, MAX_DUPLICATES_LISTED)
                    .map(duplicate => `${JSON.stringify(duplicate._id)} (${duplicate.count} pages)`)
                    .join(', ');
                throw new Error(
                    `${duplicates.length} slug(s) are shared by more than one page: ${listed}. ` +
                    'Rename or delete the extra pages on /system/pages, then run this migration again.'
                );
            }

            await pages.createIndex({ slug: 1 }, { name: SLUG_INDEX_NAME, unique: true });
            console.log(`[Migration] Created unique index "${SLUG_INDEX_NAME}" on pages`);
        }
    }
};
