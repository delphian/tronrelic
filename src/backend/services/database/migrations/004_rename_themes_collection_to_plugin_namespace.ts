import type { IMigration, IMigrationContext } from '@/types';

/**
 * Move the legacy theme module's data into the trp-themes plugin namespace
 * and normalise stored selectors for the shared `[data-theme="active"]`
 * model.
 *
 * **Why this migration exists**
 *
 * The theme feature is moving from `src/backend/modules/theme/` to the
 * `trp-themes` plugin (id `'themes'`). Plugin-scoped database access
 * auto-prefixes every logical name to `plugin_<id>_*`, so the plugin's
 * `database.getCollection('themes')` resolves to `plugin_themes_themes`
 * on disk. The legacy module used the unprefixed `themes` collection and
 * is otherwise unreachable from the plugin context.
 *
 * Two coordinated edits are required:
 *
 * 1. Rename `themes` → `plugin_themes_themes` so the plugin reads/writes
 *    the historical rows.
 * 2. Rewrite every theme's `[data-theme="..."]` selectors to the constant
 *    `[data-theme="active"]`. The plugin's `ssr.htmlAttributes` hook
 *    stamps `data-theme="active"` globally so multiple active themes can
 *    apply concurrently — the prior module rewrote each theme's selector
 *    to that theme's own uuid, which only allowed a single matching
 *    theme to render at a time. Existing rows still carry per-uuid
 *    selectors that this migration normalises in place.
 *
 * Ownership lives at the system layer rather than inside the plugin's
 * `install()` hook because the data outlives the plugin's install state.
 * If the operator never installs `trp-themes`, the legacy rows still
 * belong under the canonical plugin-namespaced name so a later install
 * picks them up. System migrations run once during database bootstrap
 * regardless of plugin lifecycle, which is exactly the semantics this
 * rename + rewrite needs.
 *
 * **Idempotency**
 *
 * The rename treats "source missing" (`NamespaceNotFound`) and
 * "destination already populated and source empty" as success. The CSS
 * rewrite is a pure string substitution that leaves already-normalised
 * rows unchanged, so re-running the migration is safe.
 *
 * **Predecessor migrations**
 *
 * - `module:theme:001_initial_schema` created `themes` and seeded
 *   indexes (`id`, `name`, `isActive`). Those indexes follow the rename
 *   automatically — MongoDB preserves them. Their records remain in the
 *   migration history; they are not re-executed.
 *
 * Forward-only. There is no `down()` because the plugin's selector model
 * is the canonical shape; reverting would require knowing each row's
 * pre-normalisation uuid, which is lossy.
 */
export const migration: IMigration = {
    id: '004_rename_themes_collection_to_plugin_namespace',
    description:
        'Rename themes → plugin_themes_themes so the trp-themes plugin owns its data under the canonical plugin_<id>_* namespace, then rewrite every stored theme\'s [data-theme="..."] selectors to the shared [data-theme="active"] value used by the plugin\'s ssr.htmlAttributes hook. Forward-only.',
    dependencies: [],

    async up(context: IMigrationContext): Promise<void> {
        await renameIfPresent(context, 'themes', 'plugin_themes_themes');
        await normaliseSelectors(context, 'plugin_themes_themes');
    }
};

/**
 * Rename `from` to `to`, treating both "source missing" and "destination
 * already exists with empty source" as no-ops. Anything else rethrows.
 */
async function renameIfPresent(
    context: IMigrationContext,
    from: string,
    to: string
): Promise<void> {
    const source = context.database.getCollection(from);
    try {
        await source.rename(to);
        console.log(`[Migration] Renamed ${from} → ${to}`);
        return;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const code = (error as { code?: number } | undefined)?.code;

        if (code === 26 || /ns not found/i.test(message)) {
            console.log(`[Migration] Source collection ${from} does not exist; skipping rename`);
            return;
        }

        if (code === 48 || /target namespace exists/i.test(message) || /already exists/i.test(message)) {
            const sourceCount = await source.countDocuments();
            if (sourceCount === 0) {
                console.log(`[Migration] Destination ${to} already exists and ${from} is empty; treating as already-renamed`);
                return;
            }
            throw new Error(
                `Cannot rename ${from} → ${to}: destination already exists and ${from} still holds ${sourceCount} document(s). ` +
                `This typically means the trp-themes plugin wrote to ${to} before this migration ran. ` +
                `Resolve manually — either drop the (presumed empty) ${to} so this migration can complete, ` +
                `or merge ${from}'s rows into ${to} and drop ${from} — then re-run this migration.`
            );
        }

        throw error;
    }
}

/**
 * Rewrite stored theme CSS so every `[data-theme="..."]` selector targets
 * the constant `active` value. Walks every document one at a time so the
 * id-correlated log line attributes any failure to a specific theme. The
 * regex matches single- or double-quoted attribute values; the
 * substitution is the same string the plugin's normaliseThemeCss emits
 * on every save.
 */
async function normaliseSelectors(
    context: IMigrationContext,
    collectionName: string
): Promise<void> {
    const collection = context.database.getCollection<{
        id?: string;
        css?: string;
    }>(collectionName);

    const cursor = collection.find({});
    const selectorRegex = /\[data-theme=["'][^"']*["']\]/g;
    let scanned = 0;
    let rewritten = 0;

    while (await cursor.hasNext()) {
        const theme = await cursor.next();
        if (!theme || !theme.id || typeof theme.css !== 'string') {
            continue;
        }
        scanned += 1;
        const updated = theme.css.replace(selectorRegex, '[data-theme="active"]');
        if (updated === theme.css) {
            continue;
        }
        await collection.updateOne({ id: theme.id }, { $set: { css: updated } });
        rewritten += 1;
    }

    console.log(`[Migration] Selector normalise on ${collectionName}: scanned ${scanned}, rewrote ${rewritten}`);
}
