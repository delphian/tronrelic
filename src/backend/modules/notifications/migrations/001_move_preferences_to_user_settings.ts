/**
 * @fileoverview Move per-user notification opt-outs into the central
 * user-settings store.
 *
 * Notification preferences used to live in this module's own
 * `module_notifications_preferences` collection. They now persist in the identity
 * module's central `module_user_settings` store under the `'notifications'`
 * namespace, so all user-centric settings share one home behind the
 * `'user-settings'` service. This migration copies each existing opt-out row into
 * the central store and drops the retired collection.
 *
 * Collection names are written as literals on purpose: a migration is a frozen
 * record of an operation, so it must not drift if a constant is later renamed.
 *
 * Idempotent. The destination upsert keys on `(userId, namespace, key)`, so a
 * re-run overwrites rather than duplicates; once the source collection is dropped
 * a re-run simply finds nothing to copy.
 */

import type { IMigration, IMigrationContext } from '@/types';

/** Retired source collection — this module's former preference store. */
const SOURCE_COLLECTION = 'module_notifications_preferences';

/** Destination collection — identity's central per-user settings store. */
const DESTINATION_COLLECTION = 'module_user_settings';

/** Namespace the opt-outs occupy in the central store. */
const NAMESPACE = 'notifications';

/** Key the single opt-out value is stored under within the namespace. */
const KEY = 'preferences';

/**
 * Legacy preference row shape as stored in `module_notifications_preferences`.
 */
interface ILegacyPreferenceDocument {
    userId: string;
    mutedAll?: boolean;
    overrides?: Record<string, Record<string, boolean>>;
}

export const migration: IMigration = {
    id: '001_move_preferences_to_user_settings',
    description: 'Move per-user notification opt-outs from module_notifications_preferences into the central module_user_settings store.',
    // Must run AFTER the curation category-rename migration: that migration
    // rekeys `overrides` inside the legacy collection, so moving (and dropping)
    // the collection first would strand the rename — the migrated opt-outs would
    // keep the stale category key and curation's rekey would no-op against a
    // vanished collection.
    dependencies: ['module:curation:002_rename_curation_held_notification_category'],

    /**
     * Copy every legacy preference row into the central settings store, then drop
     * the retired collection.
     *
     * @param context - Migration context exposing the database service.
     */
    async up(context: IMigrationContext): Promise<void> {
        const source = context.database.getCollection<ILegacyPreferenceDocument>(SOURCE_COLLECTION);
        const destination = context.database.getCollection(DESTINATION_COLLECTION);
        const now = new Date();

        const legacy = await source.find({}).toArray();
        for (const row of legacy) {
            const value = {
                mutedAll: row.mutedAll ?? false,
                overrides: row.overrides ?? {}
            };
            await destination.updateOne(
                { userId: row.userId, namespace: NAMESPACE, key: KEY },
                { $set: { userId: row.userId, namespace: NAMESPACE, key: KEY, value, updatedAt: now } },
                { upsert: true }
            );
        }

        // Drop the retired collection so the data has exactly one home. The catch
        // makes a re-run after the drop (or a fresh deploy that never had the
        // collection) a no-op rather than a NamespaceNotFound failure.
        await source.drop().catch(() => undefined);
    }
};
