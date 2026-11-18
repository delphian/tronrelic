/**
 * @fileoverview Drop the retired `{ typeId, status }` index on the curation
 * envelope store.
 *
 * The History tab pages decided items filtered by content type, newest
 * decision first, so `CurationQueue.ensureIndexes()` now creates
 * `{ typeId, status, decidedAt }` at startup. Its `{ typeId, status }` prefix
 * answers every lookup the two-field index answered, so a deployment created
 * before that change holds a second index that only costs a write on every
 * hold and decision. Run it from `/system/database` after deploying.
 *
 * Collection and index names are written as literals on purpose: a migration
 * is a frozen record of an operation, so it must not drift if a constant is
 * later renamed.
 *
 * Idempotent. The drop tolerates the index or the collection already being
 * gone, which is the state of every fresh install.
 */

import type { IMigration, IMigrationContext } from '@/types';

/** The curation envelope store. */
const COLLECTION = 'module_curation_curations';

/** Auto-generated name of the retired `{ typeId: 1, status: 1 }` index. */
const RETIRED_INDEX = 'typeId_1_status_1';

/**
 * Decide whether a `dropIndex` failure only means there was nothing to drop,
 * so the migration can treat it as success and still surface real failures.
 *
 * The stable numeric codes are tested first, IndexNotFound (27) and
 * NamespaceNotFound (26), because the server's message wording changes across
 * versions; the message match is a fallback for drivers that give no code.
 *
 * @param error - What `dropIndex` threw.
 * @returns True when the index or its collection was already absent.
 */
function isNothingToDrop(error: unknown): boolean {
    const details = error as { code?: number; codeName?: string } | null;
    const message = error instanceof Error ? error.message : String(error);
    return details?.code === 27
        || details?.code === 26
        || details?.codeName === 'IndexNotFound'
        || details?.codeName === 'NamespaceNotFound'
        || /index not found/i.test(message)
        || /ns not found/i.test(message);
}

export const migration: IMigration = {
    id: '005_drop_type_status_index',
    description: 'Drop the retired { typeId, status } index on module_curation_curations; { typeId, status, decidedAt } replaces it.',
    dependencies: [],

    /**
     * Drop the two-field index the three-field history index made redundant.
     *
     * @param context - Migration context exposing the database service.
     */
    async up(context: IMigrationContext): Promise<void> {
        const collection = context.database.getCollection(COLLECTION);
        try {
            await collection.dropIndex(RETIRED_INDEX);
        } catch (error) {
            if (!isNothingToDrop(error)) {
                throw error;
            }
        }
    }
};
