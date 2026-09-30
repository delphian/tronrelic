/**
 * @file IConnectedAppAdminRow.ts
 *
 * A connected app as the admin page lists it, across all users.
 */

import type { IConnectedApp } from './IConnectedApp.js';

/**
 * A user's grant to a connected app, with enough about the user for an admin
 * to recognise whose grant it is and revoke it.
 */
export interface IConnectedAppAdminRow extends IConnectedApp {
    /** Better Auth id of the user who granted access. */
    userId: string;

    /** The user's email address, when the account has one. */
    userEmail?: string;
}
