/**
 * @fileoverview Assembles one account's full admin view: the account, the
 * admin note, live sessions, wallets, connected apps, and recent sign-in events.
 *
 * The user detail panel on `/system/users` and the `identity-get-account` AI
 * tool both read through this one service, so an administrator and an agent
 * looking at the same account always see the same facts.
 *
 * - Sessions are capped at 25 and sign-in events at 20; the caller pages
 *   older events through {@link AccountDetailsService.listSignInEvents}.
 * - Sign-in events are matched by the account's email, so they include code
 *   requests and failed attempts by anyone who typed that address.
 * - Session tokens never reach this service; `listSessions` strips them.
 */

import type {
    IAccountAdminNote,
    IAccountDetails,
    IAccountDirectoryService,
    IAccountSession,
    IAccountSignInEvent,
    IAccountSummary,
    IConnectedApp,
    ILinkedWallet
} from '@/types';
import type { IAccountNoteDocument } from '../database/IAccountNoteDocument.js';
import type { ISignInEventDocument } from '../database/ISignInEventDocument.js';
import type { ISignInEventQuery } from './SignInEventStore.js';
import { toSignInEventView } from './toSignInEventView.js';

/** Most live sessions included in one account's details. */
export const ACCOUNT_DETAIL_SESSION_LIMIT = 25;

/** Sign-in events included in one account's details; older ones are paged separately. */
export const ACCOUNT_DETAIL_EVENT_LIMIT = 20;

/**
 * What the service reads through. Each member is a narrow function or a
 * slice of an interface, so the service never holds the Better Auth instance
 * or a collection handle and can be tested with plain doubles.
 */
export interface IAccountDetailsDependencies {
    /** Resolves the email of the admin who last saved a note. */
    accounts: Pick<IAccountDirectoryService, 'getAccount'>;

    /** Reads one account's admin note. */
    getNote(userId: string): Promise<IAccountNoteDocument | null>;

    /** Filtered, paged read over stored sign-in events. */
    listSignInEvents(
        query: ISignInEventQuery,
        page: { limit: number; offset: number }
    ): Promise<{ events: ISignInEventDocument[]; total: number }>;

    /** One account's live sessions, newest first, already stripped of their tokens. */
    listSessions(userId: string): Promise<IAccountSession[]>;

    /** One account's linked wallets. */
    listWallets(userId: string): Promise<ILinkedWallet[]>;

    /** The apps one account has connected. */
    listConnectedApps(userId: string): Promise<IConnectedApp[]>;
}

/**
 * Builds account details for admin tooling. A plain per-module instance built
 * by the identity module; it holds no state of its own.
 */
export class AccountDetailsService {
    /**
     * @param deps - The reads the details are assembled from.
     */
    constructor(private readonly deps: IAccountDetailsDependencies) {}

    /**
     * Assemble the full admin view of one account.
     *
     * @param account - The account, already found by id or email.
     * @returns Everything the detail panel and the AI tool show.
     */
    async getDetails(account: IAccountSummary): Promise<IAccountDetails> {
        const [note, sessions, wallets, connectedApps, events] = await Promise.all([
            this.deps.getNote(account.id),
            this.deps.listSessions(account.id),
            this.deps.listWallets(account.id),
            this.deps.listConnectedApps(account.id),
            this.listSignInEvents(account, { limit: ACCOUNT_DETAIL_EVENT_LIMIT, offset: 0 })
        ]);
        return {
            account,
            adminNote: await this.toAdminNote(note),
            sessions: sessions.slice(0, ACCOUNT_DETAIL_SESSION_LIMIT),
            sessionsTruncated: sessions.length > ACCOUNT_DETAIL_SESSION_LIMIT,
            wallets,
            connectedApps,
            recentSignInEvents: events.events,
            signInEventsTotal: events.total
        };
    }

    /**
     * Read one page of the sign-in events that name an account's email.
     *
     * @param account - The account whose address to match.
     * @param page - How many to return and how many to skip; the caller bounds both.
     * @returns The page, newest first, and how many events match in total.
     */
    async listSignInEvents(account: IAccountSummary, page: { limit: number; offset: number }): Promise<{ events: IAccountSignInEvent[]; total: number }> {
        const { events, total } = await this.deps.listSignInEvents({ email: account.email.toLowerCase() }, page);
        return { events: events.map(toSignInEventView), total };
    }

    /**
     * Turn a stored note into what admin tooling shows, naming the admin who
     * saved it by email so the panel does not show a bare id.
     *
     * @param note - The stored note, or null.
     * @returns The note as reported, or null when there is none.
     */
    async toAdminNote(note: IAccountNoteDocument | null): Promise<IAccountAdminNote | null> {
        let result: IAccountAdminNote | null = null;
        if (note) {
            const editor = note.updatedBy ? await this.deps.accounts.getAccount(note.updatedBy) : null;
            result = {
                note: note.note,
                updatedAt: new Date(note.updatedAt).toISOString(),
                updatedBy: note.updatedBy,
                updatedByEmail: editor?.email ?? null
            };
        }
        return result;
    }
}
