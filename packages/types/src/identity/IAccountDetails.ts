/**
 * @fileoverview Everything an administrator needs to review one account: the
 * account itself, the admin note, live sessions, wallets, connected apps, and
 * the latest sign-in events.
 */

import type { IAccountSummary } from './IAccountDirectoryService.js';
import type { IAccountAdminNote } from './IAccountAdminNote.js';
import type { IAccountSession } from './IAccountSession.js';
import type { IAccountSignInEvent } from './IAccountSignInEvent.js';
import type { IConnectedApp } from './IConnectedApp.js';
import type { ILinkedWallet } from './IWalletService.js';

/**
 * One account's full admin view. Served by `GET /api/admin/users/:id/details`
 * for the Users tab and returned by the `identity-get-account` AI tool, which
 * both build it through the same service so the two never disagree.
 */
export interface IAccountDetails {
    /** The account summary. */
    account: IAccountSummary;

    /** The admin note, or null when none has been written. */
    adminNote: IAccountAdminNote | null;

    /** Live sessions, newest first, capped; never includes session tokens. */
    sessions: IAccountSession[];

    /** True when the account has more live sessions than `sessions` holds. */
    sessionsTruncated: boolean;

    /** Linked wallets, oldest first. */
    wallets: ILinkedWallet[];

    /** Apps the account has connected through OAuth. */
    connectedApps: IConnectedApp[];

    /**
     * Latest sign-in events matched by the account's email, newest first. They
     * include code requests and failed attempts by anyone who typed the address.
     */
    recentSignInEvents: IAccountSignInEvent[];

    /** How many stored events match the account's email in total. */
    signInEventsTotal: number;
}
