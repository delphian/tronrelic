import type { IMigration, IMigrationContext } from '@/types';

/**
 * Restore the text index the `/system/pages` search depends on.
 *
 * **Why this migration exists:**
 * `PageService.listPages` filters the admin page list with a MongoDB `$text`
 * query, and `$text` refuses to run without a text index:
 * "text index required for $text query". The index used to be declared on the
 * Mongoose `PageSchema` as `text_search` over `title`, `slug`, and
 * `description`, and Mongoose built it automatically. When the pages module
 * moved from Mongoose to the native driver (commit 4e4c9d9a), the schema was
 * deleted and nothing took over building its indexes, so any database created
 * since then has no text index and the admin search box returns a 500.
 *
 * **Changes being made:**
 * Creates the `text_search` index on `pages`, with the same keys and name the
 * Mongoose schema used, so a database that still has the old index is left
 * exactly as it is.
 *
 * **Atomicity:**
 * The whole change is one `createIndex` call, which MongoDB applies
 * completely or not at all. Every check runs before it, and none of them
 * writes, so a refusal leaves the collection untouched. The migration does
 * not rely on the executor's transaction: index builds on an existing
 * collection are not allowed inside a MongoDB transaction, and production
 * runs a standalone server where there is no transaction to rely on.
 *
 * **Impact:**
 * - The admin page search on `/system/pages` works again
 * - No document is changed; the build is fast because the collection is small
 * - Re-running is a no-op once the index exists
 *
 * **Refusals:**
 * A collection allows only one text index. If one exists with different keys,
 * the migration stops with an error naming it rather than dropping it, because
 * replacing a text index changes what every search matches and is an
 * operator's decision.
 *
 * **Rollback:**
 * ```javascript
 * db.pages.dropIndex('text_search');
 * ```
 */

/** Name the Mongoose schema gave the index, kept so old and new databases agree. */
const TEXT_INDEX_NAME = 'text_search';

/** Fields the admin search matches, as the Mongoose schema declared them. */
const TEXT_INDEX_FIELDS = ['title', 'slug', 'description'];

/** Shape of one entry from `listIndexes`, reduced to what this migration reads. */
interface IIndexDescription {
    name: string;
    key: Record<string, unknown>;
    weights?: Record<string, number>;
}

/**
 * Whether an existing text index covers exactly the fields this migration
 * would index. A text index lists its fields in `weights`, not in `key`,
 * which only holds the internal `_fts` and `_ftsx` entries.
 *
 * @param index - An index already on the collection.
 * @returns True when it indexes title, slug, and description and nothing else.
 */
function coversSameFields(index: IIndexDescription): boolean {
    const fields = Object.keys(index.weights ?? {}).sort();
    return fields.length === TEXT_INDEX_FIELDS.length
        && [...TEXT_INDEX_FIELDS].sort().every((field, position) => fields[position] === field);
}

export const migration: IMigration = {
    id: '008_restore_pages_text_index',
    description: 'Restore the text_search index on pages (title, slug, description) that the Mongoose schema built before the native-driver refactor. Without it the /system/pages search fails with "text index required for $text query". One createIndex call; no documents change.',
    dependencies: [],

    async up(context: IMigrationContext): Promise<void> {
        const pages = context.database.getCollection('pages');
        const indexes = (await pages.listIndexes().toArray()) as unknown as IIndexDescription[];
        const textIndex = indexes.find(index => index.key._fts === 'text');

        if (textIndex && coversSameFields(textIndex)) {
            console.log(`[Migration] pages already has a text index on ${TEXT_INDEX_FIELDS.join(', ')} ("${textIndex.name}"); nothing to do`);
        } else if (textIndex) {
            throw new Error(
                `pages already has a different text index "${textIndex.name}" over ` +
                `${Object.keys(textIndex.weights ?? {}).join(', ')}. A collection allows only one text index, ` +
                `so drop it deliberately (db.pages.dropIndex('${textIndex.name}')) before running this migration.`
            );
        } else {
            await pages.createIndex(
                { title: 'text', slug: 'text', description: 'text' },
                { name: TEXT_INDEX_NAME }
            );
            console.log(`[Migration] Created text index "${TEXT_INDEX_NAME}" on pages (${TEXT_INDEX_FIELDS.join(', ')})`);
        }
    }
};
