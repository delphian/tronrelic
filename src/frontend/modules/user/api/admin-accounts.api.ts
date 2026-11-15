/**
 * @fileoverview Same-origin client for the account endpoints behind the Users
 * tab of `/system/users`: the sortable account list, one account's details,
 * its older sign-in events, and the admin note.
 *
 * The admin's session cookie authenticates each call. Dates arrive as ISO
 * strings, so the row types here mirror the `@/types` shapes with strings in
 * place of `Date`.
 */

import type {
    AccountSortDirection,
    AccountSortField,
    IAccountAdminNote,
    IAccountDetails,
    IAccountSignInEvent
} from '@/types';
import { parseJsonResponse } from './http';

/** Base path of the admin account endpoints. */
const BASE_URL = '/api/admin/users';

/** One account as the list and the details endpoint send it. */
export interface IAccountRow {
    id: string;
    email: string;
    name: string | null;
    emailVerified: boolean;
    createdAt: string;
    groups: string[];
    primaryWallet: string | null;
    /** When an admin deleted the account; null for a live account. */
    deletedAt: string | null;
    /** When the account last made a signed-in request or MCP call; null when never seen. */
    lastSeenAt: string | null;
}

/** One linked wallet as the details endpoint sends it. */
export interface IAccountWalletRow {
    address: string;
    isPrimary: boolean;
    linkedAt: string;
    lastUsedAt: string;
}

/** One account's details, with dates as the strings the endpoint sends. */
export type IAccountDetailsResponse = Omit<IAccountDetails, 'account' | 'wallets'> & {
    account: IAccountRow;
    wallets: IAccountWalletRow[];
};

/** What the account list can be asked for. */
export interface IAccountListQuery {
    limit: number;
    skip: number;
    search?: string;
    sortBy: AccountSortField;
    sortDirection: AccountSortDirection;
}

/**
 * Load one page of the account list.
 *
 * @param query - Page, search text, and sort.
 * @returns The page of accounts and the total matching the search.
 */
export async function fetchAccounts(query: IAccountListQuery): Promise<{ accounts: IAccountRow[]; total: number }> {
    const params = new URLSearchParams({
        limit: String(query.limit),
        skip: String(query.skip),
        sortBy: query.sortBy,
        sortDirection: query.sortDirection
    });
    if (query.search) {
        params.set('search', query.search);
    }
    return parseJsonResponse(await fetch(`${BASE_URL}?${params.toString()}`));
}

/**
 * Load everything the detail panel shows for one account.
 *
 * @param userId - The account's id.
 * @returns The account's details.
 */
export async function fetchAccountDetails(userId: string): Promise<IAccountDetailsResponse> {
    return parseJsonResponse(await fetch(`${BASE_URL}/${encodeURIComponent(userId)}/details`));
}

/**
 * Load a further page of the sign-in events naming an account's email.
 *
 * @param userId - The account's id.
 * @param page - How many events to return and how many to skip.
 * @returns The page of events, newest first, and the total.
 */
export async function fetchAccountSignInEvents(
    userId: string,
    page: { limit: number; offset: number }
): Promise<{ events: IAccountSignInEvent[]; total: number }> {
    const params = new URLSearchParams({ limit: String(page.limit), offset: String(page.offset) });
    return parseJsonResponse(await fetch(`${BASE_URL}/${encodeURIComponent(userId)}/sign-in-events?${params.toString()}`));
}

/**
 * Save or clear an account's admin note.
 *
 * @param userId - The account's id.
 * @param note - The note text; an empty string clears it.
 * @returns The saved note, or null once cleared.
 */
export async function saveAccountNote(userId: string, note: string): Promise<IAccountAdminNote | null> {
    const response = await fetch(`${BASE_URL}/${encodeURIComponent(userId)}/note`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note })
    });
    const body = await parseJsonResponse<{ adminNote: IAccountAdminNote | null }>(response);
    return body.adminNote;
}
