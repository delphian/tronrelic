/**
 * @fileoverview Where the address page's transfers list continues from.
 *
 * The list is read one week at a time, newest first, so continuing it needs
 * both the end of the week being read and the position inside that week.
 * The frontend treats the whole object as opaque and passes it back as is.
 */

/**
 * The position to load older transfers from.
 */
export interface IAddressExplorerTransfersCursor {
    /** The exclusive end of the week to read, ISO 8601. */
    before: string;
    /** The position inside that week, when the previous page did not finish it. */
    cursor?: string;
}
