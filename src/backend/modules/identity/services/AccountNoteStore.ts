/**
 * @fileoverview Stores the private note administrators keep about each
 * account, edited in the user detail panel on `/system/users`.
 *
 * - One document per account in `module_user_admin_notes`, keyed by user id.
 * - Saving an empty note deletes the document, so "no note" has one form.
 * - The note text is never written to the log, because it may hold personal
 *   details; the log records who changed which account's note and its length.
 */

import type { Collection } from 'mongodb';
import type { IDatabaseService, ISystemLogService } from '@/types';
import { ACCOUNT_NOTE_MAX_LENGTH } from '@/types';
import { ACCOUNT_NOTES_COLLECTION, type IAccountNoteDocument } from '../database/IAccountNoteDocument.js';

/** The result of checking a submitted note: the trimmed text, or why it was refused. */
export type AccountNoteInputResult = { ok: true; note: string } | { ok: false; message: string };

/**
 * Admin note storage. A plain per-module instance rather than a published
 * service: only the identity module's admin controller and account details
 * read or write it.
 */
export class AccountNoteStore {
    /** `module_user_admin_notes` collection handle. */
    private readonly collection: Collection<IAccountNoteDocument>;

    /** Logger scoped to this store. */
    private readonly logger: ISystemLogService;

    /**
     * @param database - Database service the collection is reached through.
     * @param logger - The identity module's logger, so changes appear on its Logs tab.
     */
    constructor(database: IDatabaseService, logger: ISystemLogService) {
        this.collection = database.getCollection<IAccountNoteDocument>(ACCOUNT_NOTES_COLLECTION);
        this.logger = logger.child({ component: 'account-note-store' });
    }

    /**
     * Check a submitted note before saving it.
     *
     * @param input - The `note` field from the request body.
     * @returns The trimmed note, or a message saying what to fix.
     */
    static validate(input: unknown): AccountNoteInputResult {
        let result: AccountNoteInputResult;
        if (typeof input !== 'string') {
            result = { ok: false, message: 'note must be text; send an empty string to clear it' };
        } else if (input.trim().length > ACCOUNT_NOTE_MAX_LENGTH) {
            result = { ok: false, message: `note must be at most ${ACCOUNT_NOTE_MAX_LENGTH} characters` };
        } else {
            result = { ok: true, note: input.trim() };
        }
        return result;
    }

    /**
     * Create the unique index that keeps one note per account and serves the
     * lookup by user id.
     */
    async createIndexes(): Promise<void> {
        await this.collection.createIndex({ userId: 1 }, { unique: true, name: 'userId_unique' });
        this.logger.info('Account note index created');
    }

    /**
     * Read one account's note.
     *
     * @param userId - Better Auth user id of the account.
     * @returns The note, or null when none has been written.
     */
    async get(userId: string): Promise<IAccountNoteDocument | null> {
        return this.collection.findOne({ userId }, { projection: { _id: 0 } });
    }

    /**
     * Save or clear one account's note.
     *
     * @param userId - Better Auth user id of the account.
     * @param note - Text already accepted by {@link validate}; empty clears the note.
     * @param actorUserId - The admin saving it, or null for the admin API token.
     * @returns The saved note, or null when it was cleared.
     */
    async set(userId: string, note: string, actorUserId: string | null): Promise<IAccountNoteDocument | null> {
        let saved: IAccountNoteDocument | null = null;
        if (note.length === 0) {
            await this.collection.deleteOne({ userId });
        } else {
            saved = { userId, note, updatedAt: new Date(), updatedBy: actorUserId };
            await this.collection.updateOne({ userId }, { $set: saved }, { upsert: true });
        }
        this.logger.info({ userId, actorUserId, length: note.length, cleared: saved === null }, 'Account admin note saved');
        return saved;
    }
}
