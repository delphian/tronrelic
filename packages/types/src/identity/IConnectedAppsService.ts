/**
 * @file IConnectedAppsService.ts
 *
 * The identity module's store of OAuth grants to connected apps.
 */

import type { IConnectedApp } from './IConnectedApp.js';
import type { IConnectedAppAdminRow } from './IConnectedAppAdminRow.js';

/**
 * Lists and revokes the apps users have authorized through OAuth.
 *
 * The identity module owns the OAuth tables, so it is the only component that
 * reads or writes them; the MCP admin page and the user's profile page both go
 * through this service.
 */
export interface IConnectedAppsService {
    /**
     * List the apps one user has authorized.
     *
     * @param userId - Better Auth user id.
     * @returns The user's grants, newest first.
     */
    listForUser(userId: string): Promise<IConnectedApp[]>;

    /**
     * List grants across all users, for the admin page.
     *
     * @param options - Page size and offset.
     * @returns One page of grants, newest first, with the total count.
     */
    listAll(options: { limit: number; offset: number }): Promise<{ apps: IConnectedAppAdminRow[]; total: number }>;

    /**
     * Revoke one user's grant to one app: delete the consent and every refresh
     * and stored access token the app holds for that user.
     *
     * @param userId - Better Auth user id.
     * @param clientId - OAuth client id.
     * @returns True when a grant existed and was revoked.
     */
    revoke(userId: string, clientId: string): Promise<boolean>;

    /**
     * Whether a user still has a live grant for an app. The MCP endpoint's
     * token check calls this, so a revoked grant stops working before its
     * access tokens expire.
     *
     * A grant is keyed only by the user and the client, and many users share
     * one client id (every Claude user connects with the same metadata URL).
     * Without `issuedAt`, a user who revokes an app and reconnects it within
     * the access token lifetime would bring back every token issued before the
     * revocation, including one they revoked because it leaked.
     *
     * @param userId - Better Auth user id.
     * @param clientId - OAuth client id.
     * @param issuedAt - The token's `iat` claim, in seconds since the epoch,
     *   when the caller is checking a token. A token issued before the current
     *   consent was created belongs to an earlier grant and is refused.
     * @returns True when a consent for that pair exists and, when `issuedAt`
     *   is given, was created no later than the token.
     */
    hasGrant(userId: string, clientId: string, issuedAt?: number): Promise<boolean>;

    /**
     * Record that an app just made an authorized call for a user, so the
     * connected-apps lists can show when each app was last used. The MCP
     * endpoint calls this after it accepts a request.
     *
     * Writes are throttled per grant, so the stored time can trail the real
     * last call by a few minutes, and a busy client does not turn every
     * request into a database write. The promise never rejects: a failed
     * write is logged and retried on a later call, because a missing
     * timestamp must never fail the request that triggered it.
     *
     * @param userId - Better Auth user id from the verified token.
     * @param clientId - OAuth client id from the verified token.
     * @returns Resolves once the write is done or skipped.
     */
    recordUse(userId: string, clientId: string): Promise<void>;
}
