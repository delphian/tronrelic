import type { IMigration, IMigrationContext } from '@/types';

/**
 * Rename the legacy files-module collections into the plugin namespace.
 *
 * **Why this migration exists**
 *
 * The Files module was promoted to a runtime-toggleable plugin (`trp-files`,
 * id `'files'`). Plugin-scoped database access auto-prefixes every logical
 * name to `plugin_<id>_*`, so the existing physical collections
 * `module_pages_files` and `module_files_settings` are unreachable through
 * `context.database.getCollection('files'|'settings')` — those resolve to
 * `plugin_files_files` and `plugin_files_settings` respectively. Without
 * this rename the new plugin would write to empty plugin-prefixed
 * collections while the historical inventory sat orphaned under the old
 * module-prefixed names.
 *
 * Ownership lives at the system layer rather than inside the plugin's
 * `install()` hook because the data outlives the plugin's install state.
 * If the operator chooses not to install `trp-files` on a fresh deployment,
 * existing rows still need to land in their canonical plugin-namespaced
 * home so a later install picks them up correctly. A system migration runs
 * once during database bootstrap regardless of plugin lifecycle, which is
 * exactly the semantics this rename needs.
 *
 * **What it does**
 *
 * 1. Rename `module_pages_files` → `plugin_files_files` (inventory rows).
 * 2. Rename `module_files_settings` → `plugin_files_settings` (upload policy).
 *
 * Indexes attached to the source collection follow the rename — MongoDB
 * preserves them automatically — so the unique `id` index, the
 * `(source.kind, source.id, uploadedAt)` lookup index, and the
 * `uploadedAt` feed index keep the same names and definitions. Bytes on
 * disk under `public/uploads/` are not touched: the inventory `path`
 * column carries the absolute URL, so existing files remain reachable.
 *
 * **Idempotency**
 *
 * MongoDB throws `ns not found` when the source collection is missing
 * (fresh installs, or a previous run already moved the data) and a
 * `NamespaceExists` / code-48 error when the destination already exists
 * (this migration has run successfully before, then somehow re-entered).
 * Both are treated as success — the rename is forward-only, and any state
 * where the destination exists means the data is already in the right
 * place.
 *
 * **Predecessor migrations**
 *
 * - `module:pages:004_files_inventory` created `module_pages_files`.
 * - `module:files:001_files_settings` created `module_files_settings`.
 *
 * Both already ran in production. Their records remain in the migration
 * history; they are not re-executed. This migration is the bridge from
 * the module-owned shape to the plugin-owned shape.
 */
export const migration: IMigration = {
    id: '003_rename_files_collections_to_plugin_namespace',
    description:
        'Rename module_pages_files → plugin_files_files and module_files_settings → plugin_files_settings so the trp-files plugin owns its data under the canonical plugin_<id>_* namespace. Indexes attached to each collection follow the rename. Forward-only.',
    dependencies: [],

    async up(context: IMigrationContext): Promise<void> {
        await renameIfPresent(context, 'module_pages_files', 'plugin_files_files');
        await renameIfPresent(context, 'module_files_settings', 'plugin_files_settings');
    }
};

/**
 * Rename `from` to `to`, treating both "source missing" and "destination
 * already exists" as no-ops. Anything else rethrows so the migration
 * surface fails loudly.
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

        if (/ns not found/i.test(message)) {
            console.log(`[Migration] Source collection ${from} does not exist; skipping`);
            return;
        }

        // MongoDB error code 48 — NamespaceExists. The destination is
        // already populated, which means an earlier run of this
        // migration already moved the data.
        if (code === 48 || /target namespace exists/i.test(message) || /already exists/i.test(message)) {
            console.log(`[Migration] Destination collection ${to} already exists; treating as already-renamed`);
            return;
        }

        throw error;
    }
}
