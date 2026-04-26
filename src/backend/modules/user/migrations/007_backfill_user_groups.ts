import type { IMigration, IMigrationContext } from '@/types';

/**
 * Backfill `groups` on every existing user document.
 *
 * **Why this migration exists.**
 * The `groups` field stores admin-defined group memberships used by
 * `IUserGroupService` for permission gating. Going forward `UserService`
 * sets it to `[]` on every newly created user, but pre-existing
 * documents have no value for it. Without this backfill, `getUserGroups`
 * would return `undefined` for legacy users instead of the empty array
 * its contract promises, and `$addToSet` membership writes would behave
 * unevenly depending on whether the field was present.
 *
 * **What this migration does.**
 * Sets `groups: []` on every users document that is missing the field.
 * The new `module_user_groups` collection itself is brand new — its
 * indexes and the seeded `admin` system row are created idempotently
 * by `UserGroupService.createIndexes()` / `seedSystemGroups()` during
 * module init, so no migration is needed for those.
 *
 * The migration is idempotent: re-running only touches documents that
 * still lack the field.
 *
 * **Rollback.**
 * ```javascript
 * await db.collection('users').updateMany({}, { $unset: { groups: '' } });
 * ```
 */
export const migration: IMigration = {
    id: '007_backfill_user_groups',
    description:
        'Backfill groups: [] on every users document missing the field. ' +
        'Required by IUserGroupService membership APIs and the admin user-groups tab.',
    dependencies: [],

    async up(context: IMigrationContext): Promise<void> {
        const usersCollection = context.database.getCollection('users');

        const result = await usersCollection.updateMany(
            { groups: { $exists: false } },
            { $set: { groups: [] } }
        );

        console.log(
            `[Migration 007] Backfilled groups: [] on ${result.modifiedCount} user document(s)`
        );
    }
};
