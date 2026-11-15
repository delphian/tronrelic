/**
 * @fileoverview The private note administrators keep about one account.
 */

/**
 * An admin-only note about an account, such as why it was flagged or what
 * its owner asked for. The account's owner never sees it.
 */
export interface IAccountAdminNote {
    /** The note text, at most `ACCOUNT_NOTE_MAX_LENGTH` characters. */
    note: string;

    /** When the note was last saved, as ISO 8601 text. */
    updatedAt: string;

    /** User id of the admin who last saved it; null when the admin API token was used. */
    updatedBy: string | null;

    /** Email of that admin, when the account still exists; null otherwise. */
    updatedByEmail: string | null;
}
