/**
 * @fileoverview The client the Insert widget dialog hook returns.
 *
 * The page editor and plugin editors, through
 * `context.useWidgetEmbedPicker()`, open the same dialog and insert the
 * ` ```widget ` block it hands back.
 */

/**
 * Opens the Insert widget dialog.
 */
export interface IWidgetEmbedPickerClient {
    /**
     * Open the dialog. Resolves with the markdown block to insert at the
     * cursor, already surrounded by blank lines, or null when the author
     * closes the dialog without inserting.
     */
    pick: () => Promise<string | null>;
}
