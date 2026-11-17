/**
 * @fileoverview The column a storage browser's inventory is sorted by, and the
 * direction it runs in.
 */

/**
 * The active sort of a collection or table inventory.
 */
export interface IInventorySort<TKey extends string> {
    /** The column the rows are sorted by. */
    key: TKey;

    /** `asc` puts the smallest or alphabetically first value at the top, `desc` the largest. */
    direction: 'asc' | 'desc';
}
