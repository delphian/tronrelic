import { randomBytes } from 'crypto';
import type { IMigration, IMigrationContext } from '@/types';

/**
 * Backfill referral codes for existing users with verified wallets.
 *
 * **Why this migration exists:**
 * The referral system generates codes when users first verify a wallet.
 * Existing verified users created before the referral system don't have codes.
 * This migration generates unique referral codes for them so they can
 * immediately use the referral feature without re-verifying.
 *
 * **Changes being made:**
 * 1. Finds all users with at least one verified wallet AND no referral code
 * 2. Generates a unique 8-character hex code for each (relies on unique DB index)
 * 3. Sets `referral.code` while preserving any existing referredBy/referredAt
 *
 * **Impact:**
 * - Enables referral links for all existing verified users
 * - No data loss, no breaking changes
 * - Users without verified wallets are unaffected (they get codes on verify)
 *
 * **Rollback:**
 * ```javascript
 * await db.collection('users').updateMany({}, { $unset: { referral: '' } });
 * ```
 */
export const migration: IMigration = {
    id: '005_backfill_referral_codes',
    description: 'Generate referral codes for existing users with verified wallets. Enables the referral program for users created before the feature was introduced.',
    dependencies: [],

    async up(context: IMigrationContext): Promise<void> {
        const usersCollection = context.database.getCollection('users');

        // Find all users with verified wallets but no referral code
        const cursor = usersCollection.find({
            wallets: { $elemMatch: { verified: true } },
            $or: [
                { referral: null },
                { referral: { $exists: false } },
                { 'referral.code': { $exists: false } },
                { 'referral.code': null }
            ]
        });

        let updatedCount = 0;

        for await (const user of cursor) {
            const existingReferral = user.referral;
            let attempts = 0;

            // Rely on the unique sparse index on referral.code to guarantee uniqueness.
            // Retry on duplicate key errors instead of preloading all codes into memory.
            while (true) {
                const code = randomBytes(4).toString('hex');
                attempts++;
                if (attempts > 10) {
                    throw new Error(`Failed to generate unique referral code after 10 attempts for user ${user._id}`);
                }

                try {
                    await usersCollection.updateOne(
                        { _id: user._id },
                        {
                            $set: {
                                referral: {
                                    code,
                                    referredBy: existingReferral?.referredBy ?? null,
                                    referredAt: existingReferral?.referredAt ?? null
                                }
                            }
                        }
                    );
                    updatedCount++;
                    break;
                } catch (err: unknown) {
                    // Retry on duplicate key errors (code 11000); rethrow anything else
                    if (err && typeof err === 'object' && 'code' in err && (err as { code: number }).code === 11000) {
                        continue;
                    }
                    throw err;
                }
            }
        }

        console.log(`[Migration 005] Backfilled referral codes for ${updatedCount} existing verified users`);
    }
};
