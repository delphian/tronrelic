/**
 * @fileoverview Storage shape of the admin note kept about one account.
 *
 * Notes live in their own collection rather than on the Better Auth user
 * record. Fields on that record can travel with the user's own session, and a
 * note written about someone must never reach them.
 */

/** Collection holding one admin note per account. */
export const ACCOUNT_NOTES_COLLECTION = 'module_user_admin_notes';

/** One account's admin note. */
export interface IAccountNoteDocument {
    /** Better Auth user id (24-character hex) the note is about. Unique. */
    userId: string;

    /** The note text, trimmed, at most `ACCOUNT_NOTE_MAX_LENGTH` characters. */
    note: string;

    /** When the note was last saved. */
    updatedAt: Date;

    /** User id of the admin who last saved it; null when the admin API token was used. */
    updatedBy: string | null;
}
