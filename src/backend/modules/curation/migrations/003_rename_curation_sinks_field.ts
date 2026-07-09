import type { IMigration, IMigrationContext } from '@/types';

/**
 * Rename the per-item selected-sink audit array on curation envelopes from
 * `destinations` to `sinks`.
 *
 * **Why this migration exists**
 *
 * Curation's vocabulary unified on "sink" — the content-router term for a
 * delivery target — retiring the parallel "destination" name it once used for
 * the curator-facing view of the same thing. The stored envelope field that
 * records where an approved item was fanned (each selected sink with its settled
 * `delivered`/`failed`/`refused` outcome) was persisted under `destinations`;
 * the code now reads and writes it as `sinks`. Without this rename, a decided
 * item written before the change would surface no delivery outcomes in the
 * history view — new code reading `sinks` finds nothing under the old key.
 *
 * **Why it depends on 001**
 *
 * `001_migrate_curations_from_ai_tools` copies legacy envelopes into
 * `module_curation_curations`. Running the field rename first would leave any
 * item still copied afterward carrying the old `destinations` key, so this
 * migration is ordered after the move to cover every envelope in one place.
 *
 * **Why `$rename` rather than a whole-document rewrite**
 *
 * `destinations` is a plain top-level array field with no dot in its key, so
 * MongoDB's `$rename` addresses it directly and moves the value in place. The
 * update is conditioned on the old field still being present, so it touches only
 * the decided items that actually carry it and is a no-op on a second run.
 *
 * **Idempotency**
 *
 * The `{ destinations: { $exists: true } }` filter makes a re-run match nothing
 * once the rename has completed. Forward-only.
 */

const COLLECTION = 'module_curation_curations';

export const migration: IMigration = {
    id: '003_rename_curation_sinks_field',
    description:
        'Rename the curation envelope audit field destinations → sinks on module_curation_curations so pre-rename decided items keep their per-sink delivery outcomes. Forward-only, idempotent.',
    dependencies: ['module:curation:001_migrate_curations_from_ai_tools'],

    async up(context: IMigrationContext): Promise<void> {
        const collection = context.database.getCollection(COLLECTION);
        const result = await collection.updateMany(
            { destinations: { $exists: true } },
            { $rename: { destinations: 'sinks' } }
        );

        console.log(
            `[Migration] Renamed curation audit field destinations → sinks on ${COLLECTION}: ` +
            `${result.modifiedCount ?? 0} item(s) updated`
        );
    }
};
