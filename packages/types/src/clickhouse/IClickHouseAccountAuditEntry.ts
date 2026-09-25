/**
 * @fileoverview One recorded admin action on a ClickHouse account.
 *
 * Every change an admin makes to an account is recorded with who made it and
 * what changed, so a later question such as "who raised the agent's row limit"
 * has an answer.
 */

import type { ClickHouseAccountAuditAction } from './ClickHouseAccountAuditAction.js';
import type { IClickHouseAccountLimits } from './IClickHouseAccountLimits.js';

/**
 * One audit record.
 */
export interface IClickHouseAccountAuditEntry {
    /** Account the action applied to. */
    accountId: string;

    /** What the admin did. */
    action: ClickHouseAccountAuditAction;

    /** Better Auth user id of the admin who acted. */
    actorId: string;

    /** When the action happened, as an ISO timestamp. */
    at: string;

    /** Why the admin made the change, in their own words. Null when none was given. */
    reason: string | null;

    /** Limits before an `update-limits` action; null for other actions. */
    before: IClickHouseAccountLimits | null;

    /** Limits after an `update-limits` action; null for other actions. */
    after: IClickHouseAccountLimits | null;

    /** Extra detail, such as the id of a killed query or an apply error. */
    detail: string | null;

    /** Whether the action succeeded. A failed action is recorded too. */
    succeeded: boolean;
}
