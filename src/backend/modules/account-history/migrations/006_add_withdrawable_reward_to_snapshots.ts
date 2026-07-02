/**
 * @fileoverview Adds the withdrawable-reward column to the balance snapshots.
 *
 * Why: unclaimed staking/vote rewards are real net worth the ledger cannot see —
 * they enter the liquid balance only when a `WithdrawBalanceContract` claims
 * them — so the snapshot sampler now probes `wallet/getReward` and persists the
 * figure here. Pre-existing rows default to 0 ("none known"), the same value the
 * probe reports for accounts that never voted, so old and new rows read
 * uniformly.
 */

import type { IMigration, IMigrationContext } from '@/types';

/**
 * Adds `withdrawable_reward_sun` to `account_balance_snapshots`. Idempotent via
 * `IF NOT EXISTS`; no-op when ClickHouse is not configured.
 */
export const migration: IMigration = {
    id: '006_add_withdrawable_reward_to_snapshots',
    description: 'Add withdrawable_reward_sun to account_balance_snapshots so unclaimed vote rewards count toward net worth.',
    target: 'clickhouse',
    dependencies: ['module:account-history:002_create_balance_snapshot_tables'],

    /**
     * Apply the column addition.
     *
     * @param context - Migration context; `clickhouse` undefined skips the work.
     */
    async up(context: IMigrationContext): Promise<void> {
        if (!context.clickhouse) {
            return;
        }

        await context.clickhouse.exec(`
            ALTER TABLE account_balance_snapshots
            ADD COLUMN IF NOT EXISTS withdrawable_reward_sun Int64 DEFAULT 0
        `);
    }
};
