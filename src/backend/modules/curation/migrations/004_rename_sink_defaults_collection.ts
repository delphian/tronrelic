import type { IMigration, IMigrationContext } from '@/types';

/**
 * Move the standing per-type default-sink policy from
 * `module_curation_destination_defaults` into `module_curation_sink_defaults`.
 *
 * **Why this migration exists**
 *
 * Curation's vocabulary unified on "sink", so the collection that stores each
 * content type's default selected sink ids (the subset the review picker
 * pre-checks) is renamed off the old "destination" name. Without the move, an
 * operator's saved defaults would sit orphaned under the old collection while
 * the module reads an empty new one — every type would silently revert to no
 * pre-selection.
 *
 * **Why copy-then-drop instead of `renameCollection`**
 *
 * `CurationModule.init()` calls `CurationSinkDefaults.ensureIndexes()` at every
 * boot, which creates `module_curation_sink_defaults` (with its unique `typeId`
 * index) before an operator ever triggers this migration. A `renameCollection`
 * onto an existing destination throws `NamespaceExists`, so — exactly as with
 * `001_migrate_curations_from_ai_tools` — copying the rows into the already-
 * indexed target and dropping the legacy collection is the correct adaptation:
 * it respects the pre-created index and is fully idempotent.
 *
 * **Idempotency**
 *
 * The target's unique `typeId` index makes the copy safe to repeat — a row
 * already migrated raises a duplicate-key error that is swallowed. The legacy
 * collection is dropped only after the copy, and a missing legacy collection
 * (fresh install, or a previous run already moved the data) yields an empty read
 * and a no-op. Forward-only.
 */

const SOURCE = 'module_curation_destination_defaults';
const TARGET = 'module_curation_sink_defaults';

export const migration: IMigration = {
    id: '004_rename_sink_defaults_collection',
    description:
        'Move per-type default-sink policy from module_curation_destination_defaults into module_curation_sink_defaults (curation unified on "sink"). Copy-then-drop because the module pre-creates the indexed target at boot. Forward-only, idempotent.',
    dependencies: [],

    async up(context: IMigrationContext): Promise<void> {
        const source = context.database.getCollection(SOURCE);
        const target = context.database.getCollection(TARGET);

        // `find` on a non-existent collection returns an empty cursor (no throw,
        // no implicit create), so this read doubles as the existence probe.
        const docs = await source.find({}).toArray();

        let migrated = 0;
        for (const doc of docs) {
            try {
                // insertOne preserves the original `_id`; the target's unique
                // `typeId` index makes a re-run idempotent.
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
            `[Migration] Migrated ${migrated} sink-default row(s) into ${TARGET} from ${SOURCE}` +
            (docs.length > 0 ? '; dropped the legacy collection' : ' (legacy collection absent)')
        );
    }
};
