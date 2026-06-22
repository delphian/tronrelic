import type { IMigration, IMigrationContext } from '@/types';

/**
 * Move the curation queue from the ai-tools namespace into the curation module's
 * own collection.
 *
 * **Why this migration exists**
 *
 * The central curation queue was extracted from the `ai-tools` module into its
 * own `curation` module. The held-and-decided envelopes lived in
 * `module_ai-tools_curations`; the curation module now owns them under
 * `module_curation_curations`. Without this move, the new module would read an
 * empty collection while the historical queue (and its decided-item audit
 * trail) sat orphaned under the old name.
 *
 * **Why copy-then-drop instead of `renameCollection`**
 *
 * `CurationModule.init()` calls `CurationQueue.ensureIndexes()` at every boot,
 * which creates `module_curation_curations` (with its indexes) before an
 * operator ever triggers this migration. A `renameCollection` onto an existing
 * destination throws `NamespaceExists`, so the rename precedent
 * (`003_rename_files_collections_to_plugin_namespace`) does not fit. Copying the
 * documents into the already-indexed destination and dropping the legacy
 * collection is the correct adaptation: it respects the pre-created indexes and
 * is fully idempotent.
 *
 * **Idempotency**
 *
 * The destination's unique `id` index makes the copy safe to repeat — a row
 * already migrated raises a duplicate-key error that is swallowed. The legacy
 * collection is dropped only after the copy, and a missing legacy collection
 * (fresh install, or a previous run already moved the data) yields an empty read
 * and a no-op. Forward-only.
 */
export const migration: IMigration = {
    id: '001_migrate_curations_from_ai_tools',
    description:
        'Move curation envelopes from module_ai-tools_curations into module_curation_curations (the curation module now owns the queue). Copy-then-drop because the module pre-creates the indexed destination at boot. Forward-only, idempotent.',
    dependencies: [],

    async up(context: IMigrationContext): Promise<void> {
        const source = context.database.getCollection('module_ai-tools_curations');
        const target = context.database.getCollection('module_curation_curations');

        // `find` on a non-existent collection returns an empty cursor (no throw,
        // no implicit create), so this read doubles as the existence probe.
        const docs = await source.find({}).toArray();

        let migrated = 0;
        for (const doc of docs) {
            try {
                // insertOne preserves the original `_id`; the destination's unique
                // `id` index makes a re-run idempotent.
                await target.insertOne(doc);
                migrated += 1;
            } catch (error) {
                const code = (error as { code?: number } | undefined)?.code;
                if (code === 11000) {
                    // Already copied by an earlier (partial) run — skip.
                    continue;
                }
                throw error;
            }
        }

        if (docs.length > 0) {
            try {
                await source.drop();
            } catch (error) {
                const code = (error as { code?: number } | undefined)?.code;
                const message = error instanceof Error ? error.message : String(error);
                // Code 26 — NamespaceNotFound. The legacy collection is already
                // gone (a prior run dropped it); nothing more to do.
                if (code !== 26 && !/ns not found/i.test(message)) {
                    throw error;
                }
            }
        }

        console.log(
            `[Migration] Migrated ${migrated} curation item(s) into module_curation_curations from module_ai-tools_curations` +
            (docs.length > 0 ? '; dropped the legacy collection' : ' (legacy collection absent)')
        );
    }
};
