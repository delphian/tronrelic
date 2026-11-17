/**
 * @fileoverview One sortable column of a storage browser's inventory table.
 *
 * Both storage browsers describe their columns in this shape, so the shared
 * inventory table can draw the sortable header row and the stacked-row sort
 * picker from the same list.
 */

/**
 * A column the collection or table inventory can be sorted by.
 */
export interface IInventoryColumn<TKey extends string> {
    /** The field the column sorts by. */
    key: TKey;

    /** Header text, which the sort picker also shows while rows are stacked. */
    label: string;

    /**
     * Right-align the column in tabular figures. Set it for a quantity an
     * operator compares down the column, such as a size or a count.
     */
    numeric: boolean;

    /**
     * The direction a first click on the column produces. Quantities open
     * descending, because the question an operator usually brings is "what is
     * biggest". Text opens ascending, which is alphabetical order.
     */
    initialDirection: 'asc' | 'desc';
}
