/**
 * @fileoverview API client for the ClickHouse accounts admin surface.
 *
 * Thin fetch wrappers over `/api/admin/system/clickhouse-accounts`. Same-origin
 * calls carry the Better Auth session cookie, which the admin gate consults,
 * so no token plumbing happens here. The routes that change an account refuse
 * the shared service token, so they only work for a signed-in admin, which is
 * the only way this page is used. Every function throws on a non-2xx response
 * with the server's own message, so the UI can show why a change was refused.
 */

import type {
    IClickHouseAccountAuditEntry,
    IClickHouseAccountLimits,
    IClickHouseAccountQuery,
    IClickHouseAccountQuotaUsage,
    IClickHouseAccountSummary,
    IClickHouseAccountUsageDay
} from '@/types';

const BASE = '/api/admin/system/clickhouse-accounts';

/**
 * Unwrap a response or raise the server's error message.
 *
 * @param response - The fetch response to check.
 * @param what - Verb phrase naming the action, used when the body carries no message.
 * @returns The parsed JSON body.
 */
async function parse<T>(response: Response, what: string): Promise<T> {
    if (!response.ok) {
        const body = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
        throw new Error(body.error || `Failed to ${what} (HTTP ${response.status})`);
    }

    return response.json() as Promise<T>;
}

/**
 * Read every declared account.
 *
 * @returns Account summaries in declaration order.
 */
export async function listClickHouseAccounts(): Promise<IClickHouseAccountSummary[]> {
    const body = await parse<{ accounts: IClickHouseAccountSummary[] }>(await fetch(BASE), 'load ClickHouse accounts');

    return body.accounts;
}

/**
 * Change some of a managed account's limits.
 *
 * @param accountId - Account to change.
 * @param limits - Only the fields that changed.
 * @param reason - Why the admin is making the change; recorded in the audit trail.
 * @returns The account's updated summary.
 */
export async function updateClickHouseAccountLimits(
    accountId: string,
    limits: Partial<IClickHouseAccountLimits>,
    reason: string
): Promise<IClickHouseAccountSummary> {
    const response = await fetch(`${BASE}/${encodeURIComponent(accountId)}/limits`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limits, reason })
    });
    const body = await parse<{ account: IClickHouseAccountSummary }>(response, 'save limits');

    return body.account;
}

/**
 * Apply a managed account to ClickHouse again.
 *
 * @param accountId - Account to apply.
 * @returns The summary after the attempt; its `state` and `error` report the outcome.
 */
export async function applyClickHouseAccount(accountId: string): Promise<IClickHouseAccountSummary> {
    const response = await fetch(`${BASE}/${encodeURIComponent(accountId)}/apply`, { method: 'POST' });
    const body = await parse<{ account: IClickHouseAccountSummary }>(response, 'apply account');

    return body.account;
}

/**
 * Read an account's running or recent queries.
 *
 * @param accountId - Account whose queries to read.
 * @param scope - `running` for live queries, `recent` for the query log.
 * @returns Newest first.
 */
export async function listClickHouseAccountQueries(
    accountId: string,
    scope: 'running' | 'recent'
): Promise<IClickHouseAccountQuery[]> {
    const response = await fetch(`${BASE}/${encodeURIComponent(accountId)}/queries?scope=${scope}&limit=50`);
    const body = await parse<{ queries: IClickHouseAccountQuery[] }>(response, 'load queries');

    return body.queries;
}

/**
 * Stop one running query an account owns.
 *
 * @param accountId - Account the query belongs to.
 * @param queryId - The running query's id.
 * @returns True when the query was stopped, false when it had already finished.
 */
export async function killClickHouseAccountQuery(accountId: string, queryId: string): Promise<boolean> {
    const response = await fetch(
        `${BASE}/${encodeURIComponent(accountId)}/queries/${encodeURIComponent(queryId)}/kill`,
        { method: 'POST' }
    );
    const body = await parse<{ killed: boolean }>(response, 'stop query');

    return body.killed;
}

/**
 * Read an account's current quota usage and daily history.
 *
 * @param accountId - Account whose usage to read.
 * @param days - Days of history to include, today included.
 * @returns Quota rows per key and daily totals, oldest day first.
 */
export async function getClickHouseAccountUsage(
    accountId: string,
    days: number
): Promise<{ quota: IClickHouseAccountQuotaUsage[]; history: IClickHouseAccountUsageDay[] }> {
    const response = await fetch(`${BASE}/${encodeURIComponent(accountId)}/usage?days=${days}`);

    return parse<{ quota: IClickHouseAccountQuotaUsage[]; history: IClickHouseAccountUsageDay[] }>(response, 'load usage');
}

/**
 * Read the admin actions recorded against an account.
 *
 * @param accountId - Account whose audit trail to read.
 * @returns Newest first.
 */
export async function listClickHouseAccountAudit(accountId: string): Promise<IClickHouseAccountAuditEntry[]> {
    const response = await fetch(`${BASE}/${encodeURIComponent(accountId)}/audit?limit=50`);
    const body = await parse<{ entries: IClickHouseAccountAuditEntry[] }>(response, 'load changes');

    return body.entries;
}
