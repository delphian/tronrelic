import type { IMigration, IMigrationContext } from '@/types';

/**
 * Rename the curation-held notification category from the ai-tools namespace to
 * the curation namespace, carrying existing admin preferences with it.
 *
 * **Why this migration exists**
 *
 * When curation lived inside the ai-tools module, the "item held for review"
 * notification category was registered as `ai-tools.curation-held`. The curation
 * module now owns that notification and registers it as `curation.held`. A
 * category id is the persisted key for two pieces of admin state: per-user
 * channel overrides (`module_notifications_preferences.overrides[categoryId]`)
 * and the global admin policy kill-switch
 * (`module_notifications_policy.categories[categoryId]`). Re-registering under
 * the new id without migrating these would silently reset every admin who had
 * opted out of (or globally disabled) curation-hold toasts back to default-on.
 * This migration rewrites those keys so the opt-outs carry over.
 *
 * **Why this rewrites maps in application code, not with `$rename`**
 *
 * The category id contains a dot (`ai-tools.curation-held`), and it is stored as
 * an object *key* inside `overrides` / `categories`. MongoDB's `$rename` and
 * dot-path field selectors treat dots as path separators, so they cannot address
 * a key that literally contains one. The maps are therefore read, rewritten in
 * JS, and written back whole.
 *
 * The audit history (`module_notifications_audit`) is intentionally left
 * untouched: each row snapshots the category id that actually fired at send
 * time, and rewriting it would falsify the historical record.
 *
 * **Idempotency**
 *
 * Each rewrite is conditioned on the old key still being present, so a second
 * run is a no-op. If a new-id entry already exists (a hold fired post-rename
 * before the migration ran) the old value is dropped rather than overwriting the
 * newer preference. Forward-only.
 */

/** The category id curation used while it lived in the ai-tools module. */
const OLD_CATEGORY_ID = 'ai-tools.curation-held';

/** The category id the curation module registers now. */
const NEW_CATEGORY_ID = 'curation.held';

const PREFERENCES_COLLECTION = 'module_notifications_preferences';
const POLICY_COLLECTION = 'module_notifications_policy';

export const migration: IMigration = {
    id: '002_rename_curation_held_notification_category',
    description:
        'Rename notification category ai-tools.curation-held → curation.held across preference overrides and the admin policy map so existing admin opt-outs survive the curation extraction. Forward-only, idempotent.',
    dependencies: [],

    async up(context: IMigrationContext): Promise<void> {
        const prefsUpdated = await rekeyMapField(context, PREFERENCES_COLLECTION, 'overrides');
        const policyUpdated = await rekeyMapField(context, POLICY_COLLECTION, 'categories');

        console.log(
            `[Migration] Renamed notification category ${OLD_CATEGORY_ID} → ${NEW_CATEGORY_ID}: ` +
            `${prefsUpdated} preference doc(s), ${policyUpdated} policy doc(s) updated`
        );
    }
};

/**
 * Move the `OLD_CATEGORY_ID` entry to `NEW_CATEGORY_ID` inside the named object
 * field of every document in a collection. The map is rewritten whole because
 * the dotted key cannot be addressed with `$rename`. A document that already
 * carries the new key keeps it (the post-rename write wins); the stale old key is
 * dropped regardless.
 *
 * @param context - Migration context exposing the database.
 * @param collection - Physical collection name to scan.
 * @param field - The object field holding the category-keyed map.
 * @returns The number of documents rewritten.
 */
async function rekeyMapField(
    context: IMigrationContext,
    collection: string,
    field: string
): Promise<number> {
    const col = context.database.getCollection(collection);
    const docs = await col.find({}).toArray();
    let updated = 0;
    for (const doc of docs) {
        const map = (doc as Record<string, unknown>)[field];
        if (map && typeof map === 'object' && Object.prototype.hasOwnProperty.call(map, OLD_CATEGORY_ID)) {
            const next: Record<string, unknown> = { ...(map as Record<string, unknown>) };
            if (!Object.prototype.hasOwnProperty.call(next, NEW_CATEGORY_ID)) {
                next[NEW_CATEGORY_ID] = next[OLD_CATEGORY_ID];
            }
            delete next[OLD_CATEGORY_ID];
            await col.updateOne({ _id: doc._id }, { $set: { [field]: next } });
            updated += 1;
        }
    }
    return updated;
}
