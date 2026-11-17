/**
 * @fileoverview The plain-English reason a backfill or forward-sync tick did
 * no work.
 *
 * Shared by the Accounts tab's run-now toast and the Activity tab's tick rows,
 * so both surfaces describe the same skip in the same words.
 */

import type { AccountHistoryTickSkipReason } from '../../../../../../modules/account-history';

/**
 * One sentence per skip reason. A `Record` over the union rather than a
 * switch, so a reason added to the published type fails the type check here
 * until it has a sentence.
 */
const SKIP_REASON_TEXT: Record<AccountHistoryTickSkipReason, string> = {
    disabled: 'Ingestion is disabled in settings.',
    unavailable: 'ClickHouse or the history provider is unavailable.',
    overlapping: 'Another tick is already running.'
};

/**
 * Say why a tick was skipped, so an operator reading a no-op tick knows
 * whether to change a setting, check a service, or simply wait.
 *
 * @param reason - The `skippedReason` the tick outcome carries.
 * @returns One sentence naming the cause.
 */
export function describeSkipReason(reason: AccountHistoryTickSkipReason): string {
    return SKIP_REASON_TEXT[reason];
}
