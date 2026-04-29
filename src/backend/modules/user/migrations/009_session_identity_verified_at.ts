import type { IMigration, IMigrationContext } from '@/types';

// Inline string literals matching `UserIdentityState`. Migration files are
// compiled with `bundle: false`, which does not resolve the `@/types` path
// alias, so a runtime import of the enum breaks the scanner's dynamic import
// in production. Keep these in sync with
// packages/types/src/user/IUserIdentityState.ts.
const IDENTITY_VERIFIED = 'verified';

/**
 * Add the user-level session clock and retire the legacy `isLoggedIn` flag.
 *
 * **Why this migration exists.**
 * The user-identity model collapses two previously-separate concerns
 * (per-wallet verification freshness and a UI-gate `isLoggedIn` flag)
 * into a single user-level session timestamp, `identityVerifiedAt`,
 * paired with the existing authoritative `identityState`. The new
 * predicate is "Verified iff `identityVerifiedAt + SESSION_TTL_MS > now`,"
 * enforced lazily by `UserService.enforceSessionExpiryOnUser` on every
 * read. Without this backfill, every legacy Verified user would land
 * on `identityVerifiedAt: null` after deploy and the lazy expiry
 * pass would immediately demote them to Registered — even ones who
 * signed minutes earlier. This migration assigns the most defensible
 * historical timestamp (the most recent per-wallet `verifiedAt`) so
 * legitimate live sessions survive the cutover and only genuinely
 * stale sessions get demoted.
 *
 * **What this migration does.**
 *   1. For every user with stored `identityState === 'verified'`,
 *      compute `identityVerifiedAt` from `max(wallets[*].verifiedAt)`.
 *      Users with no per-wallet `verifiedAt` history (legacy data
 *      without migration 008) fall back to `updatedAt`, which is the
 *      next best signal that the session was alive recently.
 *   2. For every other user, set `identityVerifiedAt = null` so the
 *      field exists uniformly across the collection.
 *   3. `$unset` the legacy `isLoggedIn` flag from every document.
 *      The application no longer reads or writes it; removing it
 *      from storage prevents a later regression from accidentally
 *      reviving the old dual-clock model.
 *
 * **Behavioural impact.**
 *   - Verified users with at least one wallet signature within
 *     `SESSION_TTL_MS` (14 days) keep their session uninterrupted.
 *   - Verified users whose every wallet signature has aged past the
 *     window get demoted to Registered on first read after deploy
 *     (the lazy expiry pass takes care of this — the migration does
 *     not eagerly downgrade because the expiry rule belongs in one
 *     place).
 *   - Anonymous and Registered users are unaffected by the session
 *     fields; only the `isLoggedIn` removal touches them.
 *
 * **Idempotent.** Safe to re-run. The non-Verified backfill and
 * `isLoggedIn` unset match nothing on subsequent passes; the
 * Verified-user update may still match documents but recomputes the
 * same `identityVerifiedAt` value, resulting in no-op modifications.
 *
 * **Rollback.**
 * ```javascript
 * await db.collection('users').updateMany(
 *     {},
 *     { $unset: { identityVerifiedAt: '' }, $set: { isLoggedIn: false } }
 * );
 * ```
 *
 * Note: rolling back without reverting the application code will
 * cause every read to interpret a missing `identityVerifiedAt` as a
 * stale session and downgrade the user. The rollback only makes
 * sense paired with code revert.
 */
export const migration: IMigration = {
    id: '009_session_identity_verified_at',
    description:
        'Add identityVerifiedAt (user-level session clock) by deriving from max(wallets[*].verifiedAt) ' +
        'for legacy Verified users; set null on others. Unset the legacy isLoggedIn flag from every ' +
        'document. Required by the new single-clock session model.',
    dependencies: [
        'module:user:006_backfill_user_identity_state',
        'module:user:008_backfill_wallet_verified_at'
    ],

    async up(context: IMigrationContext): Promise<void> {
        const usersCollection = context.database.getCollection('users');

        // For Verified users: stamp identityVerifiedAt from the most
        // recent per-wallet verifiedAt. Falls back to updatedAt when no
        // wallet has a recorded signature timestamp.
        const verifiedResult = await usersCollection.updateMany(
            { identityState: IDENTITY_VERIFIED },
            [
                {
                    $set: {
                        identityVerifiedAt: {
                            $let: {
                                vars: {
                                    walletStamps: {
                                        $filter: {
                                            input: {
                                                $map: {
                                                    input: { $ifNull: ['$wallets', []] },
                                                    as: 'w',
                                                    in: '$$w.verifiedAt'
                                                }
                                            },
                                            as: 't',
                                            cond: { $ne: ['$$t', null] }
                                        }
                                    }
                                },
                                in: {
                                    $cond: [
                                        { $gt: [{ $size: '$$walletStamps' }, 0] },
                                        { $max: '$$walletStamps' },
                                        '$updatedAt'
                                    ]
                                }
                            }
                        }
                    }
                }
            ]
        );

        // For non-Verified users: enforce explicit null so the field
        // is consistent across the collection. Catches both legacy rows
        // missing the field and any rows that already carry an
        // inconsistent non-null timestamp (e.g. from a partial / failed
        // earlier deploy of this migration). Guarantees the invariant
        // `identityState !== Verified ⇒ identityVerifiedAt === null`.
        const nullResult = await usersCollection.updateMany(
            {
                identityState: { $ne: IDENTITY_VERIFIED },
                $or: [
                    { identityVerifiedAt: { $exists: false } },
                    { identityVerifiedAt: { $ne: null } }
                ]
            },
            { $set: { identityVerifiedAt: null } }
        );

        // Retire the legacy UI-gate flag from every document.
        const unsetResult = await usersCollection.updateMany(
            { isLoggedIn: { $exists: true } },
            { $unset: { isLoggedIn: '' } }
        );

        console.log(
            `[Migration 009] identityVerifiedAt: stamped ${verifiedResult.modifiedCount} verified user(s), ` +
            `nulled ${nullResult.modifiedCount} non-verified user(s); ` +
            `unset isLoggedIn on ${unsetResult.modifiedCount} document(s).`
        );
    }
};
