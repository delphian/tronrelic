/**
 * @fileoverview Backfill the provenance fields onto pre-existing address-tag
 * documents.
 *
 * The address-tags collection is gaining provenance: `manual` (a human
 * asserted the tag), `active` (denormalized liveness recomputed on every
 * write), and `sources` (machine assertions with soft withdrawal). Every
 * document written before this change lacks all three, and the phase 1b
 * release filters every read path on `active: true` — so without this
 * backfill, every tag stored today would vanish from every surface the moment
 * that filter ships. Everything stored before provenance existed was typed by
 * an admin, which is why the backfill stamps `manual: true`, `active: true`,
 * and an empty `sources` array.
 *
 * The migration also drops the old `{ tag: 1, address: 1 }` reverse-lookup
 * index. The service now creates a widened `{ tag: 1, active: 1, address: 1 }`
 * replacement at init, and leaving the narrower index in place would give the
 * query planner two overlapping candidates to choose badly between.
 *
 * Collection and index names are written as literals on purpose: a migration
 * is a frozen record of an operation, so it must not drift if a constant is
 * later renamed.
 *
 * Idempotent. The backfill filters on documents missing `active`, so a re-run
 * matches nothing, and the index drop tolerates the index already being gone.
 */

import type { IMigration, IMigrationContext } from '@/types';

/** The address-tags assignment collection this migration repairs. */
const COLLECTION = 'module_address-tags_tags';

/** Auto-generated name of the retired `{ tag: 1, address: 1 }` index. */
const RETIRED_INDEX = 'tag_1_address_1';

export const migration: IMigration = {
    id: '001_add_provenance_fields',
    description: 'Stamp manual/active/sources provenance fields onto pre-provenance address-tag documents and drop the retired { tag, address } index.',
    dependencies: [],

    /**
     * Stamp every unprovenanced document as a live manual tag, then retire
     * the narrow reverse-lookup index the widened one replaces.
     *
     * @param context - Migration context exposing the database service.
     */
    async up(context: IMigrationContext): Promise<void> {
        const collection = context.database.getCollection(COLLECTION);

        await collection.updateMany(
            { active: { $exists: false } },
            { $set: { manual: true, active: true, sources: [] } }
        );

        // dropIndex throws when the index does not exist (fresh deploys never
        // create it; a re-run already dropped it) — both are success states
        // for this migration, so the failure is swallowed deliberately.
        try {
            await collection.dropIndex(RETIRED_INDEX);
        } catch {
            // Index already absent — nothing to retire.
        }
    }
};
