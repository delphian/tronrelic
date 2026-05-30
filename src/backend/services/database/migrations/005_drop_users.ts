import type { IMigration, IMigrationContext } from '@/types';

/**
 * Drop the legacy `users` collection after the Better Auth cutover.
 *
 * **Why this migration exists:**
 * The Better Auth migration replaced the UUID-keyed identity system with
 * Better Auth as the sole identity layer. The backend `modules/user` (which
 * owned the unprefixed `users` collection) has been deleted; account identity
 * now lives in `module_user_auth_users`, wallets in `module_user_wallets`,
 * groups in `module_user_groups`, and behavioral analytics in the ClickHouse
 * `traffic_events` table. Nothing reads or writes `users` anymore.
 *
 * Lives in the SYSTEM migration set (not a module set) because `users` is an
 * unprefixed legacy collection with no surviving module owner — a module-scoped
 * migration would have vanished when `modules/user` was deleted.
 *
 * **Impact:**
 * - The `users` collection and all rows (preferences, activity, legacy wallet
 *   links, referral data) are permanently deleted. Historical analytics were
 *   already mirrored into `traffic_events`; identity is owned by Better Auth.
 * - No application downtime — no live code path touches `users`.
 *
 * **Operator action:** migrations are operator-triggered from `/system/database`,
 * never auto-run at boot. Run this only after confirming the Better Auth cutover
 * is deployed and verified. There is no rollback — restore from backup if needed.
 */
export const migration: IMigration = {
    id: '005_drop_users',
    description: 'Drop the legacy unprefixed `users` collection after the Better Auth cutover removed the backend user module. Identity now lives in Better Auth (module_user_auth_users); analytics in traffic_events. Permanent data loss — operator-triggered only.',
    dependencies: [],

    async up(context: IMigrationContext): Promise<void> {
        try {
            const collection = context.database.getCollection('users');
            await collection.drop();
            console.log('[Migration] Dropped collection: users');
        } catch (error) {
            // MongoDB throws "ns not found" when the collection is already
            // gone (fresh install, or a re-run). Idempotent: treat as success.
            if (error instanceof Error && error.message.includes('ns not found')) {
                console.log('[Migration] Skipped (not found): users');
            } else {
                throw new Error(`Failed to drop collection users: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
    }
};
