import { UserIdentityState } from '@/types';
import type { IMigration, IMigrationContext } from '@/types';

/**
 * Backfill `identityState` on every existing user document.
 *
 * **Why this migration exists.**
 * The `identityState` field codifies the canonical anonymous / registered /
 * verified taxonomy as a stored, indexed scalar. Going forward `UserService`
 * sets it on every wallet mutation, but pre-existing user documents have no
 * value for it. Without this backfill, all queries that read `identityState`
 * (admin filters, analytics aggregations, the conversion funnel) would treat
 * legacy users as if they had no state and silently drop them from results.
 *
 * **What this migration does.**
 * For every document in the `users` collection it derives `identityState`
 * from the existing `wallets` array using the same rule the service uses:
 *
 *   - `wallets.length === 0`           → `UserIdentityState.Anonymous`
 *   - `wallets.some(w => w.verified)`  → `UserIdentityState.Verified`
 *   - otherwise                         → `UserIdentityState.Registered`
 *
 * Tombstone documents (those with a `mergedInto` pointer) always have an
 * empty `wallets` array, so they correctly back-fill to `Anonymous`.
 *
 * The migration is idempotent: re-running it overwrites `identityState` with
 * the same value derived from the (unchanged) `wallets` array.
 *
 * **Impact.**
 * - Adds a single string field to every user document.
 * - Enables the indexed identity-state filters and analytics queries that
 *   were rewritten in this same change.
 * - No data loss, no behavioural change for users who already have a value.
 *
 * **Rollback.**
 * ```javascript
 * await db.collection('users').updateMany({}, { $unset: { identityState: '' } });
 * ```
 *
 * Note: rolling back without also reverting the application code will cause
 * `toPublicUser` to fall back to a fresh in-memory computation per request,
 * which is correct but defeats the point of the stored field.
 */
export const migration: IMigration = {
    id: '006_backfill_user_identity_state',
    description:
        'Backfill identityState on every user document by deriving from the existing wallets array. ' +
        'Required by the canonical UserIdentityState taxonomy and the admin/analytics queries that ' +
        'now read the stored field directly.',
    dependencies: [],

    async up(context: IMigrationContext): Promise<void> {
        const usersCollection = context.database.getCollection('users');

        // Use bulkWrite for efficient backfill; group by derived state so the
        // database does the work in three updateMany operations instead of N.
        // Empty wallets (and missing `wallets` field on legacy docs) → anonymous.
        const anonymousResult = await usersCollection.updateMany(
            {
                $or: [
                    { wallets: { $exists: false } },
                    { wallets: { $size: 0 } }
                ]
            },
            { $set: { identityState: UserIdentityState.Anonymous } }
        );

        // Any wallet with verified=true → user is verified.
        const verifiedResult = await usersCollection.updateMany(
            { wallets: { $elemMatch: { verified: true } } },
            { $set: { identityState: UserIdentityState.Verified } }
        );

        // Has wallets but none verified → registered. We compute the
        // complement: docs with at least one wallet AND no wallet with
        // verified=true. Mongo expresses this with $not on $elemMatch.
        const registeredResult = await usersCollection.updateMany(
            {
                'wallets.0': { $exists: true },
                wallets: { $not: { $elemMatch: { verified: true } } }
            },
            { $set: { identityState: UserIdentityState.Registered } }
        );

        console.log(
            `[Migration 006] Backfilled identityState: ` +
            `${anonymousResult.modifiedCount} anonymous, ` +
            `${registeredResult.modifiedCount} registered, ` +
            `${verifiedResult.modifiedCount} verified`
        );
    }
};
