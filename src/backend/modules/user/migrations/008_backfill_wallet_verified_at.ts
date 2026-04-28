import type { IMigration, IMigrationContext } from '@/types';

/**
 * Backfill `verifiedAt` on every wallet sub-document.
 *
 * **Why this migration exists.**
 * `verifiedAt` is the freshness anchor consulted by the dual-track admin
 * middleware: a *Verified* user only gains cookie-path admin authority
 * when at least one wallet was signed within `VERIFICATION_FRESHNESS_MS`
 * (14 days). Pre-existing wallets predate the field, so without this
 * backfill every legacy verified user would suddenly fall to "stale"
 * the moment the freshness check ships — including the operator who
 * just promoted themselves into the admin group ten seconds before the
 * deploy. The backfill copies `linkedAt` into `verifiedAt` for every
 * already-verified wallet, giving them the most defensible timestamp
 * we can attribute (the day the wallet was first signed).
 *
 * **What this migration does.**
 * For every `users` document, set `verifiedAt` on each wallet:
 *   - `verified: true`  → `verifiedAt = linkedAt`
 *   - `verified: false` → `verifiedAt = null`
 *
 * Wallets that already have a non-null `verifiedAt` are left alone (so
 * re-running the migration after some users have re-signed doesn't
 * stomp their fresh timestamps with the older `linkedAt`).
 *
 * The arrayFilters in `updateMany` operate on each wallet sub-document
 * matching a freshness gate, so the migration is bounded by document
 * count, not wallet count. It is idempotent — re-running matches zero
 * wallets on the second pass because every wallet now has a non-null
 * `verifiedAt` (or is unverified with `verifiedAt = null`).
 *
 * **Behavioural impact.**
 * - Legacy verified wallets older than the freshness window register
 *   as stale on first request after this migration completes. That is
 *   correct: we have no proof the cookie holder is still the original
 *   signer. Operators must re-sign once via the recovery flow.
 * - Operators who signed within the window keep cookie-path admin
 *   authority uninterrupted, since their `linkedAt` is recent.
 * - Anonymous and Registered users are unaffected — the freshness
 *   gate only consults `verifiedAt` when `identityState === Verified`.
 *
 * **Rollback.**
 * ```javascript
 * await db.collection('users').updateMany(
 *     {},
 *     { $unset: { 'wallets.$[].verifiedAt': '' } }
 * );
 * ```
 *
 * Note: rolling back without also reverting the application code will
 * cause every cookie-path admin call to fail closed (no fresh wallet),
 * so the rollback only makes sense paired with code revert.
 */
export const migration: IMigration = {
    id: '008_backfill_wallet_verified_at',
    description:
        'Backfill verifiedAt on existing wallet sub-documents. Verified wallets adopt linkedAt as the ' +
        'most defensible historical signature timestamp; unverified wallets are set to null. Required ' +
        'by the cookie-path admin freshness gate that ships alongside this migration.',
    dependencies: ['module:user:006_backfill_user_identity_state'],

    async up(context: IMigrationContext): Promise<void> {
        const usersCollection = context.database.getCollection('users');

        // Verified wallets without a verifiedAt: copy linkedAt forward.
        const verifiedResult = await usersCollection.updateMany(
            { 'wallets': { $elemMatch: { verified: true, verifiedAt: { $in: [null, undefined] } } } },
            [
                {
                    $set: {
                        wallets: {
                            $map: {
                                input: '$wallets',
                                as: 'w',
                                in: {
                                    $cond: [
                                        {
                                            $and: [
                                                { $eq: ['$$w.verified', true] },
                                                {
                                                    $or: [
                                                        { $eq: [{ $type: '$$w.verifiedAt' }, 'missing'] },
                                                        { $eq: ['$$w.verifiedAt', null] }
                                                    ]
                                                }
                                            ]
                                        },
                                        {
                                            $mergeObjects: ['$$w', { verifiedAt: '$$w.linkedAt' }]
                                        },
                                        '$$w'
                                    ]
                                }
                            }
                        }
                    }
                }
            ]
        );

        // Unverified wallets without a verifiedAt: stamp explicit null so
        // the field exists uniformly across the collection. Future writes
        // through the application path always include the field; this is
        // just for legacy rows.
        const unverifiedResult = await usersCollection.updateMany(
            { 'wallets': { $elemMatch: { verified: false, verifiedAt: { $exists: false } } } },
            [
                {
                    $set: {
                        wallets: {
                            $map: {
                                input: '$wallets',
                                as: 'w',
                                in: {
                                    $cond: [
                                        {
                                            $and: [
                                                { $eq: ['$$w.verified', false] },
                                                { $eq: [{ $type: '$$w.verifiedAt' }, 'missing'] }
                                            ]
                                        },
                                        { $mergeObjects: ['$$w', { verifiedAt: null }] },
                                        '$$w'
                                    ]
                                }
                            }
                        }
                    }
                }
            ]
        );

        console.log(
            `[Migration 008] Backfilled wallet verifiedAt on ` +
            `${verifiedResult.modifiedCount} verified-wallet user(s) and ` +
            `${unverifiedResult.modifiedCount} unverified-wallet user(s).`
        );
    }
};
