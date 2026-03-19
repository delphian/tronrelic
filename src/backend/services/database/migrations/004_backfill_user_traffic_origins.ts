import type { IMigration, IMigrationContext } from '@/types';

/**
 * Backfill traffic origin data for existing users from their oldest available session.
 *
 * **Why this migration exists:**
 * The user module now persists first-session traffic origin data (referrer, landing page,
 * country, device, UTM) directly on the user document so it survives session pruning.
 * Existing users created before this feature was introduced have no `activity.origin` field.
 *
 * **Changes being made:**
 * 1. For each user without `activity.origin`, extracts origin data from the oldest
 *    available session in their `activity.sessions` array
 * 2. Sets the `activity.origin` field with best-effort data from the oldest session
 * 3. Users with no sessions at all get `activity.origin` set to a null-filled object
 *
 * **Limitations:**
 * Sessions are capped at 20 and pruned oldest-first, so for long-time users the true
 * original session may already be gone. This migration captures the best available
 * approximation. New users going forward will have accurate origin data captured on
 * their first session.
 *
 * **Impact:**
 * - Enables the Traffic Origins admin UI to display origin data for all users
 * - No data loss, no breaking changes
 * - Read-only for existing session data (only adds the new origin field)
 *
 * **Rollback:**
 * ```javascript
 * await db.collection('users').updateMany({}, { $unset: { 'activity.origin': '' } });
 * ```
 */
export const migration: IMigration = {
    id: '004_backfill_user_traffic_origins',
    description: 'Backfill activity.origin field for existing users from their oldest available session. Enables Traffic Origins admin UI for users created before origin tracking was introduced.',
    dependencies: [],

    async up(context: IMigrationContext): Promise<void> {
        const usersCollection = context.database.getCollection('users');

        const cursor = usersCollection.find({
            $or: [
                { 'activity.origin': { $exists: false } },
                { 'activity.origin': null }
            ]
        });

        let updated = 0;
        let skipped = 0;

        while (await cursor.hasNext()) {
            const user = await cursor.next();
            if (!user) {
                break;
            }

            const sessions = user.activity?.sessions ?? [];
            const oldestSession = sessions.length > 0 ? sessions[sessions.length - 1] : null;

            const origin = {
                referrerDomain: oldestSession?.referrerDomain ?? null,
                landingPage: oldestSession?.landingPage ?? oldestSession?.pages?.[0]?.path ?? null,
                country: oldestSession?.country ?? null,
                device: oldestSession?.device ?? 'unknown',
                utm: oldestSession?.utm ?? null,
                searchKeyword: oldestSession?.searchKeyword ?? null
            };

            try {
                await usersCollection.updateOne(
                    { _id: user._id },
                    { $set: { 'activity.origin': origin } }
                );
                updated++;
            } catch (error) {
                console.error(`[Migration] Failed to update user ${user.id}:`, error);
                skipped++;
            }
        }

        console.log(`[Migration] Backfilled traffic origins for ${updated} users (${skipped} skipped)`);
    }
};
