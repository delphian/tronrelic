/**
 * @fileoverview One editable wallet row in the trace panel.
 */

/**
 * A wallet the reader has entered, or an empty row waiting for one.
 *
 * The row carries an id it does not display, because the list is reorderable by
 * deletion and React needs a key that survives it. Keying by array index instead
 * hands the wrong element's state to the wrong row when a middle row is removed,
 * which shows up as an address typeahead keeping suggestions for the wallet that
 * was just deleted.
 */
export interface IWalletRow {
    /** Stable identity for this row, assigned when the row is created. */
    id: string;

    /** The address entered so far, empty until the reader picks one. */
    value: string;
}
