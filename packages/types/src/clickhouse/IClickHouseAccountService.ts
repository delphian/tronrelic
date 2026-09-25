/**
 * @fileoverview The service that owns ClickHouse accounts: provisioning,
 * admin-tuned limits, accountability, and account-bound connections.
 *
 * Accounts exist so that different kinds of caller, such as the application
 * itself and an AI agent, reach ClickHouse under different limits that the
 * server enforces. This service is the one place those accounts are applied to
 * ClickHouse, changed, audited, and handed out to code that should run under
 * them.
 */

import type { IClickHouseAccountAuditEntry } from './IClickHouseAccountAuditEntry.js';
import type { IClickHouseAccountLimits } from './IClickHouseAccountLimits.js';
import type { IClickHouseAccountQuery } from './IClickHouseAccountQuery.js';
import type { IClickHouseAccountQuotaUsage } from './IClickHouseAccountQuotaUsage.js';
import type { IClickHouseAccountSummary } from './IClickHouseAccountSummary.js';
import type { IClickHouseAccountUsageDay } from './IClickHouseAccountUsageDay.js';
import type { IClickHouseReader } from './IClickHouseReader.js';

/**
 * Admin and consumer operations over the declared ClickHouse accounts.
 */
export interface IClickHouseAccountService {
    /**
     * Every declared account with its state, limits, and server-reported
     * settings and grants.
     *
     * @returns One summary per declared account, in declaration order.
     */
    listAccounts(): Promise<IClickHouseAccountSummary[]>;

    /**
     * One account's summary.
     *
     * @param accountId - Account to describe.
     * @returns The summary, or null when no account has that id.
     */
    getAccount(accountId: string): Promise<IClickHouseAccountSummary | null>;

    /**
     * Change some of a managed account's limits, apply them to ClickHouse, and
     * record the change.
     *
     * Each value must be a positive whole number no higher than the account's
     * ceiling. The change is stored and audited only after ClickHouse accepts
     * it, so the stored limits never claim something the server is not doing.
     *
     * @param accountId - Managed account to change.
     * @param patch - The limits to change; omitted fields keep their value.
     * @param actorId - Better Auth user id of the admin making the change.
     * @param reason - Why the admin is making the change, recorded in the audit.
     * @returns The account's updated summary.
     */
    updateLimits(
        accountId: string,
        patch: Partial<IClickHouseAccountLimits>,
        actorId: string,
        reason: string | null
    ): Promise<IClickHouseAccountSummary>;

    /**
     * Apply a managed account's user, profile, quota, and grants to ClickHouse
     * again, and record that an admin did so. Used after the server was rebuilt
     * or someone changed the account by hand.
     *
     * @param accountId - Managed account to apply.
     * @param actorId - Better Auth user id of the admin.
     * @returns The account's summary after the attempt, including any error.
     */
    applyAccount(accountId: string, actorId: string): Promise<IClickHouseAccountSummary>;

    /**
     * Queries an account is running now, or ran recently.
     *
     * @param accountId - Account whose queries to list.
     * @param scope - `running` for live queries, `recent` for finished ones from the query log.
     * @param limit - Most rows to return for `recent`.
     * @returns Newest first.
     */
    listQueries(accountId: string, scope: 'running' | 'recent', limit: number): Promise<IClickHouseAccountQuery[]>;

    /**
     * Stop one running query the account owns, and record that an admin did so.
     *
     * @param accountId - Account the query must belong to; a query owned by
     *   another account is never stopped.
     * @param queryId - The running query's id.
     * @param actorId - Better Auth user id of the admin.
     * @returns True when ClickHouse found and stopped the query.
     */
    killQuery(accountId: string, queryId: string, actorId: string): Promise<boolean>;

    /**
     * Current hourly quota usage per quota key for a managed account.
     *
     * @param accountId - Managed account whose quota to read.
     * @returns One row per key that has used the quota this interval.
     */
    getQuotaUsage(accountId: string): Promise<IClickHouseAccountQuotaUsage[]>;

    /**
     * Daily activity totals for an account.
     *
     * @param accountId - Account whose history to read.
     * @param days - How many days back to include, today included.
     * @returns Oldest day first.
     */
    getUsageHistory(accountId: string, days: number): Promise<IClickHouseAccountUsageDay[]>;

    /**
     * Admin actions recorded against an account.
     *
     * @param accountId - Account whose audit trail to read.
     * @param limit - Most entries to return.
     * @returns Newest first.
     */
    listAudit(accountId: string, limit: number): Promise<IClickHouseAccountAuditEntry[]>;

    /**
     * A read-only connection bound to a managed account, for code that must run
     * under that account's limits.
     *
     * @param accountId - Managed account to connect as.
     * @returns The account's reader, created on first use and shared afterwards.
     * @throws Error when the account is unknown, observed, or not active.
     */
    reader(accountId: string): IClickHouseReader;
}
