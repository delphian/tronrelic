/**
 * @fileoverview Give existing accounts a starting `lastSeenAt`, so the Last
 * seen column on `/system/users` is not blank for everyone until each user
 * happens to make a request.
 *
 * The best evidence already stored is used:
 * - the newest `updatedAt` among each account's stored sessions, which Better
 *   Auth refreshes while a session is in use;
 * - the newest successful sign-in in `module_user_sign_in_events` (kept 90 days).
 *
 * `$max` means a later real visit, recorded by the activity tracker, is never
 * moved backwards, so the migration is idempotent and safe to re-run. Accounts
 * with no evidence keep no value and show as never seen.
 *
 * Collection names are literals on purpose: a migration is a frozen record of
 * an operation and must not drift if a constant is renamed later.
 */

import { ObjectId } from 'mongodb';
import type { IMigration, IMigrationContext } from '@/types';

/** Better Auth user collection the field is written to. */
const USERS_COLLECTION = 'module_user_auth_users';

/** Better Auth session collection. */
const SESSIONS_COLLECTION = 'module_user_auth_sessions';

/** Stored sign-in events. */
const SIGN_IN_EVENTS_COLLECTION = 'module_user_sign_in_events';

/** Accounts written per bulk request. */
const BATCH_SIZE = 500;

/**
 * Turn a stored user reference into the user record's `_id`. Better Auth has
 * stored session user ids both as ObjectIds and as hex strings across versions.
 *
 * @param value - The stored reference.
 * @returns The `_id`, or null when the value is not a user id.
 */
function toUserObjectId(value: unknown): ObjectId | null {
    let result: ObjectId | null = null;
    if (value instanceof ObjectId) {
        result = value;
    } else if (typeof value === 'string' && /^[0-9a-f]{24}$/i.test(value)) {
        result = new ObjectId(value);
    }
    return result;
}

export const migration: IMigration = {
    id: '001_backfill_last_seen_at',
    description: 'Set a starting lastSeenAt on each account from its newest session activity and successful sign-in, for the Last seen column on /system/users.',
    dependencies: [],

    /**
     * Collect the newest activity time per account from both sources, then
     * write it with `$max` in batches.
     *
     * @param context - Migration context exposing the database service.
     */
    async up(context: IMigrationContext): Promise<void> {
        const latest = new Map<string, { id: ObjectId; at: Date }>();
        /**
         * Keep the newer of two times for one account.
         *
         * @param rawUserId - The stored user reference.
         * @param at - A time the account was active.
         */
        const note = (rawUserId: unknown, at: unknown): void => {
            const id = toUserObjectId(rawUserId);
            if (id && at instanceof Date) {
                const key = id.toHexString();
                const current = latest.get(key);
                if (!current || current.at < at) {
                    latest.set(key, { id, at });
                }
            }
        };

        const sessions = await context.database.getCollection(SESSIONS_COLLECTION).aggregate<{ _id: unknown; at: Date }>([
            { $group: { _id: '$userId', at: { $max: { $ifNull: ['$updatedAt', '$createdAt'] } } } }
        ]).toArray();
        sessions.forEach(row => note(row._id, row.at));

        const signIns = await context.database.getCollection(SIGN_IN_EVENTS_COLLECTION).aggregate<{ _id: unknown; at: Date }>([
            { $match: { kind: 'sign-in-succeeded', userId: { $type: 'string' } } },
            { $group: { _id: '$userId', at: { $max: '$occurredAt' } } }
        ]).toArray();
        signIns.forEach(row => note(row._id, row.at));

        const users = context.database.getCollection(USERS_COLLECTION);
        const updates = [...latest.values()].map(entry => ({
            updateOne: { filter: { _id: entry.id }, update: { $max: { lastSeenAt: entry.at } } }
        }));
        for (let start = 0; start < updates.length; start += BATCH_SIZE) {
            await users.bulkWrite(updates.slice(start, start + BATCH_SIZE), { ordered: false });
        }
    }
};
